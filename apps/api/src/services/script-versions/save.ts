import {
  assertAssetsAvailable,
  assertTakeDurations,
  loadAllReferences,
} from "./references";
import { assertFaceSetReferences, collectFaceSetIds } from "./references";
import { collectInsertWarnings } from "./validation";
import { normalizeAgentId } from "../attribution.ts";
import { assertInsertScenes, assertVideoPlayback } from "./validation";
import { throwIfFatalTimelineError } from "./errors";
import { requireEdition } from "./common";
import {
  collectCompositionWindowIssues,
  collectOffsetRangeWarnings,
  collectTimelineIssues,
} from "@kakeai/video";
import {
  collectAssetReferences,
  compositionFullBleedInputSchema,
  computeContentWarnings,
  type ContentDocument,
  type SaveScriptVersionRequest,
  type ScriptVersion as ScriptVersionDto,
  type ScriptVersionAuthor,
  type VisualThemeDefinition,
  type Warning,
} from "@kakeai/contracts";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.ts";
import {
  deserializeContent,
  serializeContent,
} from "../../domain/content-json.ts";
import { toScriptVersion } from "../../dto/mappers.ts";
import {
  resourceNotFound,
  validationError,
  type ValidationIssue,
} from "../../http/validation.ts";
import {
  collectCompositionVersionIds,
  getCompositionCanvasProfilesByVersionId,
  getCompositionDurationsByVersionId,
} from "../compositions.ts";
import { ThemeResolver } from "../theme-resolver.ts";

export interface SaveScriptVersionResult {
  scriptVersion: ScriptVersionDto;
  warnings: Warning[];
}

/**
 * Attribution for a newly created ScriptVersion. UI and HTTP save paths omit
 * this and therefore record a human author with no agent request identity.
 */
export interface ScriptVersionAttribution {
  author?: ScriptVersionAuthor;
  authorAgentId?: string | null;
  agentRequestId?: string | null;
  agentRequestHash?: string | null;
}

interface NormalizedScriptVersionAttribution {
  author: ScriptVersionAuthor;
  authorAgentId: string | null;
  agentRequestId: string | null;
  agentRequestHash: string | null;
}

/**
 * Optional compare-and-set guard for callers that must not overwrite a newer
 * current version (Agent Access `script.edit`). It is checked inside the save
 * transaction, not only before it.
 */
export interface SaveScriptVersionGuard {
  expectedCurrentScriptVersionId: string;
  staleError: () => Error;
}

/**
 * Save-time policies that are not part of the HTTP request. `script.restore`
 * opts out of the selectable-Theme change rule because restoring an old version
 * must preserve its archived Theme reference.
 */
export interface SaveScriptVersionOptions {
  /**
   * When true (the default), a Visual Theme change must select a built-in or the
   * latest revision of an unarchived user Theme. Keeping the current Theme is
   * always allowed, so an existing archived-Theme document can still be edited.
   */
  enforceSelectableTheme?: boolean;
}

function normalizeScriptVersionAttribution(
  attribution: ScriptVersionAttribution | undefined,
): NormalizedScriptVersionAttribution {
  const author = attribution?.author ?? "human";
  if (author === "human") {
    return {
      author,
      authorAgentId: null,
      agentRequestId: null,
      agentRequestHash: null,
    };
  }
  return {
    author,
    authorAgentId: normalizeAgentId(attribution?.authorAgentId),
    agentRequestId: normalizeAgentId(attribution?.agentRequestId),
    agentRequestHash: normalizeAgentId(attribution?.agentRequestHash),
  };
}

function isVersionNumberConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") {
    return false;
  }
  const target = (candidate.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) {
    return target.includes("versionNumber");
  }
  if (typeof target === "string") {
    return target.includes("versionNumber");
  }
  return target === undefined;
}

async function validateAssetReferences(
  client: PrismaClient | Prisma.TransactionClient,
  content: ContentDocument,
): Promise<void> {
  const hasExpressions = content.scenes.some((scene) =>
    scene.lines.some((line) => line.expressionId !== null),
  );
  if (
    content.audioTakes.length === 0 &&
    collectAssetReferences(content).length === 0 &&
    collectFaceSetIds(content).length === 0 &&
    !hasExpressions
  ) {
    return;
  }
  const { references, assetById, faceSetById } = await loadAllReferences(
    client,
    content,
  );
  assertAssetsAvailable(references, assetById);
  assertTakeDurations(content, assetById);
  assertInsertScenes(content, assetById);
  assertVideoPlayback(content, assetById);
  assertFaceSetReferences(content, faceSetById, assetById);
}

function storedVisualTheme(
  contentJson: string,
): ContentDocument["visualTheme"] | undefined {
  try {
    const parsed = JSON.parse(contentJson) as {
      visualTheme?: { id?: unknown; version?: unknown };
    };
    const id = parsed.visualTheme?.id;
    const version = parsed.visualTheme?.version;
    return typeof id === "string" && typeof version === "number"
      ? { id, version }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function saveScriptVersion(
  prisma: PrismaClient,
  editionId: string,
  input: SaveScriptVersionRequest,
  attribution?: ScriptVersionAttribution,
  guard?: SaveScriptVersionGuard,
  options?: SaveScriptVersionOptions,
): Promise<SaveScriptVersionResult> {
  const edition = await requireEdition(prisma, editionId);
  const { content, sourceScriptVersionId } = input;
  const versionAttribution = normalizeScriptVersionAttribution(attribution);

  if (content.locale !== edition.locale) {
    throw validationError([
      {
        path: ["content", "locale"],
        code: "invalid_value",
        message: `言語版のロケール(${edition.locale})と一致しません。`,
      },
    ]);
  }

  let transitionIssues: ReturnType<typeof collectTimelineIssues> = [];
  try {
    transitionIssues = collectTimelineIssues(content);
  } catch (error) {
    throwIfFatalTimelineError(error);
  }
  if (transitionIssues.length > 0) {
    throw validationError(
      transitionIssues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  const compositionVersionIds = collectCompositionVersionIds(content);
  const compositionDurations = await getCompositionDurationsByVersionId(
    prisma,
    compositionVersionIds,
  );
  const missingCompositionVersionIds = compositionVersionIds.filter(
    (versionId) => !compositionDurations.has(versionId),
  );
  if (missingCompositionVersionIds.length > 0) {
    const cuePathByVersionId = new Map<string, (string | number)[]>();
    content.scenes.forEach((scene, sceneIndex) => {
      scene.visualCues.forEach((cue, cueIndex) => {
        if (cue.template.id !== "composition.full-bleed") {
          return;
        }
        const parsedInput = compositionFullBleedInputSchema.safeParse(
          cue.input,
        );
        if (!parsedInput.success) {
          return;
        }
        const versionId = parsedInput.data.compositionVersionId;
        if (!cuePathByVersionId.has(versionId)) {
          cuePathByVersionId.set(versionId, [
            "scenes",
            sceneIndex,
            "visualCues",
            cueIndex,
            "input",
            "compositionVersionId",
          ]);
        }
      });
    });
    throw validationError(
      missingCompositionVersionIds.map((versionId) => ({
        path: cuePathByVersionId.get(versionId) ?? ["compositions", versionId],
        code: "invalid_value",
        message: `CompositionVersionが見つかりません: ${versionId}`,
      })),
    );
  }

  const compositionProfiles = await getCompositionCanvasProfilesByVersionId(
    prisma,
    compositionVersionIds,
  );
  const portraitIssues: ValidationIssue[] = [];
  content.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      if (cue.template.id !== "composition.full-bleed") {
        return;
      }
      const parsedInput = compositionFullBleedInputSchema.safeParse(cue.input);
      if (!parsedInput.success) {
        return;
      }
      if (
        compositionProfiles.get(parsedInput.data.compositionVersionId) ===
        "portrait"
      ) {
        portraitIssues.push({
          path: [
            "scenes",
            sceneIndex,
            "visualCues",
            cueIndex,
            "input",
            "compositionVersionId",
          ],
          code: "invalid_value",
          message:
            "composition.full-bleed@1 には横長(landscape)のCompositionVersionだけを指定できます。縦型はscene.device-frame@1の画面に配置してください。",
        });
      }
    });
  });
  if (portraitIssues.length > 0) {
    throw validationError(portraitIssues);
  }
  let compositionWindowIssues: ReturnType<
    typeof collectCompositionWindowIssues
  > = [];
  try {
    compositionWindowIssues = collectCompositionWindowIssues(
      content,
      compositionDurations,
    );
  } catch (error) {
    throwIfFatalTimelineError(error);
  }
  if (compositionWindowIssues.length > 0) {
    throw validationError(
      compositionWindowIssues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  if (sourceScriptVersionId !== null) {
    const source = await prisma.scriptVersion.findUnique({
      where: { id: sourceScriptVersionId },
      select: { languageEditionId: true },
    });
    if (source === null || source.languageEditionId !== editionId) {
      throw validationError([
        {
          path: ["sourceScriptVersionId"],
          code: "invalid_value",
          message: "復元元は同じ言語版の版を指定してください。",
        },
      ]);
    }
  }

  let offsetWarnings: Warning[] = [];
  try {
    offsetWarnings = collectOffsetRangeWarnings(content);
  } catch (error) {
    throwIfFatalTimelineError(error);
  }
  const warnings = [
    ...computeContentWarnings(content),
    ...offsetWarnings,
    ...(await collectInsertWarnings(prisma, content)),
  ];
  const contentJson = serializeContent(content);

  const maxAttempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const currentEdition = await tx.languageEdition.findUnique({
          where: { id: editionId },
          select: { currentScriptVersionId: true },
        });
        if (
          guard !== undefined &&
          (currentEdition === null ||
            currentEdition.currentScriptVersionId !==
              guard.expectedCurrentScriptVersionId)
        ) {
          throw guard.staleError();
        }

        const enforceSelectableTheme =
          options?.enforceSelectableTheme !== false;
        let currentTheme: ContentDocument["visualTheme"] | undefined;
        const currentVersionId = currentEdition?.currentScriptVersionId;
        if (
          enforceSelectableTheme &&
          currentVersionId !== null &&
          currentVersionId !== undefined
        ) {
          const currentRow = await tx.scriptVersion.findUnique({
            where: { id: currentVersionId },
            select: { contentJson: true },
          });
          if (currentRow !== null) {
            currentTheme = storedVisualTheme(currentRow.contentJson);
          }
        }
        const keepsCurrentTheme =
          currentTheme !== undefined &&
          currentTheme.id === content.visualTheme.id &&
          currentTheme.version === content.visualTheme.version;
        const themeResolver = new ThemeResolver(tx);
        let resolvedTheme: VisualThemeDefinition | undefined;
        if (enforceSelectableTheme && !keepsCurrentTheme) {
          resolvedTheme = await themeResolver.resolveSelectable(
            content.visualTheme.id,
            content.visualTheme.version,
          );
          if (!resolvedTheme) {
            throw validationError([
              {
                path: ["visualTheme"],
                code: "invalid_value",
                message:
                  "新しく選択できるVisual Themeは、組み込みThemeまたは未アーカイブThemeの最新Revisionだけです。",
              },
            ]);
          }
        } else {
          resolvedTheme = await themeResolver.resolve(
            content.visualTheme.id,
            content.visualTheme.version,
          );
        }
        if (!resolvedTheme) {
          throw validationError([
            {
              path: ["visualTheme"],
              code: "invalid_value",
              message: `Visual Themeが見つかりません: ${content.visualTheme.id}@${content.visualTheme.version}`,
            },
          ]);
        }
        await validateAssetReferences(tx, content);
        const aggregate = await tx.scriptVersion.aggregate({
          where: { languageEditionId: editionId },
          _max: { versionNumber: true },
        });
        const versionNumber = (aggregate._max.versionNumber ?? 0) + 1;
        const row = await tx.scriptVersion.create({
          data: {
            languageEditionId: editionId,
            versionNumber,
            contentSchemaVersion: content.schemaVersion,
            contentJson,
            sourceScriptVersionId,
            author: versionAttribution.author,
            authorAgentId: versionAttribution.authorAgentId,
            agentRequestId: versionAttribution.agentRequestId,
            agentRequestHash: versionAttribution.agentRequestHash,
          },
        });
        const advanced = await tx.languageEdition.updateMany({
          where:
            guard === undefined
              ? { id: editionId }
              : {
                  id: editionId,
                  currentScriptVersionId: guard.expectedCurrentScriptVersionId,
                },
          data: { currentScriptVersionId: row.id },
        });
        if (advanced.count === 0) {
          throw guard === undefined
            ? resourceNotFound("language_edition", editionId)
            : guard.staleError();
        }
        await tx.work.update({
          where: { id: edition.workId },
          data: { updatedAt: new Date() },
        });
        return row;
      });
      return {
        scriptVersion: toScriptVersion(
          created,
          deserializeContent(contentJson),
        ),
        warnings,
      };
    } catch (error) {
      if (attempt < maxAttempts && isVersionNumberConflict(error)) {
        continue;
      }
      throw error;
    }
  }
}
