import {
  characterStandingV1,
  characterStandingV1InputSchema,
  DEFAULT_STANDING_EDGE,
  DEFAULT_STANDING_VERTICAL,
  type ContentDocument,
  type StandingEdge,
  type StandingSide,
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
  scale: number | undefined,
  transition: VisualCue["transition"] | undefined,
  context: ScriptContext,
  edge?: StandingEdge,
  vertical?: StandingVertical,
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
  const resolvedScale =
    scale ??
    (existingInput?.success ? existingInput.data.scale : 1);
  const resolvedEdge =
    edge ??
    (existingInput?.success ? existingInput.data.edge : DEFAULT_STANDING_EDGE);
  const resolvedVertical =
    vertical ??
    (existingInput?.success ? existingInput.data.vertical : DEFAULT_STANDING_VERTICAL);
  const input = {
    characterId,
    appearanceId,
    side,
    scale: resolvedScale,
    edge: resolvedEdge,
    vertical: resolvedVertical,
  };

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
