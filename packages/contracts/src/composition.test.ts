import { describe, expect, it } from "vitest";
import {
  CANVAS_PROFILE_DIMENSIONS,
  canvasProfileOf,
  compositionManifestSchema,
  compositionSchema,
  compositionSkinRelation,
  type CompositionStyleProvenance,
} from "./composition";
import {
  createCompositionRequestSchema,
  compositionDraftManifestInputSchema,
  listCompositionsQuerySchema,
} from "./requests";

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
      scope: "shared",
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
        scope: "shared",
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
        scope: "shared",
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

describe("composition scope", () => {
  function createRequest(overrides: Record<string, unknown> = {}) {
    return {
      name: "Motion",
      runtimeCompositionId: "cmp.test",
      scope: "shared",
      ...overrides,
    };
  }

  it("requires a scope and binds workId to the work scope", () => {
    expect(
      createCompositionRequestSchema.safeParse({
        name: "Motion",
        runtimeCompositionId: "cmp.test",
      }).success,
    ).toBe(false);
    expect(createCompositionRequestSchema.safeParse(createRequest()).success).toBe(true);
    expect(
      createCompositionRequestSchema.safeParse(
        createRequest({ scope: "work", workId: "work-1" }),
      ).success,
    ).toBe(true);
    expect(
      createCompositionRequestSchema.safeParse(createRequest({ scope: "work" })).success,
    ).toBe(false);
    expect(
      createCompositionRequestSchema.safeParse(
        createRequest({ scope: "shared", workId: "work-1" }),
      ).success,
    ).toBe(false);
    expect(
      createCompositionRequestSchema.safeParse(
        createRequest({ scope: "unclassified" }),
      ).success,
    ).toBe(false);
  });

  it("keeps the DTO scope and workId consistent", () => {
    const base = {
      id: "cmp-1",
      name: "Motion",
      runtimeCompositionId: "cmp.test",
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(
      compositionSchema.safeParse({ ...base, scope: "work", workId: "work-1" }).success,
    ).toBe(true);
    expect(compositionSchema.safeParse({ ...base, scope: "work", workId: null }).success).toBe(
      false,
    );
    expect(
      compositionSchema.safeParse({ ...base, scope: "shared", workId: null }).success,
    ).toBe(true);
    expect(
      compositionSchema.safeParse({ ...base, scope: "shared", workId: "work-1" }).success,
    ).toBe(false);
  });

  it("requires workId when the list query filters to work scope", () => {
    expect(listCompositionsQuerySchema.safeParse({}).success).toBe(true);
    expect(listCompositionsQuerySchema.safeParse({ scope: "work" }).success).toBe(false);
    expect(
      listCompositionsQuerySchema.safeParse({ scope: "work", workId: "work-1" }).success,
    ).toBe(true);
    expect(
      listCompositionsQuerySchema.safeParse({ scope: "shared", workId: "work-1" }).success,
    ).toBe(false);
  });
});
