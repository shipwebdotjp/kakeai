import { describe, expect, it } from "vitest";
import { contentDocumentSchema } from "./document";
import {
  DEFAULT_ACCENT_COLORS,
  DEFAULT_SCENE_IDS,
  INTRO_FIXED_DURATION_MS,
  OUTRO_FIXED_DURATION_MS,
  createInitialContentDocument,
} from "./defaults";

describe("createInitialContentDocument", () => {
  it("produces a valid v1 document", () => {
    const document = createInitialContentDocument();
    expect(contentDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("uses the fixed five scenes in order with stable ids", () => {
    const document = createInitialContentDocument();
    expect(document.scenes.map((scene) => scene.kind)).toEqual([
      "intro",
      "point",
      "point",
      "point",
      "outro",
    ]);
    expect(document.scenes.map((scene) => scene.id)).toEqual([
      DEFAULT_SCENE_IDS.intro,
      DEFAULT_SCENE_IDS.point1,
      DEFAULT_SCENE_IDS.point2,
      DEFAULT_SCENE_IDS.point3,
      DEFAULT_SCENE_IDS.outro,
    ]);
  });

  it("applies template default accent colors and timing", () => {
    const document = createInitialContentDocument();
    expect(document.scenes.map((scene) => scene.accentColor)).toEqual([
      DEFAULT_ACCENT_COLORS.intro,
      DEFAULT_ACCENT_COLORS.point1,
      DEFAULT_ACCENT_COLORS.point2,
      DEFAULT_ACCENT_COLORS.point3,
      DEFAULT_ACCENT_COLORS.outro,
    ]);
    expect(document.scenes[0]!.timing).toEqual({
      mode: "fixed",
      durationMs: INTRO_FIXED_DURATION_MS,
    });
    expect(document.scenes[4]!.timing).toEqual({
      mode: "fixed",
      durationMs: OUTRO_FIXED_DURATION_MS,
    });
    expect(document.scenes[1]!.timing).toEqual({ mode: "auto" });
  });
});
