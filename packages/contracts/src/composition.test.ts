import { describe, expect, it } from "vitest";
import {
  CANVAS_PROFILE_DIMENSIONS,
  canvasProfileOf,
  compositionManifestSchema,
  compositionSkinRelation,
  type CompositionStyleProvenance,
} from "./composition";
import { createCompositionRequestSchema, compositionDraftManifestInputSchema } from "./requests";

function landscapeManifest(overrides: Record<string, unknown> = {}) {
  return {
    entrypoint: "index.html",
    runtimeCompositionId: "cmp.test",
    width: 1920,
    height: 1080,
    durationMs: 5000,
    dependencies: [],
    ...overrides,
  };
}

describe("compositionManifestSchema canvas profile", () => {
  it("resolves a legacy manifest without canvasProfile as landscape", () => {
    const parsed = compositionManifestSchema.safeParse(landscapeManifest());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(canvasProfileOf(parsed.data)).toBe("landscape");
    }
  });

  it("accepts a portrait manifest with 1080x1920", () => {
    const parsed = compositionManifestSchema.safeParse(
      landscapeManifest({ canvasProfile: "portrait", width: 1080, height: 1920 }),
    );
    expect(parsed.success).toBe(true);
  });

  it("rejects a profile and dimension mismatch", () => {
    const parsed = compositionManifestSchema.safeParse(
      landscapeManifest({ canvasProfile: "portrait" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects arbitrary canvas dimensions", () => {
    const parsed = compositionManifestSchema.safeParse(
      landscapeManifest({ width: 1000, height: 1000 }),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown canvas profile", () => {
    const parsed = compositionManifestSchema.safeParse(
      landscapeManifest({ canvasProfile: "square" }),
    );
    expect(parsed.success).toBe(false);
  });

  it("exposes the fixed dimensions for each profile", () => {
    expect(CANVAS_PROFILE_DIMENSIONS.landscape).toEqual({ width: 1920, height: 1080 });
    expect(CANVAS_PROFILE_DIMENSIONS.portrait).toEqual({ width: 1080, height: 1920 });
  });
});

describe("canvas profile request fields", () => {
  it("defaults creation to landscape when omitted", () => {
    const parsed = createCompositionRequestSchema.safeParse({
      name: "Motion",
      runtimeCompositionId: "cmp.test",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.canvasProfile).toBeUndefined();
    }
  });

  it("accepts portrait on creation and draft manifest updates", () => {
    expect(
      createCompositionRequestSchema.safeParse({
        name: "Motion",
        runtimeCompositionId: "cmp.test",
        canvasProfile: "portrait",
      }).success,
    ).toBe(true);
    expect(compositionDraftManifestInputSchema.safeParse({ canvasProfile: "portrait" }).success).toBe(
      true,
    );
  });

  it("rejects an unknown profile on requests", () => {
    expect(
      createCompositionRequestSchema.safeParse({
        name: "Motion",
        runtimeCompositionId: "cmp.test",
        canvasProfile: "square",
      }).success,
    ).toBe(false);
  });
});

describe("compositionSkinRelation", () => {
  const scriptSkin = { id: "handmade-paper", version: 1 };
  const authored = (skin: { id: string; version: number }): CompositionStyleProvenance => ({
    kind: "authored",
    contextSchemaVersion: 1,
    theme: { ref: { id: "theme_1", version: 1 }, definitionHash: "sha256:abc" },
    skin,
    kit: { version: 1, hash: "sha256:def", files: {} },
    canvasProfile: "landscape",
    fontDiagnostics: [],
  });

  it("reports the same skin", () => {
    expect(compositionSkinRelation(scriptSkin, authored(scriptSkin))).toBe("same");
  });

  it("reports a different skin", () => {
    expect(compositionSkinRelation(scriptSkin, authored({ id: "neutral", version: 1 }))).toBe(
      "different",
    );
  });

  it("reports neutral and legacy provenance", () => {
    expect(compositionSkinRelation(scriptSkin, { kind: "neutral" })).toBe("neutral");
    expect(compositionSkinRelation(scriptSkin, { kind: "legacy" })).toBe("legacy");
    expect(compositionSkinRelation(scriptSkin, undefined)).toBe("legacy");
  });
});
