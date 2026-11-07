import { describe, expect, it } from "vitest";
import { resolveStandingPlacement } from "./standing-placement.ts";

describe("resolveStandingPlacement", () => {
  it("uses the default standing layout when none is set", () => {
    expect(resolveStandingPlacement()).toEqual({
      scale: 1,
      insetPercent: 3,
      shiftPercent: 0,
    });
  });

  it("maps edge and vertical to stage offsets and keeps the scale", () => {
    expect(
      resolveStandingPlacement({ scale: 1.2, edge: "tight", vertical: "up" }),
    ).toEqual({ scale: 1.2, insetPercent: 0, shiftPercent: -6 });
    expect(
      resolveStandingPlacement({ scale: 0.9, edge: "center", vertical: "down" }),
    ).toEqual({ scale: 0.9, insetPercent: 8, shiftPercent: 5 });
  });
});
