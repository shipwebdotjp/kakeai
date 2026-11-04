import { isDeepStrictEqual } from "node:util";
import type {
  AgentScriptDiffOutput,
  ContentDocument,
  NarrationSegment,
  VisualCue,
} from "@kakeai/contracts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { ApiError } from "../../http/errors.ts";
import { resourceNotFound, validationError } from "../../http/validation.ts";
import { deserializeContent } from "../../domain/content-json.ts";

type Scene = ContentDocument["scenes"][number];
type ChildDiff = AgentScriptDiffOutput["lines"];
type StructuralDiff = Pick<
  AgentScriptDiffOutput,
  "scenes" | "lines" | "cues" | "outsideScopeChangedFields"
>;

/** A child element with the parent scene and its position inside that scene. */
interface PlacedChild<T> {
  value: T;
  sceneId: string;
  index: number;
}

const CHILD_EXCLUDED_FIELDS = new Set(["id"]);
const SCENE_EXCLUDED_FIELDS = new Set(["id", "lines", "visualCues"]);

function asRecord(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

/**
 * The stable top-level field names whose values differ. IDs and position are
 * never part of the result: identity is the ID and position is reported as
 * `moved`. Fields are sorted so the result does not depend on key insertion
 * order.
 */
function changedFieldNames(
  from: Record<string, unknown>,
  to: Record<string, unknown>,
  excluded: ReadonlySet<string>,
): string[] {
  const names = new Set([...Object.keys(from), ...Object.keys(to)]);
  return [...names]
    .filter((name) => !excluded.has(name))
    .filter((name) => !isDeepStrictEqual(from[name], to[name]))
    .sort();
}

function sceneSummary(
  scene: Scene,
  index: number,
): AgentScriptDiffOutput["scenes"]["added"][number] {
  return {
    id: scene.id,
    index,
    lineCount: scene.lines.length,
    cueCount: scene.visualCues.length,
  };
}

function placeLines(
  document: ContentDocument,
): Map<string, PlacedChild<NarrationSegment>> {
  const placed = new Map<string, PlacedChild<NarrationSegment>>();
  for (const scene of document.scenes) {
    scene.lines.forEach((line, index) => {
      placed.set(line.id, { value: line, sceneId: scene.id, index });
    });
  }
  return placed;
}

function placeCues(document: ContentDocument): Map<string, PlacedChild<VisualCue>> {
  const placed = new Map<string, PlacedChild<VisualCue>>();
  for (const scene of document.scenes) {
    scene.visualCues.forEach((cue, index) => {
      placed.set(cue.id, { value: cue, sceneId: scene.id, index });
    });
  }
  return placed;
}

function childEntry(
  id: string,
  placement: { sceneId: string; index: number },
): ChildDiff["added"][number] {
  return { id, sceneId: placement.sceneId, index: placement.index };
}

/**
 * Compares one child collection (lines or cues). A child of a scene that was
 * added or removed is not listed a second time as added or removed; only
 * children that appear or disappear between scenes present on both sides are
 * reported.
 */
function diffChildren<T extends { id: string }>(
  from: Map<string, PlacedChild<T>>,
  to: Map<string, PlacedChild<T>>,
  fromSceneIds: ReadonlySet<string>,
  toSceneIds: ReadonlySet<string>,
): ChildDiff {
  const added: ChildDiff["added"] = [];
  for (const [id, placement] of to) {
    if (!from.has(id) && fromSceneIds.has(placement.sceneId)) {
      added.push(childEntry(id, placement));
    }
  }

  const removed: ChildDiff["removed"] = [];
  for (const [id, placement] of from) {
    if (!to.has(id) && toSceneIds.has(placement.sceneId)) {
      removed.push(childEntry(id, placement));
    }
  }

  const updated: ChildDiff["updated"] = [];
  const moved: ChildDiff["moved"] = [];
  for (const [id, toPlacement] of to) {
    const fromPlacement = from.get(id);
    if (fromPlacement === undefined) {
      continue;
    }
    const changedFields = changedFieldNames(
      asRecord(fromPlacement.value),
      asRecord(toPlacement.value),
      CHILD_EXCLUDED_FIELDS,
    );
    if (changedFields.length > 0) {
      updated.push({ id, sceneId: toPlacement.sceneId, changedFields });
    }
    if (
      fromPlacement.sceneId !== toPlacement.sceneId ||
      fromPlacement.index !== toPlacement.index
    ) {
      moved.push({
        id,
        fromSceneId: fromPlacement.sceneId,
        toSceneId: toPlacement.sceneId,
        fromIndex: fromPlacement.index,
        toIndex: toPlacement.index,
      });
    }
  }

  return { added, removed, updated, moved };
}

/**
 * The structural difference between two ContentDocuments of the same
 * Language Edition. Only scenes, lines and visual cues are compared by ID;
 * every other top-level field is reported by name in
 * `outsideScopeChangedFields`.
 */
export function diffScriptContents(
  from: ContentDocument,
  to: ContentDocument,
): StructuralDiff {
  const fromSceneIndex = new Map(
    from.scenes.map((scene, index) => [scene.id, index]),
  );
  const toSceneIndex = new Map(to.scenes.map((scene, index) => [scene.id, index]));

  const scenes: AgentScriptDiffOutput["scenes"] = {
    added: [],
    removed: [],
    updated: [],
    moved: [],
  };

  for (const [index, scene] of to.scenes.entries()) {
    const fromIndex = fromSceneIndex.get(scene.id);
    if (fromIndex === undefined) {
      scenes.added.push(sceneSummary(scene, index));
      continue;
    }
    const fromScene = from.scenes[fromIndex];
    if (fromScene === undefined) {
      continue;
    }
    const changedFields = changedFieldNames(
      asRecord(fromScene),
      asRecord(scene),
      SCENE_EXCLUDED_FIELDS,
    );
    if (changedFields.length > 0) {
      scenes.updated.push({ id: scene.id, changedFields });
    }
    if (fromIndex !== index) {
      scenes.moved.push({ id: scene.id, fromIndex, toIndex: index });
    }
  }
  for (const [index, scene] of from.scenes.entries()) {
    if (!toSceneIndex.has(scene.id)) {
      scenes.removed.push(sceneSummary(scene, index));
    }
  }

  const fromSceneIds = new Set(fromSceneIndex.keys());
  const toSceneIds = new Set(toSceneIndex.keys());
  return {
    scenes,
    lines: diffChildren(
      placeLines(from),
      placeLines(to),
      fromSceneIds,
      toSceneIds,
    ),
    cues: diffChildren(
      placeCues(from),
      placeCues(to),
      fromSceneIds,
      toSceneIds,
    ),
    outsideScopeChangedFields: changedFieldNames(
      asRecord(from),
      asRecord(to),
      new Set(["scenes"]),
    ),
  };
}

/**
 * Reads two saved Script Versions and compares them. Both versions must belong
 * to the same Language Edition. The result carries only version summaries and
 * structural differences; detailed values stay in `script.get`.
 */
export async function diffScriptVersions(
  prisma: PrismaClient,
  fromScriptVersionId: string,
  toScriptVersionId: string,
): Promise<AgentScriptDiffOutput> {
  const [fromRow, toRow] = await Promise.all([
    prisma.scriptVersion.findUnique({
      where: { id: fromScriptVersionId },
      select: {
        id: true,
        versionNumber: true,
        languageEditionId: true,
        contentJson: true,
      },
    }),
    prisma.scriptVersion.findUnique({
      where: { id: toScriptVersionId },
      select: {
        id: true,
        versionNumber: true,
        languageEditionId: true,
        contentJson: true,
      },
    }),
  ]);
  if (fromRow === null) {
    throw resourceNotFound("script_version", fromScriptVersionId);
  }
  if (toRow === null) {
    throw resourceNotFound("script_version", toScriptVersionId);
  }
  if (fromRow.languageEditionId !== toRow.languageEditionId) {
    throw validationError([
      {
        path: ["toScriptVersionId"],
        code: "invalid_value",
        message: "同じ言語版に属する台本版を比較してください。",
      },
    ]);
  }

  let fromContent: ContentDocument;
  let toContent: ContentDocument;
  try {
    fromContent = deserializeContent(fromRow.contentJson);
    toContent = deserializeContent(toRow.contentJson);
  } catch {
    // A stored version that no longer parses is corrupt data, not a bad
    // request. Match the existing script-version readers.
    throw new ApiError(500, "INTERNAL_ERROR", "保存済みの台本を解釈できません。");
  }

  return {
    fromScriptVersion: {
      id: fromRow.id,
      versionNumber: fromRow.versionNumber,
    },
    toScriptVersion: {
      id: toRow.id,
      versionNumber: toRow.versionNumber,
    },
    ...diffScriptContents(fromContent, toContent),
  };
}
