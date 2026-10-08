import { describe, expect, it } from "vitest";
import { validContentDocument } from "../testing/fixtures";
import { TEXT_CONSTRAINTS, computeContentWarnings } from "./warnings";

describe("computeContentWarnings", () => {
  it("returns no warnings for a document within the template limits", () => {
    expect(computeContentWarnings(validContentDocument())).toEqual([]);
  });

  it("warns when a point body exceeds the line budget", () => {
    const document = validContentDocument();
    const scene = document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("expected a point scene");
    }
    scene.slots.body = "あ".repeat(TEXT_CONSTRAINTS.body.charsPerLine * TEXT_CONSTRAINTS.body.maxLines + 1);
    const warnings = computeContentWarnings(document);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("text_overflow");
    expect(warnings[0]!.path).toEqual(["scenes", 1, "slots", "body"]);
  });

  it("warns when a caption exceeds the line budget", () => {
    const document = validContentDocument();
    const scene = document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("expected a point scene");
    }
    scene.lines[0]!.captionText = "い".repeat(
      TEXT_CONSTRAINTS.captionText.charsPerLine * TEXT_CONSTRAINTS.captionText.maxLines + 1,
    );
    const warnings = computeContentWarnings(document);
    expect(warnings.map((warning) => warning.path)).toContainEqual([
      "scenes",
      1,
      "lines",
      0,
      "captionText",
    ]);
  });
});
