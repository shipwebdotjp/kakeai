import type {
  ContentDocument,
  ScriptOperation,
  VisualCue,
  Warning,
} from "@kakeai/contracts";
import {
  characterStandingV1,
  characterStandingV1InputSchema,
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
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
  STANDING_EDGE_VALUES,
  STANDING_VERTICAL_VALUES,
  normalizeStandingEnum,
  type CueFormValue,
  type DocumentFormValues,
  type StandingEdge,
  type StandingFormValue,
  type StandingSide,
  type StandingVertical,
} from "./form";

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

function emptyResult(document: ContentDocument): ScriptOperationResult {
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

function buildStructuralDocument(
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

function removeCueFromValues(
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

function applyToDocument(
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

function standingSideOf(cue: VisualCue): StandingSide | null {
  if (
    cue.template.id !== characterStandingV1.id ||
    cue.template.version !== characterStandingV1.version
  ) {
    return null;
  }
  const parsed = characterStandingV1InputSchema.safeParse(cue.input);
  return parsed.success ? parsed.data.side : null;
}

function normalizeTransitionEdge(
  preset: StandingFormValue["enterPreset"],
  durationMs: number,
): { preset: StandingFormValue["enterPreset"]; durationMs: number } {
  if (preset === "none") {
    return { preset, durationMs: 0 };
  }
  return {
    preset,
    durationMs: Number.isFinite(durationMs)
      ? Math.max(1, Math.floor(durationMs))
      : 1,
  };
}

export function commitStandingStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  side: StandingSide,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralDocument(base, values);
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  const formScene = values.scenes.find((entry) => entry.id === sceneId);
  const standing = formScene?.standings.find((entry) => entry.side === side);
  if (scene === undefined || standing === undefined) {
    return null;
  }

  if (standing.characterId === null || standing.appearanceId === null) {
    if (scene.visualCues.some((cue) => standingSideOf(cue) === side)) {
      return applyToDocument(
        document,
        values,
        [{ op: "standing.remove", sceneId, side }],
        assets,
      );
    }
    if (standing.cueId === null) {
      return null;
    }
    return {
      values: toFormValues(document),
      document,
      result: emptyResult(document),
    };
  }

  const scale =
    Number.isFinite(standing.scale) && standing.scale > 0
      ? standing.scale
      : 1;
  const edge = normalizeStandingEnum(standing.edge, STANDING_EDGE_VALUES, DEFAULT_STANDING_EDGE);
  const vertical = normalizeStandingEnum(
    standing.vertical,
    STANDING_VERTICAL_VALUES,
    DEFAULT_STANDING_VERTICAL,
  );
  return applyToDocument(
    document,
    values,
    [
      {
        op: "standing.set",
        sceneId,
        side,
        characterId: standing.characterId,
        appearanceId: standing.appearanceId,
        scale,
        edge,
        vertical,
        transition: {
          enter: normalizeTransitionEdge(
            standing.enterPreset,
            standing.enterDurationMs,
          ),
          exit: normalizeTransitionEdge(
            standing.exitPreset,
            standing.exitDurationMs,
          ),
        },
      },
    ],
    assets,
  );
}

export function commitSceneAudioStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  cueIndex: number,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralDocument(base, values);
  const formScene = values.scenes.find((entry) => entry.id === sceneId);
  const slot = formScene?.audioCues[cueIndex];
  if (formScene === undefined || slot === undefined) {
    return null;
  }
  const sceneAudioCues = document.audioCues.filter(
    (cue) =>
      cue.range.kind === "scene" && cue.range.sceneId === sceneId,
  );
  const existing =
    slot.cueId !== null
      ? document.audioCues.find((cue) => cue.id === slot.cueId)
      : sceneAudioCues.find(
          (cue) =>
            cue.assetId === slot.assetId && cue.role === slot.role,
        ) ?? sceneAudioCues[cueIndex];

  if (slot.assetId === null) {
    if (existing !== undefined) {
      return applyToDocument(
        document,
        values,
        [{ op: "audio.remove", audioCueId: existing.id }],
        assets,
      );
    }
    if (slot.cueId === null) {
      return null;
    }
    return {
      values: toFormValues(document),
      document,
      result: emptyResult(document),
    };
  }

  if (existing === undefined) {
    return applyToDocument(
      document,
      values,
      [
        {
          op: "audio.add",
          role: slot.role,
          assetId: slot.assetId,
          range: { kind: "scene", sceneId },
          gainDb: slot.gainDb,
          loop: slot.loop,
        },
      ],
      assets,
    );
  }

  return applyToDocument(
    document,
    values,
    [
      {
        op: "audio.set",
        audioCueId: existing.id,
        role: slot.role,
        assetId: slot.assetId,
        range: { kind: "scene", sceneId },
        gainDb: slot.gainDb,
        loop: slot.loop,
      },
    ],
    assets,
  );
}

export function commitBgmStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralDocument(base, values);
  const existing =
    (values.bgm.cueId === null
      ? undefined
      : document.audioCues.find((cue) => cue.id === values.bgm.cueId)) ??
    document.audioCues.find(
      (cue) => cue.role === "bgm" && cue.range.kind === "work",
    );

  if (values.bgm.assetId === null) {
    if (existing !== undefined) {
      return applyToDocument(
        document,
        values,
        [{ op: "audio.remove", audioCueId: existing.id }],
        assets,
      );
    }
    if (values.bgm.cueId === null) {
      return null;
    }
    return {
      values: toFormValues(document),
      document,
      result: emptyResult(document),
    };
  }

  if (existing === undefined) {
    return applyToDocument(
      document,
      values,
      [
        {
          op: "audio.add",
          role: "bgm",
          assetId: values.bgm.assetId,
          range: { kind: "work" },
          gainDb: values.bgm.gainDb,
          loop: values.bgm.loop,
        },
      ],
      assets,
    );
  }

  return applyToDocument(
    document,
    values,
    [
      {
        op: "audio.set",
        audioCueId: existing.id,
        role: "bgm",
        assetId: values.bgm.assetId,
        range: { kind: "work" },
        gainDb: values.bgm.gainDb,
        loop: values.bgm.loop,
      },
    ],
    assets,
  );
}

export function commitCueStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  cueId: string,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralDocument(base, values);
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  const cue = scene?.visualCues.find((entry) => entry.id === cueId);
  if (cue === undefined) {
    return null;
  }
  return applyToDocument(
    document,
    values,
    [
      { op: "cue.setRange", sceneId, cueId, range: cue.range },
      {
        op: "cue.setInput",
        sceneId,
        cueId,
        input: cue.input,
        replace: true,
      },
      {
        op: "cue.setPlacement",
        sceneId,
        cueId,
        layer: cue.layer,
        order: cue.order,
      },
      {
        op: "cue.setTransition",
        sceneId,
        cueId,
        enter: cue.transition.enter,
        exit: cue.transition.exit,
      },
    ],
    assets,
  );
}

export function removeCueStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  sceneId: string,
  cueId: string,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  let document: ContentDocument;
  try {
    document = buildStructuralDocument(base, values);
  } catch (error) {
    const withoutCue = removeCueFromValues(values, sceneId, cueId);
    try {
      const fallbackDocument = buildStructuralDocument(base, withoutCue);
      return {
        values: withoutCue,
        document: fallbackDocument,
        result: emptyResult(fallbackDocument),
      };
    } catch {
      throw error;
    }
  }
  const scene = document.scenes.find((entry) => entry.id === sceneId);
  if (scene === undefined) {
    return null;
  }
  if (!scene.visualCues.some((cue) => cue.id === cueId)) {
    // 未確定Cueは正本文書に存在しないため、フォームからのみ除去する。
    return {
      values: removeCueFromValues(values, sceneId, cueId),
      document,
      result: emptyResult(document),
    };
  }
  return applyToDocument(
    document,
    values,
    [{ op: "cue.remove", sceneId, cueId }],
    assets,
  );
}
