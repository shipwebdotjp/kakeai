import { describe, expect, it } from "vitest";
import {
  buildCatalogFaces,
  FakeFontCatalogAdapter,
  FontCatalogService,
  findLocalFace,
  type FontCatalogAdapter,
} from "./font-catalog.ts";
import { FakeFontVerifier } from "./font-verifier.ts";
import { getVisualTheme, visualThemeDefinitionSchema, type FontFace, type VisualThemeDefinition, type VisualThemeTextRole } from "@kakeai/contracts";

describe("buildCatalogFaces", () => {
  it("reads the family from the typeface instead of the font file name", () => {
    const faces = buildCatalogFaces([
      {
        _name: "YuMincho.ttc",
        typefaces: [
          {
            _name: "YuMin-Medium",
            family: "游明朝体",
            fullname: "游明朝体 ミディアム",
            style: "ミディアム",
          },
          {
            _name: "YuMin_36pKn-Extrabold",
            family: "游明朝体+36ポかな",
            fullname: "游明朝体+36ポかな エクストラボールド",
            style: "エクストラボールド",
          },
        ],
      },
    ]);

    expect(faces.map((face) => face.postScriptName)).toEqual([
      "YuMin-Medium",
      "YuMin_36pKn-Extrabold",
    ]);
    expect(faces[0]!.family).toBe("游明朝体");
    expect(faces[0]!.weight).toBe(500);
    expect(faces[0]!.platformId).toBe("YuMin-Medium");
    expect(faces[1]!.weight).toBe(800);
  });

  it("strips the file extension when a typeface has no family", () => {
    const faces = buildCatalogFaces([
      { _name: "NotoSansJP-Regular.otf", typefaces: [{ _name: "NotoSansJP-Regular" }] },
    ]);
    expect(faces[0]!.family).toBe("NotoSansJP-Regular");
    expect(faces[0]!.postScriptName).toBe("NotoSansJP-Regular");
    expect(faces[0]!.weight).toBe(400);
  });

  it("reads italic and bold faces from English metadata", () => {
    const faces = buildCatalogFaces([
      {
        _name: "Family.ttc",
        typefaces: [
          { _name: "Family-BoldItalic", family: "Family", style: "Bold Italic" },
          { _name: "Family-Light", family: "Family", style: "Light" },
          { _name: "Family-Demibold", family: "Family", style: "Demibold" },
        ],
      },
    ]);
    expect(faces.map((face) => [face.weight, face.style])).toEqual([
      [700, "italic"],
      [300, "normal"],
      [600, "normal"],
    ]);
  });

  it("ignores malformed payloads", () => {
    expect(buildCatalogFaces(undefined)).toEqual([]);
    expect(buildCatalogFaces([{ _name: "NoFaces.ttc" }, null])).toEqual([]);
  });
});

class CountingAdapter implements FontCatalogAdapter {
  calls = 0;
  constructor(private readonly faces: FontFace[] = []) {}
  async getCatalog() {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { supported: true, faces: this.faces, reason: null };
  }
}

const faces: FontFace[] = [
  {
    platformId: "HiraginoSans-W3",
    family: "Hiragino Sans",
    displayName: "Hiragino Sans W3",
    postScriptName: "HiraginoSans-W3",
    weight: 400,
    style: "normal",
    stretch: "normal",
    available: true,
  },
  {
    platformId: "HiraginoSans-W6",
    family: "Hiragino Sans",
    displayName: "Hiragino Sans W6",
    postScriptName: "HiraginoSans-W6",
    weight: 700,
    style: "normal",
    stretch: "normal",
    available: true,
  },
];

function themeWithFonts(): VisualThemeDefinition {
  const base = getVisualTheme("soft-editorial", 1)!;
  const withFace = (
    role: VisualThemeTextRole,
    family: string,
    platformId: string,
    weight: number,
  ) => ({
    ...base.textRoles[role],
    fontFace: { platformId, family, style: "normal" as const, weight, fallbacks: [] },
  });
  return visualThemeDefinitionSchema.parse({
    ...base,
    themeDefinitionSchemaVersion: 2,
    skin: { id: "neutral", version: 1 },
    textRoles: {
      ...base.textRoles,
      title: withFace("title", "Hiragino Sans", "HiraginoSans-W6", 700),
      body: withFace("body", "No Such Font", "NoSuchFont-Regular", 400),
    },
  });
}

describe("FontCatalogService", () => {
  it("shares one in-flight fetch between concurrent callers", async () => {
    const adapter = new CountingAdapter();
    const service = new FontCatalogService(adapter);
    const [first, second] = await Promise.all([service.getCatalog(), service.getCatalog()]);
    expect(adapter.calls).toBe(1);
    expect(first).toBe(second);
  });

  it("serves the cached catalog sequentially and refetches on forceRefresh", async () => {
    const adapter = new CountingAdapter();
    const service = new FontCatalogService(adapter);
    const first = await service.getCatalog();
    const second = await service.getCatalog();
    expect(adapter.calls).toBe(1);
    expect(second).toBe(first);
    await service.getCatalog(true);
    expect(adapter.calls).toBe(2);
  });

  it("resolves the exact local face for a family and weight", () => {
    const catalog = { supported: true, faces, reason: null, updatedAt: "2026-01-01T00:00:00.000Z" };
    const byPlatform = findLocalFace(
      { platformId: "HiraginoSans-W6", family: "Hiragino Sans", style: "normal", weight: 700, fallbacks: [] },
      catalog,
    );
    expect(byPlatform?.postScriptName).toBe("HiraginoSans-W6");

    const byWeight = findLocalFace(
      { family: "Hiragino Sans", style: "normal", weight: 700, fallbacks: [] },
      catalog,
    );
    expect(byWeight?.postScriptName).toBe("HiraginoSans-W6");

    const unknown = findLocalFace(
      { family: "No Such Font", style: "normal", weight: 400, fallbacks: [] },
      catalog,
    );
    expect(unknown).toBeUndefined();
  });

  it("uses Chromium-verified faces and falls back for unverified or unknown faces", async () => {
    const theme = themeWithFonts();
    const verifiedService = new FontCatalogService(
      new FakeFontCatalogAdapter(true, faces),
      new FakeFontVerifier({ verified: ["HiraginoSans-W6"] }),
    );
    const verified = await verifiedService.resolveThemeFonts(theme, { verify: true });
    const title = verified.roles.find((role) => role.role === "title")!;
    expect(title.localFaceName).toBe("HiraginoSans-W6");
    expect(title.localFaceWeight).toBe(700);
    expect(title.usesFallback).toBe(false);
    const titleLine = verified.diagnostics.find((line) => line.startsWith("title:"))!;
    expect(titleLine).not.toContain("解決できない");
    expect(verified.missingFonts).toContain("No Such Font");
    expect(verified.missingFonts).not.toContain("Hiragino Sans");

    const unverifiedService = new FontCatalogService(
      new FakeFontCatalogAdapter(true, faces),
      new FakeFontVerifier({ verified: [] }),
    );
    const unverified = await unverifiedService.resolveThemeFonts(theme, { verify: true });
    const unverifiedTitle = unverified.roles.find((role) => role.role === "title")!;
    expect(unverifiedTitle.localFaceName).toBeUndefined();
    expect(unverifiedTitle.usesFallback).toBe(true);
    expect(unverified.missingFonts).toContain("Hiragino Sans");
    expect(unverified.diagnostics.join("\n")).toContain("Chromiumで解決できない");
  });

  it("treats faces as usable when Chromium verification is unavailable", async () => {
    const service = new FontCatalogService(new FakeFontCatalogAdapter(true, faces));
    const resolution = await service.resolveThemeFonts(themeWithFonts(), { verify: true });
    const title = resolution.roles.find((role) => role.role === "title")!;
    expect(title.localFaceName).toBe("HiraginoSans-W6");
    expect(title.usesFallback).toBe(false);
    expect(resolution.verificationSupported).toBe(false);
    expect(resolution.missingFonts).not.toContain("Hiragino Sans");
    expect(resolution.diagnostics.join("\n")).toContain("Chromium未検証");
  });

  it("falls back for every font when the catalog is unsupported", async () => {
    const service = new FontCatalogService(
      new FakeFontCatalogAdapter(false, [], "unsupported_platform"),
    );
    const resolution = await service.resolveThemeFonts(themeWithFonts(), { verify: true });
    expect(resolution.catalogSupported).toBe(false);
    expect(resolution.missingFonts).toEqual([]);
    expect(resolution.roles.every((role) => role.usesFallback)).toBe(true);
  });

  it("annotates catalog faces that Chromium verification has checked", async () => {
    const service = new FontCatalogService(
      new FakeFontCatalogAdapter(true, faces),
      new FakeFontVerifier({ verified: ["HiraginoSans-W6"] }),
    );
    const before = await service.getCatalog();
    expect(before.faces.every((face) => face.verifiedLocalFace === undefined)).toBe(true);

    await service.resolveThemeFonts(themeWithFonts(), { verify: true });
    const after = await service.getCatalog();
    expect(after.faces.find((face) => face.postScriptName === "HiraginoSans-W6")?.verifiedLocalFace).toBe(true);
    expect(after.faces.find((face) => face.postScriptName === "HiraginoSans-W3")?.verifiedLocalFace).toBeUndefined();
  });
});
