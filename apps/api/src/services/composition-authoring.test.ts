import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HANDMADE_PAPER_SKIN_REF,
  getVisualTheme,
  toVisualThemeDefinitionV2,
  type FontFace,
  type VisualThemeDefinitionV2,
} from "@kakeai/contracts";
import { CompositionAuthoringService } from "./authoring-context.ts";
import { CompositionService } from "./compositions.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "./font-catalog.ts";
import { FakeFontVerifier } from "./font-verifier.ts";
import { ThemeService } from "./themes.ts";
import { dataDirectories, ensureDataDirectories } from "../storage/paths.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { loadConfig } from "../config.ts";

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

describe("Composition Authoring Context and Style Kit", () => {
  let tmpDir: string;
  let prisma: ReturnType<typeof createPrismaClient>;
  let compositionService: CompositionService;
  let authoringService: CompositionAuthoringService;
  let themeService: ThemeService;

  beforeEach(async () => {
    tmpDir = join(process.cwd(), "tmp-test-authoring-" + Math.random().toString(36).slice(2));
    process.env.KAKEAI_DATA_DIR = tmpDir;
    const config = loadConfig();
    await ensureDataDirectories(dataDirectories(tmpDir));
    await runMigrations();
    prisma = createPrismaClient(config.databaseUrl);
    await applySqlitePragmas(prisma);

    const fontCatalogService = new FontCatalogService(new FakeFontCatalogAdapter(true, faces));
    compositionService = new CompositionService({ db: prisma, dataDir: tmpDir });
    authoringService = new CompositionAuthoringService({ db: prisma, fontCatalogService });
    themeService = new ThemeService(prisma, fontCatalogService);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    delete process.env.KAKEAI_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  async function publishPaperTheme(): Promise<{ themeId: string; version: number }> {
    const created = await themeService.createTheme({
      name: "Paper Theme",
      sourceThemeRef: { id: "soft-editorial", version: 1 },
    });
    const definition: VisualThemeDefinitionV2 = toVisualThemeDefinitionV2(
      created.draft!.definition,
      HANDMADE_PAPER_SKIN_REF,
    );
    definition.textRoles.title = {
      ...definition.textRoles.title,
      fontFace: {
        platformId: "HiraginoSans-W6",
        family: "Hiragino Sans",
        style: "normal",
        weight: 700,
        fallbacks: [],
      },
    };
    await themeService.updateThemeDraft(created.id, definition);
    const published = await themeService.publishThemeDraft(created.id);
    return { themeId: created.id, version: published.latestRevision!.version };
  }

  async function createSkinnedComposition() {
    const { themeId, version } = await publishPaperTheme();
    const resolved = await authoringService.resolve({
      visualTheme: { id: themeId, version },
    });
    const composition = await compositionService.createComposition({
      name: "Skinned Motion",
      runtimeCompositionId: "cmp.skin.paper",
      authoringStyle: { provenance: resolved.provenance, kitFiles: resolved.kitFiles },
    });
    return { themeId, version, resolved, composition };
  }

  it("resolves a non-persistent context with a stable kit hash", async () => {
    const { themeId, version } = await publishPaperTheme();
    const countsBefore = {
      compositions: await prisma.composition.count(),
      drafts: await prisma.compositionDraft.count(),
      versions: await prisma.compositionVersion.count(),
      themes: await prisma.theme.count(),
      revisions: await prisma.themeRevision.count(),
      jobs: await prisma.job.count(),
    };

    const first = await authoringService.resolve({ visualTheme: { id: themeId, version } });
    const second = await authoringService.resolve({ visualTheme: { id: themeId, version } });

    expect(first.context.skin).toEqual(HANDMADE_PAPER_SKIN_REF);
    expect(first.context.theme.ref).toEqual({ id: themeId, version });
    expect(first.context.canvasProfile).toBe("landscape");
    expect(first.context.seed.styleDirectory).toBe("kakeai-style/");
    expect(first.context.kit.version).toBe(1);
    expect(first.context.kit.hash).toMatch(/^sha256:/);
    expect(first.context.brief.intent.length).toBeGreaterThan(0);
    expect(first.context.fontDiagnostics.join("\n")).toContain("HiraginoSans-W6");
    expect(first.context).toEqual(second.context);
    expect(first.provenance).toEqual(second.provenance);

    expect(await prisma.composition.count()).toBe(countsBefore.compositions);
    expect(await prisma.compositionDraft.count()).toBe(countsBefore.drafts);
    expect(await prisma.compositionVersion.count()).toBe(countsBefore.versions);
    expect(await prisma.theme.count()).toBe(countsBefore.themes);
    expect(await prisma.themeRevision.count()).toBe(countsBefore.revisions);
    expect(await prisma.job.count()).toBe(countsBefore.jobs);
  });

  it("resolves neutral for a v1 built-in theme and keeps the requested canvas profile", async () => {
    const resolved = await authoringService.resolve({
      visualTheme: { id: "soft-editorial", version: 1 },
      canvasProfile: "portrait",
    });
    expect(resolved.context.skin).toEqual({ id: "neutral", version: 1 });
    expect(resolved.context.canvasProfile).toBe("portrait");
    expect(resolved.kitFiles["components.css"]).toContain(".kk-surface");
  });

  it("generates fonts.css only from Chromium-verified local faces", async () => {
    const { themeId, version } = await publishPaperTheme();
    const withVerified = new CompositionAuthoringService({
      db: prisma,
      fontCatalogService: new FontCatalogService(
        new FakeFontCatalogAdapter(true, faces),
        new FakeFontVerifier({ verified: ["HiraginoSans-W6"] }),
      ),
    });
    const verified = await withVerified.resolve({ visualTheme: { id: themeId, version } });
    expect(verified.kitFiles["fonts.css"]).toContain('local("HiraginoSans-W6")');
    expect(verified.context.fontDiagnostics.join("\n")).not.toContain("解決できない");

    const withUnverified = new CompositionAuthoringService({
      db: prisma,
      fontCatalogService: new FontCatalogService(
        new FakeFontCatalogAdapter(true, faces),
        new FakeFontVerifier({ verified: [] }),
      ),
    });
    const unverified = await withUnverified.resolve({ visualTheme: { id: themeId, version } });
    expect(unverified.kitFiles["fonts.css"]).not.toContain('local("HiraginoSans-W6")');
    expect(unverified.kitFiles["fonts.css"]).toContain("--kakeai-font-title: sans-serif;");
    expect(unverified.context.fontDiagnostics.join("\n")).toContain("Chromiumで解決できない");
    expect(unverified.provenance.fontDiagnostics).toEqual(unverified.context.fontDiagnostics);
  });

  it("rejects unknown themes and draft-only themes", async () => {
    await expect(
      authoringService.resolve({ visualTheme: { id: "no-such-theme", version: 1 } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const draftOnly = await themeService.createTheme({ name: "Draft Only" });
    await expect(
      authoringService.resolve({ visualTheme: { id: draftOnly.id, version: 1 } }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("seeds the Style Kit into the draft and reads it back", async () => {
    const { resolved, composition } = await createSkinnedComposition();
    expect(composition.draft?.styleProvenance).toEqual(resolved.provenance);

    const files = await compositionService.getDraftFiles(composition.id);
    expect(Object.keys(files.files).sort()).toEqual([
      "kakeai-style/STYLE.md",
      "kakeai-style/components.css",
      "kakeai-style/fonts.css",
      "kakeai-style/kit-lock.json",
      "kakeai-style/tokens.css",
      "index.html",
      "manifest.json",
    ].sort());
    expect(files.files["kakeai-style/STYLE.md"]).toContain("Handmade Paper");
    expect(files.files["kakeai-style/fonts.css"]).toContain("HiraginoSans-W6");
    expect(files.files["kakeai-style/kit-lock.json"]).toContain(resolved.context.kit.hash);
  });

  it("rejects draft updates that touch the Style Kit directory", async () => {
    const { composition } = await createSkinnedComposition();
    await expect(
      compositionService.updateDraft(composition.id, {
        files: { "kakeai-style/STYLE.md": "tampered" },
      }),
    ).rejects.toMatchObject({ code: "STYLE_KIT_MODIFIED" });
    await expect(
      compositionService.updateDraft(composition.id, {
        filesBase64: { "kakeai-style/assets/logo.png": "aGk=" },
      }),
    ).rejects.toMatchObject({ code: "STYLE_KIT_MODIFIED" });
    await expect(
      compositionService.updateDraft(composition.id, { entrypoint: "kakeai-style/index.html" }),
    ).rejects.toMatchObject({ code: "STYLE_KIT_MODIFIED" });
  });

  it("rejects publish when a protected kit file was modified on disk", async () => {
    const { composition } = await createSkinnedComposition();
    const draftDir = join(dataDirectories(tmpDir).root, composition.draft!.storageKey);
    await writeFile(join(draftDir, "kakeai-style/STYLE.md"), "tampered", "utf-8");

    await expect(compositionService.validateDraft(composition.id, {})).rejects.toMatchObject({
      code: "STYLE_KIT_MODIFIED",
    });
    await expect(compositionService.publish(composition.id, {})).rejects.toMatchObject({
      code: "STYLE_KIT_MODIFIED",
    });
  });

  it("rejects publish when the kit directory has extra files", async () => {
    const { composition } = await createSkinnedComposition();
    const draftDir = join(dataDirectories(tmpDir).root, composition.draft!.storageKey);
    await writeFile(join(draftDir, "kakeai-style/extra.css"), "body{}", "utf-8");

    await expect(compositionService.publish(composition.id, {})).rejects.toMatchObject({
      code: "STYLE_KIT_MODIFIED",
    });
  });

  it("normalizes protected paths and fails closed on corrupt provenance", async () => {
    await expect(
      compositionService.createComposition({
        name: "Protected Entry",
        runtimeCompositionId: "cmp.skin.protected",
        entrypoint: "./kakeai-style/index.html",
      }),
    ).rejects.toMatchObject({ code: "STYLE_KIT_MODIFIED" });

    const { composition } = await createSkinnedComposition();
    await expect(
      compositionService.updateDraft(composition.id, {
        entrypoint: "./kakeai-style/index.html",
      }),
    ).rejects.toMatchObject({ code: "STYLE_KIT_MODIFIED" });

    const corrupt = await compositionService.createComposition({
      name: "Corrupt Provenance",
      runtimeCompositionId: "cmp.skin.corrupt",
    });
    await prisma.compositionDraft.update({
      where: { compositionId: corrupt.id },
      data: { authoringStyleJson: "{not json" },
    });
    await expect(compositionService.getCompositionById(corrupt.id)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });

  it("publishes the provenance and copies the kit into the immutable bundle", async () => {
    const { themeId, version, resolved, composition } = await createSkinnedComposition();
    const published = await compositionService.publish(composition.id, {});

    expect(published.styleProvenance).toEqual(resolved.provenance);
    expect(published.styleProvenance).toMatchObject({
      kind: "authored",
      theme: { ref: { id: themeId, version } },
      skin: HANDMADE_PAPER_SKIN_REF,
    });

    const bundleFile = join(
      dataDirectories(tmpDir).root,
      published.storageKey,
      "kakeai-style/kit-lock.json",
    );
    const lockContent = await readFile(bundleFile, "utf-8");
    expect(lockContent).toContain(resolved.context.kit.hash);

    const definition = toVisualThemeDefinitionV2(
      getVisualTheme("soft-editorial", 1)!,
      HANDMADE_PAPER_SKIN_REF,
    );
    await themeService.updateThemeDraft(themeId, {
      ...definition,
      canvas: { base: "#000000", ink: "#FFFFFF" },
    });
    await themeService.publishThemeDraft(themeId);

    const reloaded = await compositionService.getVersionById(published.id);
    expect(reloaded.styleProvenance).toEqual(resolved.provenance);
  });

  it("stores neutral provenance for new compositions and reads legacy rows as legacy", async () => {
    const neutral = await compositionService.createComposition({
      name: "Neutral Motion",
      runtimeCompositionId: "cmp.skin.neutral",
    });
    expect(neutral.draft?.styleProvenance).toEqual({ kind: "neutral" });

    const version = await compositionService.publish(neutral.id, {});
    expect(version.styleProvenance).toEqual({ kind: "neutral" });

    await prisma.compositionVersion.update({
      where: { id: version.id },
      data: { styleProvenanceJson: null },
    });
    const legacy = await compositionService.getVersionById(version.id);
    expect(legacy.styleProvenance).toEqual({ kind: "legacy" });

    await prisma.compositionDraft.update({
      where: { compositionId: neutral.id },
      data: { authoringStyleJson: null },
    });
    const legacyDraft = await compositionService.getCompositionById(neutral.id);
    expect(legacyDraft.draft?.styleProvenance).toEqual({ kind: "legacy" });
  });
});
