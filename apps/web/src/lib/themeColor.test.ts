import { describe, expect, it } from "vitest";
import { normalizeHexInput } from "./themeColor";

describe("normalizeHexInput", () => {
  it("normalizes a complete color to uppercase #RRGGBB", () => {
    expect(normalizeHexInput("#a84d3e")).toBe("#A84D3E");
    expect(normalizeHexInput("a84d3e")).toBe("#A84D3E");
    expect(normalizeHexInput("A84D3E")).toBe("#A84D3E");
    expect(normalizeHexInput("  #A84D3E  ")).toBe("#A84D3E");
  });

  it("returns null for incomplete or malformed input", () => {
    expect(normalizeHexInput("")).toBeNull();
    expect(normalizeHexInput("#")).toBeNull();
    expect(normalizeHexInput("#A84D3")).toBeNull();
    expect(normalizeHexInput("#A84D3EA")).toBeNull();
    expect(normalizeHexInput("#GGGGGG")).toBeNull();
  });
});
