import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { CAPTION_SAFE_AREA_FALLBACK_PX, captionLayoutStyle, captionSafeAreaPx } from "./caption-layout";

const theme = getVisualTheme("soft-editorial", 1)!;

describe("captionSafeAreaPx", () => {
  it("reserves two caption lines plus the caption surface padding", () => {
    // 72 bottom offset + 2 * (40px * 1.5) lines + 2 * 12px padding
    expect(captionSafeAreaPx(theme)).toBe(216);
  });

  it("follows the caption style of the theme", () => {
    const larger = {
      ...theme,
      textRoles: { ...theme.textRoles, caption: { ...theme.textRoles.caption, fontSize: 60 } },
    };
    expect(captionSafeAreaPx(larger)).toBe(276);
  });

  it("keeps the CSS padding fallback when the caption surface is disabled", () => {
    const caption = theme.surfaces!.caption!;
    const disabled = {
      ...theme,
      surfaces: { ...theme.surfaces, caption: { ...caption, enabled: false } },
    };
    expect(captionSafeAreaPx(disabled)).toBe(216);
  });

  it("emits the caption geometry as root custom properties", () => {
    expect(captionLayoutStyle(theme)).toBe(
      "--kakeai-caption-offset:72px;--kakeai-caption-safe:216px",
    );
  });

  it("keeps the fragment fallback in sync with the default theme", () => {
    expect(CAPTION_SAFE_AREA_FALLBACK_PX).toBe(captionSafeAreaPx(theme));
  });
});
