import { describe, expect, it } from "vitest";
import {
  scriptOperationCreatedSchema,
  scriptOperationNames,
  scriptOperationSchema,
} from "./script-operation";

describe("character.addFromLibrary operation schema", () => {
  it("is part of the operation union and catalog", () => {
    expect(scriptOperationNames).toContain("character.addFromLibrary");
    expect(
      scriptOperationSchema.safeParse({
        op: "character.addFromLibrary",
        libraryCharacterId: "lib-1",
      }).success,
    ).toBe(true);
    expect(
      scriptOperationSchema.safeParse({ op: "character.addFromLibrary" }).success,
    ).toBe(false);
    expect(
      scriptOperationSchema.safeParse({
        op: "character.addFromLibrary",
        libraryCharacterId: "lib-1",
        key: "char-1",
      }).success,
    ).toBe(false);
  });

  it("reports created character, appearance and speaker IDs", () => {
    const created = {
      sceneIds: [],
      lineIds: [],
      cueIds: [],
      audioCueIds: [],
      audioTakeIds: [],
      characterIds: ["character-1"],
      appearanceIds: ["appearance-1"],
      speakerIds: ["speaker-1"],
    };
    expect(scriptOperationCreatedSchema.parse(created)).toEqual(created);
    expect(
      scriptOperationCreatedSchema.safeParse({ ...created, speakerIds: undefined }).success,
    ).toBe(false);
  });
});

describe("speaker operations", () => {
  it("registers speaker.add and speaker.setVoiceProfile", () => {
    expect(scriptOperationNames).toContain("speaker.add");
    expect(scriptOperationNames).toContain("speaker.setVoiceProfile");
    expect(
      scriptOperationSchema.safeParse({
        op: "speaker.add",
        key: "narration",
        name: "ナレーター",
        voiceProfileId: "vp-ja",
      }).success,
    ).toBe(true);
    expect(
      scriptOperationSchema.safeParse({
        op: "speaker.add",
        name: "ナレーター",
      }).success,
    ).toBe(false);
    expect(
      scriptOperationSchema.safeParse({
        op: "speaker.setVoiceProfile",
        speakerId: "speaker-1",
        voiceProfileId: null,
      }).success,
    ).toBe(true);
  });

  it("accepts string, keyed and null Speaker references", () => {
    for (const speakerId of ["speaker-1", { key: "narration" }, null] as const) {
      expect(
        scriptOperationSchema.safeParse({
          op: "line.setSpeaker",
          sceneId: "scene-1",
          lineId: "line-1",
          speakerId,
        }).success,
      ).toBe(true);
      expect(
        scriptOperationSchema.safeParse({
          op: "line.add",
          sceneId: "scene-1",
          speakerId,
        }).success,
      ).toBe(true);
    }
    expect(
      scriptOperationSchema.safeParse({
        op: "speaker.setVoiceProfile",
        speakerId: { key: "narration" },
        voiceProfileId: "vp-ja",
      }).success,
    ).toBe(true);
  });
});
