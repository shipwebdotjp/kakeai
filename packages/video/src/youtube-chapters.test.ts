import { describe, expect, it } from "vitest";
import { createInsertScene } from "@kakeai/contracts";
import { validContentDocument } from "@kakeai/contracts/testing/fixtures";
import { CompositionCompileError } from "./compile-error";
import { buildYouTubeChapterList } from "./youtube-chapters";

describe("buildYouTubeChapterList", () => {
  it("formats chapter timestamps as MM:SS and lists narration scenes", () => {
    const document = validContentDocument();
    const result = buildYouTubeChapterList(document);

    expect(result.chaptersText).toBe("00:00 導入\n00:04 要点 1\n00:08 要点 2\n00:09 要点 3\n00:10 結び");
    expect(result.warnings.filter((w) => w.code === "less_than_3_chapters")).toEqual([]);
  });

  it("excludes insert scenes completely without generating lines or warnings for them", () => {
    const document = validContentDocument();
    // Insert an "insert" scene between intro and point 1
    document.scenes.splice(1, 0, createInsertScene("scene-insert", "挿入シーン", "asset-1", 5000, true));

    const result = buildYouTubeChapterList(document);

    // Insert scene should be excluded from chapter lines
    expect(result.chaptersText).toBe("00:00 導入\n00:09 要点 1\n00:13 要点 2\n00:14 要点 3\n00:15 結び");
    // No warning generated for insert scene
    expect(result.warnings.some((w) => w.sceneId === "scene-insert")).toBe(false);
  });

  it("warns when there are fewer than 3 narration chapters", () => {
    const document = validContentDocument();
    // Keep only intro and outro (2 chapters)
    document.scenes = document.scenes.filter((scene) => scene.kind !== "point");

    const result = buildYouTubeChapterList(document);
    expect(result.warnings).toContainEqual({
      code: "less_than_3_chapters",
      message: "YouTubeの動画チャプター機能を利用するには最低3つ以上のチャプターが必要です。",
    });
  });

  it("warns when any included scene duration is under 10 seconds", () => {
    const document = validContentDocument();
    const result = buildYouTubeChapterList(document);

    const under10SecWarnings = result.warnings.filter(
      (w) => w.code === "scene_under_10_seconds",
    );
    expect(under10SecWarnings.length).toBe(5);
    expect(under10SecWarnings[0]?.sceneId).toBe(document.scenes[0]?.id);
  });

  it("formats timestamps as HH:MM:SS when total video duration is >= 1 hour", () => {
    const document = validContentDocument();
    // Extend intro scene to 3,600,000 ms (1 hour)
    if (document.scenes[0]) {
      document.scenes[0].timing = { mode: "fixed", durationMs: 3600000 };
    }
    if (document.scenes[1]) {
      document.scenes[1].timing = { mode: "fixed", durationMs: 120000 };
    }

    const result = buildYouTubeChapterList(document);
    expect(result.chaptersText).toContain("00:00:00 導入");
    expect(result.chaptersText).toContain("01:00:00 要点 1");
    expect(result.chaptersText).toContain("01:02:00 要点 2");
  });

  it("throws CompositionCompileError if timeline resolution fails", () => {
    const document = validContentDocument();
    if (document.scenes[1]) {
      document.scenes[1].timing = { mode: "fixed", durationMs: 1 };
    }
    expect(() => buildYouTubeChapterList(document)).toThrow(CompositionCompileError);
  });
});
