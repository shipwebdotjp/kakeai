import { describe, expect, it } from "vitest";
import { parseRichText, richTextStringSchema } from "./rich-text";

describe("parseRichText", () => {
  it("returns plain text as a single span without marks", () => {
    const parsed = parseRichText("ふつうの見出し");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "ふつうの見出し", marks: [] }]);
    expect(parsed.usedMarks).toEqual([]);
  });

  it("applies each mark", () => {
    const parsed = parseRichText("**太字**と*斜体*と==色==と%%縁%%");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([
      { text: "太字", marks: ["bold"] },
      { text: "と", marks: [] },
      { text: "斜体", marks: ["italic"] },
      { text: "と", marks: [] },
      { text: "色", marks: ["accent"] },
      { text: "と", marks: [] },
      { text: "縁", marks: ["outline"] },
    ]);
    expect(parsed.usedMarks).toEqual(["bold", "italic", "accent", "outline"]);
  });

  it("combines nested marks in canonical order", () => {
    const parsed = parseRichText("==**重要**==");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "重要", marks: ["bold", "accent"] }]);
  });

  it("combines bold and italic from a shared run of asterisks", () => {
    const parsed = parseRichText("***重要***");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "重要", marks: ["bold", "italic"] }]);
  });

  it("keeps newlines inside spans", () => {
    const parsed = parseRichText("**一行目\n二行目**");
    expect(parsed.spans).toEqual([{ text: "一行目\n二行目", marks: ["bold"] }]);
  });

  it("merges adjacent spans with the same marks", () => {
    const parsed = parseRichText("**あ****い**");
    expect(parsed.spans).toEqual([{ text: "あい", marks: ["bold"] }]);
  });

  it("escapes delimiters", () => {
    const parsed = parseRichText("\\*\\*そのまま\\*\\*と\\*斜体ではない\\*");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "**そのまま**と*斜体ではない*", marks: [] }]);
  });

  it("renders unmatched delimiters literally", () => {
    const parsed = parseRichText("**閉じない");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "**閉じない", marks: [] }]);
    expect(parsed.usedMarks).toEqual([]);
  });

  it("pairs delimiters in order and keeps the leftover literal", () => {
    const parsed = parseRichText("**強調**と**残り");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([
      { text: "強調", marks: ["bold"] },
      { text: "と**残り", marks: [] },
    ]);
  });

  it("reports marks the field does not accept once and keeps them as text", () => {
    const parsed = parseRichText("**太字**と==色==", { allowedMarks: ["bold"] });
    expect(parsed.errors.map((error) => error.code)).toEqual(["unsupported_mark"]);
    expect(parsed.errors[0]?.mark).toBe("accent");
    expect(parsed.spans).toEqual([
      { text: "太字", marks: ["bold"] },
      { text: "と==色==", marks: [] },
    ]);
  });

  it("does not treat a lone asterisk as a mark", () => {
    const parsed = parseRichText("3*4");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "3*4", marks: [] }]);
  });

  it("keeps underscores inside words", () => {
    const parsed = parseRichText("file_name_here");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "file_name_here", marks: [] }]);
  });

  it("keeps a backslash that is not escaping markup", () => {
    const parsed = parseRichText("C:\\Users\\ship");
    expect(parsed.errors).toEqual([]);
    expect(parsed.spans).toEqual([{ text: "C:\\Users\\ship", marks: [] }]);
  });

  it("does not report marks that decorate no text", () => {
    const parsed = parseRichText("****");
    expect(parsed.spans).toEqual([]);
    expect(parsed.usedMarks).toEqual([]);
    expect(parsed.errors).toEqual([]);
  });
});

describe("richTextStringSchema", () => {
  it("accepts plain and well-formed values", () => {
    const schema = richTextStringSchema(["bold", "accent"]);
    expect(schema.safeParse("**見出し**").success).toBe(true);
  });

  it("accepts unmatched delimiters as literal text", () => {
    const schema = richTextStringSchema(["bold", "italic", "accent", "outline"]);
    expect(schema.safeParse("**閉じない").success).toBe(true);
  });

  it("rejects values with undeclared marks", () => {
    const schema = richTextStringSchema(["bold"]);
    expect(schema.safeParse("==色==").success).toBe(false);
  });
});
