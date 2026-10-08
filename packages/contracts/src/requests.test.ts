import { describe, expect, it } from "vitest";
import { createWorkRequestSchema, saveScriptVersionRequestSchema } from "./requests";
import { validContentDocument } from "./testing/fixtures";

describe("createWorkRequestSchema", () => {
  it("accepts a valid request", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "ja-JP" }).success,
    ).toBe(true);
  });

  it("rejects unknown fields", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "ja-JP", extra: 1 }).success,
    ).toBe(false);
  });

  it("rejects an unsupported locale", () => {
    expect(
      createWorkRequestSchema.safeParse({ title: "作品", originalLocale: "en-US" }).success,
    ).toBe(false);
  });
});

describe("saveScriptVersionRequestSchema", () => {
  it("defaults sourceScriptVersionId to null", () => {
    const result = saveScriptVersionRequestSchema.parse({ content: validContentDocument() });
    expect(result.sourceScriptVersionId).toBeNull();
  });

  it("rejects unknown fields", () => {
    const result = saveScriptVersionRequestSchema.safeParse({
      content: validContentDocument(),
      extra: true,
    });
    expect(result.success).toBe(false);
  });
});
