import {
  applyToDocument,
  buildStructuralDocument,
  buildStructuralOrNull,
  emptyResult,
  hasValidTransferTargets,
  type StructuralAsset,
  type StructuralEditResult,
} from "./common";
import type {
  ContentDocument,
  ScriptOperation,
  VisualCue,
} from "@kakeai/contracts";
import {
  characterStandingV1,
  characterStandingV1InputSchema,
} from "@kakeai/contracts";
import {
  toFormValues,
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
  STANDING_EDGE_VALUES,
  STANDING_VERTICAL_VALUES,
  normalizeStandingEnum,
  type DocumentFormValues,
  type StandingFormValue,
  type StandingSide,
} from "../form";

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
    Number.isFinite(standing.scale) && standing.scale > 0 ? standing.scale : 1;
  const edge = normalizeStandingEnum(
    standing.edge,
    STANDING_EDGE_VALUES,
    DEFAULT_STANDING_EDGE,
  );
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
        op: "standing.upsert",
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
    (cue) => cue.range.kind === "scene" && cue.range.sceneId === sceneId,
  );
  const existing =
    slot.cueId !== null
      ? document.audioCues.find((cue) => cue.id === slot.cueId)
      : (sceneAudioCues.find(
          (cue) => cue.assetId === slot.assetId && cue.role === slot.role,
        ) ?? sceneAudioCues[cueIndex]);

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
        op: "audio.update",
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

export type StandingTransferMode = "move" | "copy" | "swap";

function standingSlotOperation(
  targetSceneId: string,
  slot: StandingFormValue | undefined,
  targetHasSide: (side: StandingSide) => boolean,
): ScriptOperation | null {
  if (slot === undefined) {
    return null;
  }
  if (slot.characterId !== null && slot.appearanceId !== null) {
    const scale =
      Number.isFinite(slot.scale) && slot.scale > 0 ? slot.scale : 1;
    const edge = normalizeStandingEnum(
      slot.edge,
      STANDING_EDGE_VALUES,
      DEFAULT_STANDING_EDGE,
    );
    const vertical = normalizeStandingEnum(
      slot.vertical,
      STANDING_VERTICAL_VALUES,
      DEFAULT_STANDING_VERTICAL,
    );
    return {
      op: "standing.upsert",
      sceneId: targetSceneId,
      side: slot.side,
      characterId: slot.characterId,
      appearanceId: slot.appearanceId,
      scale,
      edge,
      vertical,
      transition: {
        enter: normalizeTransitionEdge(slot.enterPreset, slot.enterDurationMs),
        exit: normalizeTransitionEdge(slot.exitPreset, slot.exitDurationMs),
      },
    };
  }
  if (targetHasSide(slot.side)) {
    return { op: "standing.remove", sceneId: targetSceneId, side: slot.side };
  }
  return null;
}

function standingCopyOperations(
  document: ContentDocument,
  formFrom: DocumentFormValues["scenes"][number],
  toSceneId: string,
): ScriptOperation[] {
  const operations: ScriptOperation[] = [];
  const target = document.scenes.find((entry) => entry.id === toSceneId);
  for (const side of ["left", "right"] as const) {
    const sourceSlot = formFrom.standings.find((entry) => entry.side === side);
    const operation = standingSlotOperation(
      toSceneId,
      sourceSlot,
      (candidate) =>
        target?.visualCues.some((cue) => standingSideOf(cue) === candidate) ??
        false,
    );
    if (operation !== null) {
      operations.push(operation);
    }
  }
  return operations;
}

function formSceneHasStandings(
  document: ContentDocument,
  formScene: DocumentFormValues["scenes"][number],
  sceneId: string,
): boolean {
  return (["left", "right"] as const).some((side) => {
    const slot = formScene.standings.find((entry) => entry.side === side);
    if (
      slot !== undefined &&
      slot.characterId !== null &&
      slot.appearanceId !== null
    ) {
      return true;
    }
    return (
      document.scenes
        .find((entry) => entry.id === sceneId)
        ?.visualCues.some((cue) => standingSideOf(cue) === side) ?? false
    );
  });
}

export function transferStandingsStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  fromSceneId: string,
  toSceneId: string,
  mode: StandingTransferMode,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  if (fromSceneId === toSceneId) {
    return null;
  }
  const document = buildStructuralOrNull(base, values);
  if (document === null) {
    return null;
  }
  const formFrom = values.scenes.find((entry) => entry.id === fromSceneId);
  const formTo = values.scenes.find((entry) => entry.id === toSceneId);
  if (formFrom === undefined || formTo === undefined) {
    return null;
  }
  const hasSide = (sceneId: string, side: StandingSide): boolean =>
    document.scenes
      .find((entry) => entry.id === sceneId)
      ?.visualCues.some((cue) => standingSideOf(cue) === side) ?? false;

  const sourceHasStanding = formSceneHasStandings(
    document,
    formFrom,
    fromSceneId,
  );
  if ((mode === "move" || mode === "copy") && !sourceHasStanding) {
    return null;
  }

  const operations: ScriptOperation[] = [
    ...standingCopyOperations(document, formFrom, toSceneId),
  ];
  if (mode === "swap") {
    // 逆方向の操作は操作前のformToスロットから構築するため、
    // 正方向のstanding.set/removeの結果に依存しない。
    // standing.setは指定sideを上書きするため、正方向と逆方向の適用で完全な入れ替えになる。
    for (const side of ["left", "right"] as const) {
      const targetSlot = formTo.standings.find((entry) => entry.side === side);
      const operation = standingSlotOperation(
        fromSceneId,
        targetSlot,
        (candidate) => hasSide(fromSceneId, candidate),
      );
      if (operation !== null) {
        operations.push(operation);
      }
    }
  } else if (mode === "move") {
    for (const side of ["left", "right"] as const) {
      if (hasSide(fromSceneId, side)) {
        operations.push({ op: "standing.remove", sceneId: fromSceneId, side });
      }
    }
  }
  if (operations.length === 0) {
    return null;
  }
  return applyToDocument(document, values, operations, assets);
}

export function copyStandingsStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  fromSceneId: string,
  toSceneIds: readonly string[],
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult | null {
  const document = buildStructuralOrNull(base, values);
  if (document === null) {
    return null;
  }
  const formFrom = values.scenes.find((entry) => entry.id === fromSceneId);
  if (formFrom === undefined) {
    return null;
  }
  if (!hasValidTransferTargets(document, fromSceneId, toSceneIds)) {
    return null;
  }
  if (!formSceneHasStandings(document, formFrom, fromSceneId)) {
    return null;
  }
  const operations = toSceneIds.flatMap((toSceneId) =>
    standingCopyOperations(document, formFrom, toSceneId),
  );
  if (operations.length === 0) {
    return null;
  }
  return applyToDocument(document, values, operations, assets);
}
