import { describe, expect, it } from "vitest";
import { defaultLiveSafety, withSafetyPatch } from "./safety";
import { makeProgramDocument } from "./test-helpers";

describe("live safety model", () => {
  it("creates a default safety value for the given fallback cue", () => {
    expect(defaultLiveSafety("cue-fallback").fallbackCueId).toBe("cue-fallback");
  });

  it("merges patches into the document's current safety value", () => {
    const source = makeProgramDocument();
    const first = withSafetyPatch(source, { maxResponseChars: 240 }, "");
    const second = withSafetyPatch(first, { persona: "落ち着いた解説。" }, "");
    expect(second.safety?.maxResponseChars).toBe(240);
    expect(second.safety?.persona).toBe("落ち着いた解説。");
  });

  it("adds safety when the document has none", () => {
    const source = { ...makeProgramDocument(), safety: undefined };
    const next = withSafetyPatch(source, { maxResponseCues: 3 }, "cue-fallback");
    expect(next.safety).toEqual({
      ...defaultLiveSafety("cue-fallback"),
      maxResponseCues: 3,
    });
  });
});
