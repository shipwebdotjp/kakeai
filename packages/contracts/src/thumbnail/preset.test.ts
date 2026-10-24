import { describe, expect, it } from "vitest";
import {
  createThumbnailAppearancePresetRequestSchema,
  updateThumbnailAppearancePresetRequestSchema,
} from "../requests";
import { thumbnailAppearancePresetSummarySchema } from "../dto";

describe("thumbnail appearance preset contracts", () => {
  it("accepts a non-empty sparse appearance and trims the name", () => {
    const parsed = createThumbnailAppearancePresetRequestSchema.parse({
      name: "  チャンネル標準  ",
      appearance: {
        headline: { fontSize: 120, outline: { color: "#00FF00", width: 6 } },
        accent: "#FF00FF",
      },
    });
    expect(parsed.name).toBe("チャンネル標準");
    expect(parsed.appearance.headline?.fontSize).toBe(120);
  });

  it("rejects an empty appearance with a field path", () => {
    const result = createThumbnailAppearancePresetRequestSchema.safeParse({
      name: "空",
      appearance: { headline: {}, scrim: {} },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["appearance"]);
    }
  });

  it("rejects an empty name", () => {
    expect(
      updateThumbnailAppearancePresetRequestSchema.safeParse({
        name: "   ",
        appearance: { accent: "#FF00FF" },
      }).success,
    ).toBe(false);
  });

  it("validates a preset summary DTO", () => {
    expect(
      thumbnailAppearancePresetSummarySchema.safeParse({
        id: "tap_1",
        name: "プリセット",
        createdAt: "2026-10-24T00:00:00.000Z",
        updatedAt: "2026-10-24T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });
});
