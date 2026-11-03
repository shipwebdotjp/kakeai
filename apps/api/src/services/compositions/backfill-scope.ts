import {
  contentDocumentSchema,
  renderJobSnapshotSchema,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { collectCompositionVersionIds } from "./validate";

/**
 * Infers the owner of legacy Compositions from ScriptVersion references.
 *
 * - referenced by exactly one Work: that Work's `work` Composition
 * - referenced by more than one Work: `shared`
 * - unreferenced: stays `unclassified`
 *
 * Runs once at startup and only touches rows that are still unclassified, so a
 * later restart cannot overwrite an explicit decision.
 */
export async function backfillCompositionScopes(
  prisma: PrismaClient,
): Promise<number> {
  const unclassified = await prisma.composition.findMany({
    where: { scope: "unclassified" },
    select: {
      id: true,
      versions: { select: { id: true } },
    },
  });
  if (unclassified.length === 0) {
    return 0;
  }

  const versionToComposition = new Map<string, string>();
  for (const composition of unclassified) {
    for (const version of composition.versions) {
      versionToComposition.set(version.id, composition.id);
    }
  }
  if (versionToComposition.size === 0) {
    return 0;
  }

  const worksByComposition = new Map<string, Set<string>>();
  const recordReferences = (versionIds: readonly string[], workId: string) => {
    for (const versionId of versionIds) {
      const compositionId = versionToComposition.get(versionId);
      if (compositionId === undefined) {
        continue;
      }
      const workIds = worksByComposition.get(compositionId) ?? new Set<string>();
      workIds.add(workId);
      worksByComposition.set(compositionId, workIds);
    }
  };

  const scripts = await prisma.scriptVersion.findMany({
    select: {
      contentJson: true,
      languageEdition: { select: { workId: true } },
    },
  });
  for (const script of scripts) {
    let raw: unknown;
    try {
      raw = JSON.parse(script.contentJson);
    } catch {
      continue;
    }
    const parsed = contentDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    recordReferences(
      collectCompositionVersionIds(parsed.data),
      script.languageEdition.workId,
    );
  }

  const renderJobs = await prisma.job.findMany({
    where: { kind: "render" },
    select: {
      workId: true,
      inputSnapshotJson: true,
      languageEdition: { select: { workId: true } },
    },
  });
  for (const job of renderJobs) {
    const workId = job.workId ?? job.languageEdition?.workId;
    if (workId === undefined || workId === null) {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(job.inputSnapshotJson);
    } catch {
      continue;
    }
    const parsed = renderJobSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    recordReferences(
      [
        ...parsed.data.compositionVersions.map((version) => version.id),
        ...collectCompositionVersionIds(parsed.data.content),
      ],
      workId,
    );
  }

  const idsByWork = new Map<string, string[]>();
  const sharedIds: string[] = [];
  for (const composition of unclassified) {
    const workIds = worksByComposition.get(composition.id);
    if (workIds === undefined || workIds.size === 0) {
      continue;
    }
    if (workIds.size === 1) {
      const workId = [...workIds][0];
      if (workId === undefined) {
        continue;
      }
      const ids = idsByWork.get(workId) ?? [];
      ids.push(composition.id);
      idsByWork.set(workId, ids);
    } else {
      sharedIds.push(composition.id);
    }
  }

  const updates = [
    ...[...idsByWork].map(([workId, ids]) =>
      prisma.composition.updateMany({
        where: { id: { in: ids }, scope: "unclassified" },
        data: { scope: "work", workId },
      }),
    ),
    ...(sharedIds.length === 0
      ? []
      : [
          prisma.composition.updateMany({
            where: { id: { in: sharedIds }, scope: "unclassified" },
            data: { scope: "shared", workId: null },
          }),
        ]),
  ];
  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }
  return (
    [...idsByWork.values()].reduce((sum, ids) => sum + ids.length, 0) +
    sharedIds.length
  );
}
