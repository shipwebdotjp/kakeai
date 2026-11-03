import {
  characterStandingV1,
  characterStandingV1InputSchema,
  sortStandingStates,
  type Scene,
  type StandingSide,
  type StandingState,
  type VisualCue,
} from "@kakeai/contracts";
import type { ScenePlacement } from "../timeline";

interface OpeningState {
  cue: VisualCue;
  characterId: string;
  appearanceId: string;
  layout: Record<string, unknown>;
}

interface RawSegment {
  startMs: number;
  endMs: number;
  input: Record<string, unknown>;
  id: string;
  order: number;
  transition: VisualCue["transition"];
  reachesSceneEnd: boolean;
}

const CUT_TRANSITION: VisualCue["transition"] = {
  enter: { preset: "none", durationMs: 0 },
  exit: { preset: "none", durationMs: 0 },
};

function parseStandingCue(cue: VisualCue): {
  side: StandingSide;
  characterId: string;
  appearanceId: string;
  layout: Record<string, unknown>;
} | null {
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
  const { characterId, appearanceId, side, scale, edge, vertical } = parsed.data;
  return {
    side,
    characterId,
    appearanceId,
    layout: {
      ...(scale === undefined ? {} : { scale }),
      ...(edge === undefined ? {} : { edge }),
      ...(vertical === undefined ? {} : { vertical }),
    },
  };
}

function openingStates(scene: Scene): Map<StandingSide, OpeningState> {
  const bySide = new Map<StandingSide, OpeningState>();
  for (const cue of scene.visualCues) {
    if (cue.range.kind !== "scene") {
      continue;
    }
    const parsed = parseStandingCue(cue);
    if (parsed === null || bySide.has(parsed.side)) {
      continue;
    }
    bySide.set(parsed.side, {
      cue,
      characterId: parsed.characterId,
      appearanceId: parsed.appearanceId,
      layout: parsed.layout,
    });
  }
  return bySide;
}

function sameLayout(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return (
    left.scale === right.scale &&
    left.edge === right.edge &&
    left.vertical === right.vertical
  );
}

function sameVisibleContent(left: RawSegment, right: RawSegment): boolean {
  return (
    left.input.characterId === right.input.characterId &&
    left.input.appearanceId === right.input.appearanceId &&
    sameLayout(
      {
        scale: left.input.scale,
        edge: left.input.edge,
        vertical: left.input.vertical,
      },
      {
        scale: right.input.scale,
        edge: right.input.edge,
        vertical: right.input.vertical,
      },
    )
  );
}

function stateInput(state: StandingState): Record<string, unknown> {
  return {
    characterId: state.characterId,
    appearanceId: state.appearanceId,
    side: state.side,
  };
}

/**
 * Expands the scene's line-boundary Standing States into offset-range standing
 * cues so the existing renderer can draw them. The expansion is not persisted.
 * A scene without states returns its cues unchanged, which keeps the render of
 * every existing work identical.
 */
export function expandStandingStateCues(
  scene: Scene,
  placement: ScenePlacement,
): VisualCue[] {
  const states = scene.standingStates ?? [];
  if (states.length === 0) {
    return scene.visualCues;
  }
  const lineStartMs = new Map(
    placement.lines.map((line) => [line.lineId, line.startMs - placement.startMs]),
  );
  const sides = new Set(states.map((state) => state.side));
  const openings = openingStates(scene);
  const sceneStandingIds = new Set(
    scene.visualCues
      .filter((cue) => {
        if (cue.range.kind !== "scene") {
          return false;
        }
        const parsed = parseStandingCue(cue);
        return parsed !== null && sides.has(parsed.side);
      })
      .map((cue) => cue.id),
  );
  const kept = scene.visualCues.filter((cue) => !sceneStandingIds.has(cue.id));
  const sortedStates = sortStandingStates(scene);
  const maxOrder = scene.visualCues
    .filter((cue) => cue.layer === "standing")
    .reduce((max, cue) => Math.max(max, cue.order), -1);
  let order = maxOrder + 1;
  const synthesized: VisualCue[] = [];

  for (const side of sides) {
    const opening = openings.get(side);
    const changes = sortedStates
      .filter((state) => state.side === side)
      .map((state) => ({
        state,
        startMs: lineStartMs.get(state.fromLineId),
      }))
      .filter(
        (entry): entry is { state: StandingState; startMs: number } =>
          entry.startMs !== undefined,
      );
    const segments: RawSegment[] = [];
    const push = (
      startMs: number,
      endMs: number,
      input: Record<string, unknown>,
      id: string,
      transition: VisualCue["transition"],
    ): void => {
      if (endMs <= startMs) {
        return;
      }
      const segment: RawSegment = {
        startMs,
        endMs,
        input,
        id,
        order: order++,
        transition,
        reachesSceneEnd: endMs >= placement.durationMs,
      };
      const previous = segments[segments.length - 1];
      if (
        previous !== undefined &&
        previous.endMs === segment.startMs &&
        sameVisibleContent(previous, segment)
      ) {
        previous.endMs = segment.endMs;
        previous.reachesSceneEnd = segment.reachesSceneEnd;
        return;
      }
      segments.push(segment);
    };

    let cursor = 0;
    if (opening !== undefined) {
      const firstChangeMs = changes[0]?.startMs ?? placement.durationMs;
      push(
        0,
        Math.min(firstChangeMs, placement.durationMs),
        {
          characterId: opening.characterId,
          appearanceId: opening.appearanceId,
          side,
          ...opening.layout,
        },
        opening.cue.id,
        opening.cue.transition,
      );
      cursor = Math.min(firstChangeMs, placement.durationMs);
    }

    for (const [index, change] of changes.entries()) {
      const nextStart = changes[index + 1]?.startMs ?? placement.durationMs;
      const start = Math.max(change.startMs, cursor);
      if (change.state.characterId !== null && change.state.appearanceId !== null) {
        push(
          start,
          Math.min(nextStart, placement.durationMs),
          stateInput(change.state),
          `${opening?.cue.id ?? `standing-${side}`}|standing-state|${change.state.fromLineId}`,
          CUT_TRANSITION,
        );
      }
      cursor = Math.min(nextStart, placement.durationMs);
    }

    for (const segment of segments) {
      const transition = segment.reachesSceneEnd
        ? segment.transition
        : {
            enter: segment.transition.enter,
            exit: CUT_TRANSITION.exit,
          };
      synthesized.push({
        id: segment.id,
        template: {
          id: characterStandingV1.id,
          version: characterStandingV1.version,
        },
        range: {
          kind: "offset",
          startMs: Math.max(0, Math.round(segment.startMs)),
          endMs: Math.max(0, Math.round(segment.endMs)),
        },
        layer: "standing",
        order: segment.order,
        transition,
        input: segment.input,
      });
    }
  }

  return [...kept, ...synthesized];
}
