import { describe, expect, it } from "vitest";
import { countCodePoints } from "@kakeai/contracts";
import {
  insertChaptersIntoDescription,
  localDatetimeInputToUtcIso,
  utcIsoToLocalDatetimeInput,
} from "./youtubeSettings";

describe("YouTube settings UI helpers", () => {
  it("converts UTC ISO 8601 string to local datetime-local input format and back", () => {
    const isoUtc = "2026-12-31T12:00:00.000Z";
    const localInput = utcIsoToLocalDatetimeInput(isoUtc);
    expect(localInput).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    const convertedUtc = localDatetimeInputToUtcIso(localInput);
    expect(convertedUtc).not.toBeNull();
    expect(new Date(convertedUtc!).getTime()).toBe(new Date(localInput).getTime());
  });

  it("handles empty or null datetime values", () => {
    expect(utcIsoToLocalDatetimeInput(null)).toBe("");
    expect(utcIsoToLocalDatetimeInput("")).toBe("");
    expect(localDatetimeInputToUtcIso("")).toBeNull();
  });

  it("inserts chapter text into description at cursor position, trimming blank lines", () => {
    const current = "動画の説明文テキスト。";
    const chapters = "\n\n00:00 導入\n00:10 要点1\n00:20 結び\n\n";

    const result = insertChaptersIntoDescription(current, chapters, current.length, current.length);
    expect(result).toBe("動画の説明文テキスト。\n00:00 導入\n00:10 要点1\n00:20 結び");
  });

  it("replaces selection with trimmed chapter text", () => {
    const current = "前文[SELECTED]後文";
    const selectionStart = "前文".length;
    const selectionEnd = "前文[SELECTED]".length;
    const chapters = "00:00 導入\n00:05 要点";

    const result = insertChaptersIntoDescription(current, chapters, selectionStart, selectionEnd);
    expect(result).toBe("前文\n00:00 導入\n00:05 要点\n後文");
  });

  it("measures description length by code points (not bytes)", () => {
    const ascii = "abc";
    expect(countCodePoints(ascii)).toBe(3);

    const emoji = "😀😁😂"; // 3 emojis, 3 code points, 12 UTF-8 bytes
    expect(countCodePoints(emoji)).toBe(3);
    expect(new TextEncoder().encode(emoji).byteLength).toBe(12);
  });
});
