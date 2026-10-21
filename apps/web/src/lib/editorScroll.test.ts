import { describe, expect, it } from "vitest";
import { scrollTopForAnchor } from "./editorScroll";

describe("scrollTopForAnchor", () => {
  it("keeps the anchored element at the same screen offset", () => {
    expect(scrollTopForAnchor(660, 120)).toBe(540);
    expect(scrollTopForAnchor(580, 120)).toBe(460);
  });

  it("does not scroll above the top", () => {
    expect(scrollTopForAnchor(100, 300)).toBe(0);
  });
});
