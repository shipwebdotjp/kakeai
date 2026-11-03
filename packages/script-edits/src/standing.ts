import {
  characterStandingV1,
  characterStandingV1InputSchema,
  sortStandingStates,
  type ContentDocument,
  type StandingEdge,
  type StandingSide,
  type StandingState,
  type StandingVertical,
  type VisualCue,
  type Warning,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import { targetNotFound } from "./errors.ts";
import { withScene } from "./line-utils.ts";
import { findEditableScene, parseCue } from "./cue.ts";
import type { SceneEditResult } from "./scene.ts";

export interface StandingEditResult extends SceneEditResult {
  warnings?: Warning[];
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

function findStandingIndex(
  document: ContentDocument,
  sceneId: string,
  side: StandingSide,
): { sceneIndex: number; cueIndex: number; scene: ContentDocument["scenes"][number] } {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const cueIndex = scene.visualCues.findIndex(
    (cue) => standingSideOf(cue) === side,
  );
  return { scene, sceneIndex, cueIndex };
}

export function upsertStanding(
  document: ContentDocument,
  sceneId: string,
  side: StandingSide,
  characterId: string,
  appearanceId: string,
  scale: number | null | undefined,
  transition: VisualCue["transition"] | undefined,
  context: ScriptContext,
  edge?: StandingEdge | null,
  vertical?: StandingVertical | null,
): StandingEditResult {
  const { scene, sceneIndex, cueIndex } = findStandingIndex(
    document,
    sceneId,
    side,
  );
  const character = document.characters.find((entry) => entry.id === characterId);
  if (character === undefined) {
    throw targetNotFound(["characterId"], `キャラクターが見つかりません: ${characterId}`);
  }
  if (!character.appearances.some((entry) => entry.id === appearanceId)) {
    throw targetNotFound(
      ["appearanceId"],
      `キャラクター ${characterId} の立ち絵が見つかりません: ${appearanceId}`,
    );
  }

  const existing = cueIndex === -1 ? undefined : scene.visualCues[cueIndex];
  const existingInput =
    existing === undefined
      ? undefined
      : characterStandingV1InputSchema.safeParse(existing.input);
  const existingData = existingInput?.success ? existingInput.data : undefined;
  const input: Record<string, unknown> = {
    characterId,
    appearanceId,
    side,
  };
  const resolvedScale =
    scale === null ? undefined : (scale ?? existingData?.scale);
  if (resolvedScale !== undefined) {
    input.scale = resolvedScale;
  }
  const resolvedEdge =
    edge === null ? undefined : (edge ?? existingData?.edge);
  if (resolvedEdge !== undefined) {
    input.edge = resolvedEdge;
  }
  const resolvedVertical =
    vertical === null ? undefined : (vertical ?? existingData?.vertical);
  if (resolvedVertical !== undefined) {
    input.vertical = resolvedVertical;
  }

  if (existing !== undefined) {
    const cue = parseCue({
      ...existing,
      layer: "standing",
      range: { kind: "scene" },
      transition: transition ?? existing.transition,
      input,
    });
    return {
      document: withScene(document, sceneIndex, {
        ...scene,
        visualCues: scene.visualCues.map((entry) =>
          entry.id === existing.id ? cue : entry,
        ),
      }),
      sceneIds: [],
      lineIds: [],
      cueIds: [],
      primaryId: existing.id,
    };
  }

  const existingCueIds = new Set(
    document.scenes.flatMap((entry) =>
      entry.visualCues.map((cue) => cue.id),
    ),
  );
  const cueId = context.ids.cue(sceneId, `standing-${side}`, existingCueIds);
  const order =
    scene.visualCues
      .filter((cue) => cue.layer === "standing")
      .reduce((max, cue) => Math.max(max, cue.order), -1) + 1;
  const cue = parseCue({
    id: cueId,
    template: {
      id: characterStandingV1.id,
      version: characterStandingV1.version,
    },
    range: { kind: "scene" },
    layer: "standing",
    order,
    transition: transition ?? {
      enter: { ...characterStandingV1.transitionPolicy.defaultEnter },
      exit: { ...characterStandingV1.transitionPolicy.defaultExit },
    },
    input,
  });
  return {
    document: withScene(document, sceneIndex, {
      ...scene,
      visualCues: [...scene.visualCues, cue],
    }),
    sceneIds: [],
    lineIds: [],
    cueIds: [cueId],
    primaryId: cueId,
  };
}

export function removeStanding(
  document: ContentDocument,
  sceneId: string,
  side: StandingSide,
): StandingEditResult {
  const { scene, sceneIndex, cueIndex } = findStandingIndex(
    document,
    sceneId,
    side,
  );
  const cue = cueIndex === -1 ? undefined : scene.visualCues[cueIndex];
  if (cue === undefined) {
    throw targetNotFound(["side"], `立ち絵が見つかりません: ${side}`);
  }
  return {
    document: withScene(document, sceneIndex, {
      ...scene,
      visualCues: scene.visualCues.filter((entry) => entry.id !== cue.id),
    }),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: cue.id,
  };
}

export function upsertStandingState(
  document: ContentDocument,
  sceneId: string,
  side: StandingSide,
  fromLineId: string,
  characterId: string | null,
  appearanceId: string | null,
): StandingEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  if (!scene.lines.some((line) => line.id === fromLineId)) {
    throw targetNotFound(
      ["fromLineId"],
      `立ち絵状態の対象セリフが見つかりません: ${fromLineId}`,
    );
  }
  if (characterId === null && appearanceId === null) {
    // A hidden state is valid.
  } else if (characterId === null || appearanceId === null) {
    throw targetNotFound(
      [characterId === null ? "characterId" : "appearanceId"],
      "立ち絵状態は characterId と appearanceId を両方nullにするか、両方指定してください",
    );
  } else {
    const character = document.characters.find(
      (entry) => entry.id === characterId,
    );
    if (character === undefined) {
      throw targetNotFound(
        ["characterId"],
        `キャラクターが見つかりません: ${characterId}`,
      );
    }
    if (!character.appearances.some((entry) => entry.id === appearanceId)) {
      throw targetNotFound(
        ["appearanceId"],
        `キャラクター ${characterId} の立ち絵が見つかりません: ${appearanceId}`,
      );
    }
  }
  const nextState: StandingState = {
    side,
    fromLineId,
    characterId,
    appearanceId,
  };
  const nextStates = sortStandingStates({
    ...scene,
    standingStates: [
      ...(scene.standingStates ?? []).filter(
        (state) => !(state.side === side && state.fromLineId === fromLineId),
      ),
      nextState,
    ],
  });
  return {
    document: withScene(document, sceneIndex, {
      ...scene,
      standingStates: nextStates,
    }),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: fromLineId,
  };
}

export function removeStandingState(
  document: ContentDocument,
  sceneId: string,
  side: StandingSide,
  fromLineId: string,
): StandingEditResult {
  const { scene, sceneIndex } = findEditableScene(document, sceneId);
  const states = scene.standingStates ?? [];
  const exists = states.some(
    (state) => state.side === side && state.fromLineId === fromLineId,
  );
  if (!exists) {
    throw targetNotFound(
      ["fromLineId"],
      `立ち絵状態が見つかりません: ${side} / ${fromLineId}`,
    );
  }
  const nextStates = sortStandingStates({
    ...scene,
    standingStates: states.filter(
      (state) => !(state.side === side && state.fromLineId === fromLineId),
    ),
  });
  return {
    document: withScene(document, sceneIndex, {
      ...scene,
      ...(nextStates.length === 0
        ? { standingStates: undefined }
        : { standingStates: nextStates }),
    }),
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: fromLineId,
  };
}
