import { describe, expect, it } from "vitest";
import { getVisualTheme } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import type { AssetResolver } from "../resolver";
import { compileThumbnail } from "./compile";
import { THUMBNAIL_OUTPUT_HEIGHT, THUMBNAIL_OUTPUT_WIDTH } from "../meta";

const theme = getVisualTheme("soft-editorial", 1);
if (theme === undefined) {
  throw new Error("soft-editorial@1 is required for tests");
}

const assetResolver: AssetResolver = (assetId) => ({ url: `/preview/${assetId}`, kind: "image" });

describe("compileThumbnail", () => {
  it("renders a headline-photo thumbnail at 1280x720", () => {
    const compiled = compileThumbnail({
      document: {
        schemaVersion: 1,
        template: { id: "thumbnail.headline-photo", version: 1 },
        input: { headline: "テスト見出し", assetId: "ast_photo", layout: "photo-left" },
      },
      theme,
      assetResolver,
    });
    expect(compiled.width).toBe(THUMBNAIL_OUTPUT_WIDTH);
    expect(compiled.height).toBe(THUMBNAIL_OUTPUT_HEIGHT);
    expect(compiled.html).toContain("/preview/ast_photo");
    expect(compiled.html).toContain("テスト見出し");
    expect(compiled.assetIds).toEqual(["ast_photo"]);
  });

  it("changes the photo side with the layout variant", () => {
    const base = {
      schemaVersion: 1 as const,
      template: { id: "thumbnail.headline-photo", version: 1 },
      input: { headline: "x", assetId: "ast_photo" },
    };
    const left = compileThumbnail({
      document: { ...base, input: { ...base.input, layout: "photo-left" } },
      theme,
      assetResolver,
    });
    const right = compileThumbnail({
      document: { ...base, input: { ...base.input, layout: "photo-right" } },
      theme,
      assetResolver,
    });
    expect(left.html).not.toBe(right.html);
  });

  it("renders a text-only thumbnail with no asset references", () => {
    const compiled = compileThumbnail({
      document: {
        schemaVersion: 1,
        template: { id: "thumbnail.text", version: 1 },
        input: { headline: "文字だけ" },
      },
      theme,
      assetResolver,
    });
    expect(compiled.assetIds).toEqual([]);
    expect(compiled.html).toContain("文字だけ");
  });

  it("fails on an unknown template", () => {
    expect(() =>
      compileThumbnail({
        document: {
          schemaVersion: 1 as const,
          template: { id: "thumbnail.missing", version: 1 },
          input: {},
        },
        theme,
        assetResolver,
      }),
    ).toThrow(CompositionCompileError);
  });

  it("fails on invalid input", () => {
    expect(() =>
      compileThumbnail({
        document: {
          schemaVersion: 1 as const,
          template: { id: "thumbnail.headline-photo", version: 1 },
          input: { headline: "x" },
        },
        theme,
        assetResolver,
      }),
    ).toThrow(CompositionCompileError);
  });
});
