import { describe, expect, it } from "vitest";
import {
  UNITS_PER_FULLWIDTH_CHAR,
  createTextWidthCounter,
  textWidthUnits,
} from "./text-width";

describe("createTextWidthCounter", () => {
  it("keeps the serialized counter in sync with the exported unit", () => {
    const counter = createTextWidthCounter();
    expect(counter.textWidthUnits("あ")).toBe(UNITS_PER_FULLWIDTH_CHAR);
    expect(counter.textWidthUnits("aあ")).toBe(1 + UNITS_PER_FULLWIDTH_CHAR);
    expect(counter.textWidthUnits("e\u0301")).toBe(textWidthUnits("e\u0301"));
  });
});
