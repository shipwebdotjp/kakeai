import { describe, expect, it } from "vitest";
import { resolveCueMaterialId } from "./material-resolution.ts";

describe("resolveCueMaterialId", () => {
  it("inherits the segment material when the cue does not specify one", () => {
    expect(resolveCueMaterialId("material-segment", undefined)).toBe("material-segment");
    expect(resolveCueMaterialId(undefined, undefined)).toBeNull();
  });

  it("prefers a cue material reference", () => {
    expect(resolveCueMaterialId("material-segment", "material-cue")).toBe("material-cue");
    expect(resolveCueMaterialId(undefined, "material-cue")).toBe("material-cue");
  });

  it("hides the material when the cue explicitly sets null", () => {
    expect(resolveCueMaterialId("material-segment", null)).toBeNull();
  });
});
