import { characterStandingV1, characterStandingV1InputSchema } from "../templates";
import type { Scene, StandingState } from "./scene";
import type { StandingSide } from "./standing-layout";

function appearanceRefKey(characterId: string, appearanceId: string): string {
  return JSON.stringify([characterId, appearanceId]);
}

export interface StandingDisplayState {
  side: StandingSide;
  characterId: string | null;
  appearanceId: string | null;
}

export interface StandingAppearanceRef {
  characterId: string;
  appearanceId: string;
}

interface ParsedStandingCue {
  side: StandingSide;
  characterId: string;
  appearanceId: string;
  range: Scene["visualCues"][number]["range"];
}

function parseStandingCue(
  cue: Scene["visualCues"][number],
): ParsedStandingCue | null {
  if (
    cue.template.id !== characterStandingV1.id ||
    cue.template.version !== characterStandingV1.version
  ) {
    return null;
  }
  const parsed = characterStandingV1InputSchema.safeParse(cue.input);
  if (!parsed.success) {
    return null;
  }
  return {
    side: parsed.data.side,
    characterId: parsed.data.characterId,
    appearanceId: parsed.data.appearanceId,
    range: cue.range,
  };
}

/**
 * The scene-opening state per side. The first scene-range standing cue wins,
 * matching the editor's managed-slot projection.
 */
export function resolveSceneOpeningStates(
  scene: Scene,
): Map<StandingSide, StandingDisplayState> {
  const bySide = new Map<StandingSide, StandingDisplayState>();
  for (const cue of scene.visualCues) {
    const parsed = parseStandingCue(cue);
    if (parsed === null || parsed.range.kind !== "scene") {
      continue;
    }
    if (bySide.has(parsed.side)) {
      continue;
    }
    bySide.set(parsed.side, {
      side: parsed.side,
      characterId: parsed.characterId,
      appearanceId: parsed.appearanceId,
    });
  }
  return bySide;
}

function lineIndexById(scene: Scene): Map<string, number> {
  return new Map(scene.lines.map((line, index) => [line.id, index]));
}

/**
 * Change points sorted by their line's position in the scene. Unknown lines are
 * dropped; document validation rejects them, but transient form values may
 * briefly contain one.
 */
export function sortStandingStates(scene: Scene): StandingState[] {
  if (scene.standingStates === undefined) {
    return [];
  }
  const indexById = lineIndexById(scene);
  return scene.standingStates
    .filter((state) => indexById.has(state.fromLineId))
    .map((state) => ({
      state,
      index: indexById.get(state.fromLineId) as number,
    }))
    .sort((left, right) => {
      if (left.index !== right.index) {
        return left.index - right.index;
      }
      if (left.state.side === right.state.side) {
        return 0;
      }
      return left.state.side === "left" ? -1 : 1;
    })
    .map((entry) => entry.state);
}

function resolveStandingStatesAtLine(
  scene: Scene,
  lineId: string,
): Map<StandingSide, StandingDisplayState | null> {
  const result = new Map<StandingSide, StandingDisplayState | null>([
    ["left", null],
    ["right", null],
  ]);
  const indexById = lineIndexById(scene);
  const targetIndex = indexById.get(lineId);
  if (targetIndex === undefined) {
    return result;
  }
  const openings = resolveSceneOpeningStates(scene);
  result.set("left", openings.get("left") ?? null);
  result.set("right", openings.get("right") ?? null);
  for (const state of sortStandingStates(scene)) {
    const stateIndex = indexById.get(state.fromLineId);
    if (stateIndex === undefined || stateIndex > targetIndex) {
      continue;
    }
    result.set(state.side, {
      side: state.side,
      characterId: state.characterId,
      appearanceId: state.appearanceId,
    });
  }
  return result;
}

export function resolveStandingStateAtLine(
  scene: Scene,
  side: StandingSide,
  lineId: string,
): StandingDisplayState | null {
  return resolveStandingStatesAtLine(scene, lineId).get(side) ?? null;
}

/**
 * Visible states at one line, including legacy line-range standing cues. Used
 * for per-line expression validation.
 */
export function standingAppearancesAtLine(
  scene: Scene,
  lineId: string,
): StandingAppearanceRef[] {
  const indexById = lineIndexById(scene);
  const targetIndex = indexById.get(lineId);
  if (targetIndex === undefined) {
    return [];
  }
  const refs = new Map<string, StandingAppearanceRef>();
  const add = (state: StandingDisplayState | null | undefined): void => {
    if (state === null || state === undefined || state.characterId === null || state.appearanceId === null) {
      return;
    }
    refs.set(appearanceRefKey(state.characterId, state.appearanceId), {
      characterId: state.characterId,
      appearanceId: state.appearanceId,
    });
  };
  const states = resolveStandingStatesAtLine(scene, lineId);
  add(states.get("left"));
  add(states.get("right"));
  for (const cue of scene.visualCues) {
    const parsed = parseStandingCue(cue);
    if (parsed === null) {
      continue;
    }
    if (parsed.range.kind === "scene") {
      continue;
    }
    if (parsed.range.kind === "offset") {
      // Legacy offset cues cannot be mapped to lines without the resolved
      // timeline. Include them conservatively so a missing preset cannot
      // silently fall back to normal at save.
      refs.set(appearanceRefKey(parsed.characterId, parsed.appearanceId), {
        characterId: parsed.characterId,
        appearanceId: parsed.appearanceId,
      });
      continue;
    }
    const start = indexById.get(parsed.range.startLineId);
    const end = indexById.get(parsed.range.endLineId);
    if (start === undefined || end === undefined) {
      continue;
    }
    if (targetIndex < Math.min(start, end) || targetIndex > Math.max(start, end)) {
      continue;
    }
    refs.set(appearanceRefKey(parsed.characterId, parsed.appearanceId), {
      characterId: parsed.characterId,
      appearanceId: parsed.appearanceId,
    });
  }
  return [...refs.values()];
}

/** All appearances a scene can show as standing, including hidden gaps' refs. */
export function collectStandingAppearanceRefs(scene: Scene): StandingAppearanceRef[] {
  const refs = new Map<string, StandingAppearanceRef>();
  const add = (characterId: string | null, appearanceId: string | null): void => {
    if (characterId === null || appearanceId === null) {
      return;
    }
    refs.set(appearanceRefKey(characterId, appearanceId), { characterId, appearanceId });
  };
  for (const cue of scene.visualCues) {
    const parsed = parseStandingCue(cue);
    if (parsed !== null) {
      add(parsed.characterId, parsed.appearanceId);
    }
  }
  for (const state of scene.standingStates ?? []) {
    add(state.characterId, state.appearanceId);
  }
  return [...refs.values()];
}
