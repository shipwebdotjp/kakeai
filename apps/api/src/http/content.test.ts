import { describe, expect, it } from "vitest";
import { parseRange } from "./content.ts";

describe("parseRange", () => {
  it("returns null when no range is requested", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("", 100)).toBeNull();
  });

  it("parses closed, open-ended, and suffix ranges", () => {
    expect(parseRange("bytes=0-49", 100)).toEqual({ start: 0, end: 49 });
    expect(parseRange("bytes=50-", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("clamps the end to the file size", () => {
    expect(parseRange("bytes=0-1000", 100)).toEqual({ start: 0, end: 99 });
  });

  it("rejects unsatisfiable or malformed ranges", () => {
    expect(parseRange("bytes=100-", 100)).toBe("invalid");
    expect(parseRange("bytes=50-10", 100)).toBe("invalid");
    expect(parseRange("bytes=-0", 100)).toBe("invalid");
    expect(parseRange("bytes=-", 100)).toBe("invalid");
  });

  it("ignores non-bytes or multi-range requests", () => {
    expect(parseRange("items=0-10", 100)).toBeNull();
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});
