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
