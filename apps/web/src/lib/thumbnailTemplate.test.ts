import { describe, expect, it } from "vitest";
import { defaultThumbnailInput } from "./thumbnailTemplate";

describe("defaultThumbnailInput", () => {
  it("seeds the cutout template defaults", () => {
    expect(defaultThumbnailInput("thumbnail.cutout-hero", 1)).toEqual({
      headline: "",
      subjectSide: "right",
      flipForeground: false,
    });
  });

  it("returns an empty input for an unknown template", () => {
    expect(defaultThumbnailInput("thumbnail.missing", 1)).toEqual({});
  });
});
