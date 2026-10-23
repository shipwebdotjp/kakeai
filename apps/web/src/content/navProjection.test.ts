import { describe, expect, it } from "vitest";
import { sceneNavProjection } from "./navProjection";
import {
  createCueFormValue,
  type CharacterFormValue,
  type SceneFormValue,
  type SpeakerFormValue,
} from "./form";

function makeScene(id: string): SceneFormValue {
  return {
    id,
    kind: "point",
    label: "要点1",
    accentKind: "theme",
    accentToken: "primary",
    accentColor: "",
    timingMode: "auto",
    durationMs: 4000,
    transitionPreset: "cut",
    transitionDurationMs: 0,
    lines: [],
    cues: [],
    standings: [
      {
        cueId: null,
        characterId: null,
        appearanceId: null,
        side: "left",
        scale: 1,
        edge: "margin",
        vertical: "standard",
        enterPreset: "none",
        enterDurationMs: 0,
        exitPreset: "none",
        exitDurationMs: 0,
      },
    ],
    audioCues: [],
    mainVisualCueId: "",
    embeddedAudio: true,
    embeddedAudioGainDb: 0,
  };
}

const characters: CharacterFormValue[] = [
  {
    id: "char-1",
    name: "リン",
    voiceProfileId: null,
    voices: [],
    appearances: [
      {
        id: "app-1",
        assetId: "asset-1",
        expression: "normal",
        pose: "front",
        label: "",
        faceSetId: null,
      },
    ],
  },
];

const speakers: SpeakerFormValue[] = [
  { id: "speaker-1", name: "リン", characterId: "char-1", voiceProfileId: null },
];

describe("sceneNavProjection", () => {
  it("changes when a standing character is selected", () => {
    const before = sceneNavProjection([makeScene("p1")], speakers, characters);
    const scene = makeScene("p1");
    scene.standings[0]!.characterId = "char-1";
    scene.standings[0]!.appearanceId = "app-1";
    const after = sceneNavProjection([scene], speakers, characters);
    expect(after).not.toBe(before);
  });

  it("ignores unrelated scene fields and stays stable across equal values", () => {
    const scene = makeScene("p1");
    const before = sceneNavProjection([scene], speakers, characters);
    const copy = makeScene("p1");
    copy.accentColor = "#112233";
    copy.durationMs = 9000;
    expect(sceneNavProjection([copy], speakers, characters)).toBe(before);
  });

  it("changes when a character appearance asset changes", () => {
    const before = sceneNavProjection([makeScene("p1")], speakers, characters);
    const nextCharacters = characters.map((character) => ({
      ...character,
      appearances: character.appearances.map((appearance) => ({
        ...appearance,
        assetId: "asset-2",
      })),
    }));
    expect(sceneNavProjection([makeScene("p1")], speakers, nextCharacters)).not.toBe(before);
  });

  it("changes when a cue layout, range or input changes", () => {
    const scene = makeScene("p1");
    const cue = createCueFormValue({
      sceneId: "p1",
      templateId: "text.block",
      templateVersion: 1,
      layer: "overlay",
      order: 0,
    });
    scene.cues = [cue];
    const before = sceneNavProjection([scene], speakers, characters);

    scene.cues = [{ ...cue, order: 1 }];
    expect(sceneNavProjection([scene], speakers, characters)).not.toBe(before);

    scene.cues = [{ ...cue, rangeKind: "offset", startMs: 0, endMs: 1000 }];
    expect(sceneNavProjection([scene], speakers, characters)).not.toBe(before);

    scene.cues = [{ ...cue, fields: { ...cue.fields, text: "変更" } }];
    expect(sceneNavProjection([scene], speakers, characters)).not.toBe(before);
  });
});
