import type {
  ContentDocument,
  ScriptOperation,
  Warning,
} from "@kakeai/contracts";
import {
  applyScriptOperations,
  createIdGenerator,
  type ScriptAssetInfo,
  type ScriptContext,
  type ScriptOperationResult,
} from "@kakeai/script-edits";
import {
  buildContentDocument,
  pruneDraftCueForLines,
  toFormValues,
  type CueFormValue,
  type DocumentFormValues,
} from "../form";

export interface StructuralAsset {
  id: string;
  kind: "image" | "video" | "audio";
  status: "processing" | "ready" | "failed";
  durationMs: number | null;
  hasAudio: boolean;
}

export interface StructuralEditResult {
  values: DocumentFormValues;
  document: ContentDocument;
  result: ScriptOperationResult;
}

function createScriptContext(
  assets: readonly StructuralAsset[],
): ScriptContext {
  const assetById = new Map<string, ScriptAssetInfo>(
    assets.map((asset) => [
      asset.id,
      {
        kind: asset.kind,
        status: asset.status,
        durationMs: asset.durationMs,
        hasAudio: asset.hasAudio,
      },
    ]),
  );
  return {
    assets: { get: (assetId) => assetById.get(assetId) ?? null },
    ids: createIdGenerator(),
  };
}

export function emptyResult(document: ContentDocument): ScriptOperationResult {
  return {
    document,
    created: {
      sceneIds: [],
      lineIds: [],
      cueIds: [],
      audioCueIds: [],
      audioTakeIds: [],
      characterIds: [],
      appearanceIds: [],
      speakerIds: [],
    },
    warnings: [],
  };
}

export function buildStructuralDocument(
  base: ContentDocument,
  values: DocumentFormValues,
): ContentDocument {
  return buildContentDocument(base, values, { tolerant: true });
}

interface DraftCueEntry {
  cue: CueFormValue;
  index: number;
}

function collectDraftCues(
  values: DocumentFormValues,
  document: ContentDocument,
): Map<string, DraftCueEntry[]> {
  const builtCueIds = new Set(
    document.scenes.flatMap((scene) => scene.visualCues.map((cue) => cue.id)),
  );
  const bySceneId = new Map<string, DraftCueEntry[]>();
  for (const scene of values.scenes) {
    const drafts = scene.cues.flatMap((cue, index) =>
      builtCueIds.has(cue.id) ? [] : [{ cue, index }],
    );
    if (drafts.length > 0) {
      bySceneId.set(scene.id, drafts);
    }
  }
  return bySceneId;
}

export function removeCueFromValues(
  values: DocumentFormValues,
  sceneId: string,
  cueId: string,
): DocumentFormValues {
  return {
    ...values,
    scenes: values.scenes.map((entry) =>
      entry.id === sceneId
        ? { ...entry, cues: entry.cues.filter((cue) => cue.id !== cueId) }
        : entry,
    ),
  };
}

export function applyToDocument(
  document: ContentDocument,
  values: DocumentFormValues,
  operations: readonly ScriptOperation[],
  assets: readonly StructuralAsset[],
): StructuralEditResult {
  const drafts = collectDraftCues(values, document);
  const result = applyScriptOperations(
    document,
    operations,
    createScriptContext(assets),
  );
  const nextValues = toFormValues(result.document);
  const draftWarnings: Warning[] = [];

  for (const [sceneIndex, scene] of nextValues.scenes.entries()) {
    const sceneDrafts = drafts.get(scene.id);
    if (sceneDrafts === undefined) {
      continue;
    }
    const lineIds = new Set(scene.lines.map((line) => line.id));
    const merged = [...scene.cues];
    for (const { cue: draft, index } of [...sceneDrafts].sort(
      (left, right) => left.index - right.index,
    )) {
      const pruned = pruneDraftCueForLines(draft, lineIds);
      let restored = pruned;
      if (
        pruned.rangeKind === "lines" &&
        (!lineIds.has(pruned.startLineId) || !lineIds.has(pruned.endLineId))
      ) {
        draftWarnings.push({
          path: ["scenes", sceneIndex, "cues", draft.id],
          code: "draft_cue_range_reset",
          message: `行の変更で未確定Cueの範囲をScene全体へ戻しました: ${draft.id}`,
        });
        restored = {
          ...pruned,
          rangeKind: "scene",
          startLineId: "",
          endLineId: "",
          startMs: 0,
          endMs: 0,
        };
      }
      merged.splice(Math.min(index, merged.length), 0, restored);
    }
    scene.cues = merged;
  }

  return {
    values: nextValues,
    document: result.document,
    result: {
      ...result,
      warnings: [...result.warnings, ...draftWarnings],
    },
  };
}

export function buildStructuralOrNull(
  base: ContentDocument,
  values: DocumentFormValues,
): ContentDocument | null {
  try {
    return buildStructuralDocument(base, values);
  } catch (error) {
    console.error("buildStructuralDocument failed", error);
    return null;
  }
}

export function hasValidTransferTargets(
  document: ContentDocument,
  fromSceneId: string,
  toSceneIds: readonly string[],
): boolean {
  return !(
    toSceneIds.length === 0 ||
    new Set(toSceneIds).size !== toSceneIds.length ||
    toSceneIds.some(
      (toSceneId) =>
        toSceneId === fromSceneId ||
        !document.scenes.some((entry) => entry.id === toSceneId),
    )
  );
}

export function applyStructuralOperations(
  base: ContentDocument,
  values: DocumentFormValues,
  operations: readonly ScriptOperation[],
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult {
  return applyToDocument(
    buildStructuralDocument(base, values),
    values,
    operations,
    assets,
  );
}

export function applyStructuralOperation(
  base: ContentDocument,
  values: DocumentFormValues,
  operation: ScriptOperation,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult {
  return applyStructuralOperations(base, values, [operation], assets);
}
