import { describe, expect, it } from "vitest";
import type { Scene, VisualCue } from "@kakeai/contracts";
import type { ScenePlacement } from "../timeline";
import { expandStandingStateCues } from "./standing-states";

const transition = {
  enter: { preset: "none", durationMs: 0 },
  exit: { preset: "none", durationMs: 0 },
} as const;

function baseCue(): VisualCue {
  return {
    id: "standing-left",
    template: { id: "character.standing", version: 1 },
    range: { kind: "scene" },
    layer: "standing",
    order: 0,
    transition,
    input: {
      characterId: "char-1",
      appearanceId: "app-1",
      side: "left",
    },
  };
}

function scene(states?: Scene["standingStates"]): Scene {
  return {
    id: "scene-1",
    kind: "point",
    label: "p",
    accent: { kind: "theme", token: "primary" },
    timing: { mode: "auto" },
    lines: [
      {
        id: "line-1",
        speakerId: null,
        captionText: "one",
        speechText: "one",
        selectedAudioTakeId: null,
        expressionId: null,
      },
      {
        id: "line-2",
        speakerId: null,
        captionText: "two",
        speechText: "two",
        selectedAudioTakeId: null,
        expressionId: null,
      },
      {
        id: "line-3",
        speakerId: null,
        captionText: "three",
        speechText: "three",
        selectedAudioTakeId: null,
        expressionId: null,
      },
    ],
    visualCues: [baseCue()],
    ...(states === undefined ? {} : { standingStates: states }),
  };
}

const placement: ScenePlacement = {
  sceneId: "scene-1",
  sceneIndex: 1,
  startMs: 0,
  durationMs: 5000,
  endMs: 5000,
  lines: [
    { lineId: "line-1", startMs: 500, durationMs: 900, endMs: 1400, gapBeforeMs: 0 },
    { lineId: "line-2", startMs: 1400, durationMs: 900, endMs: 2300, gapBeforeMs: 0 },
    { lineId: "line-3", startMs: 2300, durationMs: 900, endMs: 3200, gapBeforeMs: 0 },
  ],
};

describe("expandStandingStateCues", () => {
  it("leaves a scene without states unchanged", () => {
    const input = scene();
    expect(expandStandingStateCues(input, placement)).toBe(input.visualCues);
  });

  it("expands the opening state, an appearance change and a hidden state into windows", () => {
    const cues = expandStandingStateCues(
      scene([
        {
          side: "left",
          fromLineId: "line-2",
          characterId: "char-1",
          appearanceId: "app-2",
        },
        {
          side: "left",
          fromLineId: "line-3",
          characterId: null,
          appearanceId: null,
        },
      ]),
      placement,
    );
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      id: "standing-left",
      range: { kind: "offset", startMs: 0, endMs: 1400 },
      input: { characterId: "char-1", appearanceId: "app-1", side: "left" },
    });
    expect(cues[1]).toMatchObject({
      range: { kind: "offset", startMs: 1400, endMs: 2300 },
      input: { characterId: "char-1", appearanceId: "app-2", side: "left" },
    });
  });

  it("merges an opening state and a line-1 change with the same look", () => {
    const cues = expandStandingStateCues(
      scene([
        {
          side: "left",
          fromLineId: "line-1",
          characterId: "char-1",
          appearanceId: "app-1",
        },
      ]),
      placement,
    );
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      id: "standing-left",
      range: { kind: "offset", startMs: 0, endMs: 5000 },
    });
  });
});
