import { describe, expect, it } from "vitest";
import { RICH_TEXT_DELIMITER, wrapSelection } from "./richTextEditing";

describe("RICH_TEXT_DELIMITER", () => {
  it("maps every mark to its markup pair", () => {
    expect(RICH_TEXT_DELIMITER.bold).toBe("**");
    expect(RICH_TEXT_DELIMITER.italic).toBe("*");
    expect(RICH_TEXT_DELIMITER.accent).toBe("==");
    expect(RICH_TEXT_DELIMITER.outline).toBe("%%");
  });
});

describe("wrapSelection", () => {
  it("wraps the selected range and keeps it selected", () => {
    expect(wrapSelection("見出しです", 0, 3, "bold")).toEqual({
      value: "**見出し**です",
      selectionStart: 2,
      selectionEnd: 5,
    });
  });

  it("wraps a range in the middle of the value", () => {
    expect(wrapSelection("abcあいう", 3, 6, "italic")).toEqual({
      value: "abc*あいう*",
      selectionStart: 4,
      selectionEnd: 7,
    });
  });

  it("uses the mark-specific delimiter", () => {
    expect(wrapSelection("x", 0, 1, "accent").value).toBe("==x==");
    expect(wrapSelection("x", 0, 1, "outline").value).toBe("%%x%%");
  });

  it("inserts an empty pair and places the caret between the delimiters", () => {
    expect(wrapSelection("前後", 1, 1, "bold")).toEqual({
      value: "前****後",
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it("inserts an empty pair in an empty value", () => {
    expect(wrapSelection("", 0, 0, "accent")).toEqual({
      value: "====",
      selectionStart: 2,
      selectionEnd: 2,
    });
  });

  it("treats a reversed range as a normal selection", () => {
    expect(wrapSelection("abcdef", 4, 1, "bold")).toEqual({
      value: "a**bcd**ef",
      selectionStart: 3,
      selectionEnd: 6,
    });
  });

  it("clamps out-of-range indices to the value length", () => {
    expect(wrapSelection("ab", 5, 9, "bold")).toEqual({
      value: "ab****",
      selectionStart: 4,
      selectionEnd: 4,
    });
    expect(wrapSelection("ab", -3, 1, "bold")).toEqual({
      value: "**a**b",
      selectionStart: 2,
      selectionEnd: 3,
    });
  });

  it("unwraps a range that already carries the same mark", () => {
    expect(wrapSelection("**強調**です", 2, 4, "bold")).toEqual({
      value: "強調です",
      selectionStart: 0,
      selectionEnd: 2,
    });
  });

  it("leaves interior escape sequences untouched", () => {
    expect(wrapSelection("a\\*b", 1, 3, "bold")).toEqual({
      value: "a**\\***b",
      selectionStart: 3,
      selectionEnd: 5,
    });
  });

  it("guards a trailing backslash inside the selection", () => {
    expect(wrapSelection("ab\\", 0, 3, "bold")).toEqual({
      value: "**ab\\\\**",
      selectionStart: 2,
      selectionEnd: 6,
    });
  });

  it("guards a trailing backslash before the opening delimiter", () => {
    expect(wrapSelection("a\\", 2, 2, "accent")).toEqual({
      value: "a\\\\====",
      selectionStart: 5,
      selectionEnd: 5,
    });
  });
});
