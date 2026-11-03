import type { StandingSide } from "@kakeai/contracts";
import type { StandingStateFormValue } from "./types";

export interface StandingSceneLike {
  lines: readonly { id: string }[];
  standings: readonly {
    side: StandingSide;
    characterId: string | null;
    appearanceId: string | null;
  }[];
  standingStates?: readonly StandingStateFormValue[];
}

export interface ResolvedStandingFormState {
  side: StandingSide;
  characterId: string | null;
  appearanceId: string | null;
  /** The line that starts this state; null for the scene opening state. */
  fromLineId: string | null;
  /** True when this line is the state's first line. */
  isChange: boolean;
}

function lineIndexById(scene: StandingSceneLike): Map<string, number> {
  return new Map(scene.lines.map((line, index) => [line.id, index]));
}

export function sortStandingStateFormValues(
  scene: StandingSceneLike,
): StandingStateFormValue[] {
  const indexById = lineIndexById(scene);
  return [...(scene.standingStates ?? [])]
    .filter((state) => indexById.has(state.fromLineId))
    .sort(
      (left, right) =>
        (indexById.get(left.fromLineId) ?? 0) -
        (indexById.get(right.fromLineId) ?? 0) ||
        (left.side === right.side ? 0 : left.side === "left" ? -1 : 1),
    );
}

export function resolveStandingStateFormAtLine(
  scene: StandingSceneLike,
  side: StandingSide,
  lineId: string,
): ResolvedStandingFormState | null {
  const indexById = lineIndexById(scene);
  const targetIndex = indexById.get(lineId);
  if (targetIndex === undefined) {
    return null;
  }
  const opening = scene.standings.find((standing) => standing.side === side);
  let current: ResolvedStandingFormState | null =
    opening === undefined ||
    opening.characterId === null ||
    opening.appearanceId === null
      ? null
      : {
          side,
          characterId: opening.characterId,
          appearanceId: opening.appearanceId,
          fromLineId: null,
          isChange: false,
        };
  for (const state of sortStandingStateFormValues(scene)) {
    if (state.side !== side) {
      continue;
    }
    const stateIndex = indexById.get(state.fromLineId);
    if (stateIndex === undefined || stateIndex > targetIndex) {
      continue;
    }
    current = {
      side,
      characterId: state.characterId,
      appearanceId: state.appearanceId,
      fromLineId: state.fromLineId,
      isChange: state.fromLineId === lineId,
    };
  }
  return current;
}

export function resolveStandingStatesForLine(
  scene: StandingSceneLike,
  lineId: string,
): ResolvedStandingFormState[] {
  return (["left", "right"] as const)
    .map((side) => resolveStandingStateFormAtLine(scene, side, lineId))
    .filter((state): state is ResolvedStandingFormState => state !== null);
}

/**
 * Resolves every line once, in scene order. The editor uses this for the line
 * list so a line change does not re-sort the states for every row.
 */
export function resolveStandingStatesByLine(
  scene: StandingSceneLike,
): Map<string, ResolvedStandingFormState[]> {
  const result = new Map<string, ResolvedStandingFormState[]>();
  const indexById = lineIndexById(scene);
  const changesByIndex = new Map<number, StandingStateFormValue[]>();
  for (const state of sortStandingStateFormValues(scene)) {
    const index = indexById.get(state.fromLineId);
    if (index === undefined) {
      continue;
    }
    const list = changesByIndex.get(index) ?? [];
    list.push(state);
    changesByIndex.set(index, list);
  }
  const current = new Map<StandingSide, ResolvedStandingFormState>();
  for (const side of ["left", "right"] as const) {
    const opening = scene.standings.find((standing) => standing.side === side);
    if (
      opening !== undefined &&
      opening.characterId !== null &&
      opening.appearanceId !== null
    ) {
      current.set(side, {
        side,
        characterId: opening.characterId,
        appearanceId: opening.appearanceId,
        fromLineId: null,
        isChange: false,
      });
    }
  }
  for (const [index, line] of scene.lines.entries()) {
    for (const state of changesByIndex.get(index) ?? []) {
      current.set(state.side, {
        side: state.side,
        characterId: state.characterId,
        appearanceId: state.appearanceId,
        fromLineId: state.fromLineId,
        isChange: true,
      });
    }
    result.set(
      line.id,
      [...current.values()].map((state) => ({ ...state })),
    );
    for (const state of current.values()) {
      state.isChange = false;
    }
  }
  return result;
}

export function activeStandingAppearanceIds(
  scene: StandingSceneLike,
  lineId: string,
  characterId: string | null,
): Set<string> {
  if (characterId === null) {
    return new Set();
  }
  return new Set(
    resolveStandingStatesForLine(scene, lineId)
      .filter(
        (state) =>
          state.characterId === characterId && state.appearanceId !== null,
      )
      .map((state) => state.appearanceId as string),
  );
}
