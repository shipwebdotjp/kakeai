import { describe, expect, it } from "vitest";
import {
  buildMaterialImportInput,
  isMaterialDurationValid,
  materialDurationMs,
} from "./material-import";

describe("Live Material import request", () => {
  it("defaults PNG materials to the static 4000ms duration", () => {
    expect(
      buildMaterialImportInput({
        workId: "work-1",
        sceneId: "scene-1",
        format: "png",
        durationSeconds: 12,
      }),
    ).toEqual({
      workId: "work-1",
      sceneId: "scene-1",
      format: "png",
      durationMs: 4000,
    });
  });

  it("converts the MP4 duration from seconds and trims the name", () => {
    expect(
      buildMaterialImportInput({
        workId: "work-1",
        sceneId: "scene-1",
        name: "  ニュース図版  ",
        format: "mp4",
        durationSeconds: 2.5,
      }),
    ).toEqual({
      workId: "work-1",
      sceneId: "scene-1",
      name: "ニュース図版",
      format: "mp4",
      durationMs: 2500,
    });
  });

  it("rejects durations outside 1ms..30000ms for MP4", () => {
    expect(materialDurationMs(0)).toBeNull();
    expect(materialDurationMs(30.1)).toBeNull();
    expect(materialDurationMs(30)).toBe(30_000);
    expect(isMaterialDurationValid("png", 0)).toBe(true);
    expect(isMaterialDurationValid("html", 0)).toBe(true);
    expect(isMaterialDurationValid("mp4", 0)).toBe(false);
    expect(() =>
      buildMaterialImportInput({
        workId: "work-1",
        sceneId: "scene-1",
        format: "mp4",
        durationSeconds: 31,
      }),
    ).toThrow();
  });
});
