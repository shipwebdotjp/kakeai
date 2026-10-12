import { describe, expect, it } from "vitest";
import { cueScope } from "./scope";

const failingCueId = "visual-scene-intro-media-full-bleed-dfbd7288-c810-43f2-8c9e-0b473a4c7a09";

describe("cueScope", () => {
  it("generates the same ids for the same cue id", () => {
    expect(cueScope(failingCueId).id("media")).toBe(cueScope(failingCueId).id("media"));
  });

  it("generates distinct ids for distinct cue ids", () => {
    const ids = new Set(
      ["visual-scene-intro-media-full-bleed-a", "visual-scene-intro-media-full-bleed-b", failingCueId].map(
        (cueId) => cueScope(cueId).id("media"),
      ),
    );
    expect(ids.size).toBe(3);
  });

  it("keeps media ids short enough for filesystem path components", () => {
    expect(cueScope(failingCueId).id("media").length).toBeLessThanOrEqual(64);
  });

  it("generates DOM-safe ids", () => {
    const id = cueScope(failingCueId).child("screen").id("media");
    expect(id).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });

  it("nests child scopes without colliding with siblings", () => {
    const scope = cueScope(failingCueId);
    expect(scope.child("screen").id("media")).not.toBe(scope.id("media"));
    expect(scope.child("screen").id("media")).not.toBe(scope.child("caption").id("media"));
  });
});
