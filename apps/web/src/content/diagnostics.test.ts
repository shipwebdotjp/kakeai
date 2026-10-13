import { describe, expect, it } from "vitest";
import { diagnosticTarget } from "./diagnostics";
import { createCueFormValue, createPointSceneFormValue, type SceneFormValue } from "./form";

describe("diagnosticTarget", () => {
  const sampleScenes: SceneFormValue[] = [
    {
      id: "scene-intro",
      kind: "intro",
      label: "導入",
      timingMode: "fixed",
      durationMs: 3000,
      accentKind: "theme",
      accentToken: "primary",
      accentColor: "#19736D",
      transitionPreset: "cut",
      transitionDurationMs: 500,
      cues: [
        createCueFormValue({
          sceneId: "scene-intro",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 0,
        }),
      ],
      lines: [],
      standings: [],
    },
    {
      ...createPointSceneFormValue("要点1"),
      id: "scene-point-1",
      cues: [
        createCueFormValue({
          sceneId: "scene-point-1",
          templateId: "text.block",
          templateVersion: 1,
          layer: "overlay",
          order: 0,
        }),
      ],
      lines: [
        {
          id: "line-1",
          speakerId: "speaker-1",
          captionText: "こんにちは",
          speechText: "",
          takes: [],
          selectedAudioTakeId: null,
        },
        {
          id: "line-2",
          speakerId: "speaker-1",
          captionText: "要点の解説です",
          speechText: "",
          takes: [],
          selectedAudioTakeId: null,
        },
      ],
    },
  ];

  it("returns scene target for scene-level paths", () => {
    expect(diagnosticTarget(["scenes", 0], sampleScenes)).toEqual({
      targetId: "scene-scene-intro",
      seek: { kind: "scene", id: "scene-intro" },
    });
    expect(diagnosticTarget(["scenes", 1, "label"], sampleScenes)).toEqual({
      targetId: "scene-scene-point-1",
      seek: { kind: "scene", id: "scene-point-1" },
    });
  });

  it("returns line target for line paths", () => {
    expect(diagnosticTarget(["scenes", 1, "lines", 0, "captionText"], sampleScenes)).toEqual({
      targetId: "line-line-1",
      seek: { kind: "line", id: "line-1" },
    });
    expect(diagnosticTarget(["scenes", 1, "lines", 1], sampleScenes)).toEqual({
      targetId: "line-line-2",
      seek: { kind: "line", id: "line-2" },
    });
  });

  it("returns cue target for visualCues paths within form cues range", () => {
    expect(diagnosticTarget(["scenes", 0, "visualCues", 0, "input", "text"], sampleScenes)).toEqual(
      {
        targetId: `cue-${sampleScenes[0]!.cues[0]!.id}`,
        seek: { kind: "cue", id: sampleScenes[0]!.cues[0]!.id },
      },
    );
  });

  it("returns null for visualCues index outside form cues range (e.g. standings or out of bounds)", () => {
    expect(diagnosticTarget(["scenes", 0, "visualCues", 1, "input"], sampleScenes)).toBeNull();
  });

  it("returns null for out of bounds scene or line indices", () => {
    expect(diagnosticTarget(["scenes", 99], sampleScenes)).toBeNull();
    expect(diagnosticTarget(["scenes", 1, "lines", 99], sampleScenes)).toBeNull();
  });

  it("returns null for document-level or non-scene paths", () => {
    expect(diagnosticTarget(["characters", 0, "name"], sampleScenes)).toBeNull();
    expect(diagnosticTarget(["speakers", 0, "voiceProfileId"], sampleScenes)).toBeNull();
    expect(diagnosticTarget(["bgm", "assetId"], sampleScenes)).toBeNull();
    expect(diagnosticTarget([], sampleScenes)).toBeNull();
    expect(diagnosticTarget(undefined, sampleScenes)).toBeNull();
  });
});
