import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { LANDSCAPE_CANVAS, PORTRAIT_CANVAS, textBlockPadding } from "../canvas";
import { renderTextBlock } from "./text-block";

const theme = getVisualTheme("soft-editorial", 1)!;
const path = ["scenes", 0, "visualCues", 0, "input"];

describe("text.block edge insets", () => {
  it("defaults to the tight landscape inset", () => {
    expect(textBlockPadding(LANDSCAPE_CANVAS, undefined)).toEqual({
      top: 32,
      right: 32,
      bottom: 32,
      left: 32,
    });

    const html = renderTextBlock(
      { text: "見出し", role: "heading", anchor: "left", verticalAlign: "top" },
      path,
      theme,
      "ja-JP",
      LANDSCAPE_CANVAS,
    );
    expect(html).toContain("padding:32px 32px 32px 32px");
  });

  it("keeps the portrait spacing when the inset is unset", () => {
    expect(textBlockPadding(PORTRAIT_CANVAS, undefined)).toEqual({
      top: 120,
      right: 120,
      bottom: 320,
      left: 72,
    });
  });

  it("lets the portrait safe areas override a tight inset", () => {
    expect(textBlockPadding(PORTRAIT_CANVAS, "tight")).toEqual({
      top: 120,
      right: 120,
      bottom: 320,
      left: 32,
    });
  });

  it("maps wide to the previous spacing", () => {
    expect(textBlockPadding(LANDSCAPE_CANVAS, "wide")).toEqual({
      top: 120,
      right: 140,
      bottom: 120,
      left: 140,
    });
    const html = renderTextBlock(
      { text: "見出し", role: "heading", anchor: "right", verticalAlign: "bottom", inset: "wide" },
      path,
      theme,
      "ja-JP",
      LANDSCAPE_CANVAS,
    );
    expect(html).toContain("padding:120px 140px 120px 140px");
  });
});
