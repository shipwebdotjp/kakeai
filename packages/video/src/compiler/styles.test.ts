import { describe, expect, it } from "vitest";
import { STYLES } from "./styles";

function ruleFor(selector: string): string | undefined {
  return STYLES.split("\n").find((rule) => rule.startsWith(`${selector}{`));
}

describe("device-frame styles", () => {
  it("keeps the laptop screen content-box so a leaked universal border-box does not shrink it inside the keyboard", () => {
    const screenRule = ruleFor(".kakeai-deviceframe-screen");
    expect(screenRule).toContain("box-sizing:content-box");
  });
});
