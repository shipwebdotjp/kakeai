import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  getVisualTheme,
  resolveVisualThemeSkin,
} from "@kakeai/contracts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "./font-catalog.ts";
import { ThemeService } from "./themes.ts";
import { ThemeResolver } from "./theme-resolver.ts";
import { compileThemeRepresentativePreview } from "./theme-preview.ts";

let dataDir: string;
let prisma: ReturnType<typeof createPrismaClient>;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-theme-test-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("Theme Services & Routes", () => {
  let fontCatalogService: FontCatalogService;
  let themeService: ThemeService;

  beforeEach(async () => {
    await prisma.themeDraft.deleteMany();
    await prisma.themeRevision.deleteMany();
    await prisma.theme.deleteMany();

    const fakeAdapter = new FakeFontCatalogAdapter(true, [
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
    ]);
    fontCatalogService = new FontCatalogService(fakeAdapter);
    themeService = new ThemeService(prisma, fontCatalogService);
  });

  it("lists built-in themes alongside user themes", async () => {
    const listInitial = await themeService.listThemes();
    expect(listInitial.some((t) => t.id === SOFT_EDITORIAL_THEME_ID)).toBe(true);

    const created = await themeService.createTheme({ name: "カスタムテーマ" });
    expect(created.isBuiltIn).toBe(false);
    expect(created.hasDraft).toBe(true);
    expect(created.latestRevision).toBeNull();

    const listWithUser = await themeService.listThemes();
    expect(listWithUser.some((t) => t.id === created.id)).toBe(true);
  });

  it("duplicates built-in theme into new user theme with draft", async () => {
    const created = await themeService.createTheme({
      name: "My Custom Theme",
      sourceThemeRef: { id: SOFT_EDITORIAL_THEME_ID, version: SOFT_EDITORIAL_THEME_VERSION },
    });

    expect(created.name).toBe("My Custom Theme");
    expect(created.draft).not.toBeNull();
    expect(created.draft?.definition.id).toBe(created.id);
    expect(created.draft?.definition.name).toBe("My Custom Theme");
    expect(created.revisions.length).toBe(0);
  });

  it("updates draft and publishes new revision sequentially", async () => {
    const theme = await themeService.createTheme({ name: "Test Publish" });
    expect(theme.draft).not.toBeNull();

    const draftDef = { ...theme.draft!.definition, canvas: { base: "#000000", ink: "#FFFFFF" } };
    const updated = await themeService.updateThemeDraft(theme.id, draftDef);
    expect(updated.draft?.definition.canvas.base).toBe("#000000");

    const published = await themeService.publishThemeDraft(theme.id);
    expect(published.latestRevision?.version).toBe(1);
    expect(published.latestRevision?.definition.canvas.base).toBe("#000000");
    expect(published.hasDraft).toBe(false);

    // Create a new draft and publish revision 2
    await themeService.updateThemeDraft(theme.id, {
      ...published.latestRevision!.definition,
      canvas: { base: "#112233", ink: "#FFEEDD" },
    });
    const published2 = await themeService.publishThemeDraft(theme.id);
    expect(published2.latestRevision?.version).toBe(2);
    expect(published2.revisions.length).toBe(2);
  });

  it("upgrades legacy v1 definitions to v2 with an explicit neutral skin", async () => {
    const theme = await themeService.createTheme({ name: "Skinned" });
    expect(theme.draft?.definition.themeDefinitionSchemaVersion).toBe(2);
    expect(resolveVisualThemeSkin(theme.draft!.definition)).toEqual({ id: "neutral", version: 1 });

    const legacy = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    expect(legacy.themeDefinitionSchemaVersion).toBe(1);
    const updated = await themeService.updateThemeDraft(theme.id, legacy);
    expect(updated.draft?.definition.themeDefinitionSchemaVersion).toBe(2);
    expect(resolveVisualThemeSkin(updated.draft!.definition)).toEqual({ id: "neutral", version: 1 });

    const published = await themeService.publishThemeDraft(theme.id);
    expect(published.latestRevision?.definition.themeDefinitionSchemaVersion).toBe(2);
    expect(resolveVisualThemeSkin(published.latestRevision!.definition)).toEqual({
      id: "neutral",
      version: 1,
    });
  });

  it("archives theme and keeps revision resolution intact", async () => {
    const theme = await themeService.createTheme({ name: "Archivable" });
    await themeService.publishThemeDraft(theme.id);

    await themeService.archiveTheme(theme.id);

    const normalList = await themeService.listThemes(false);
    expect(normalList.some((t) => t.id === theme.id)).toBe(false);

    const archivedList = await themeService.listThemes(true);
    expect(archivedList.some((t) => t.id === theme.id)).toBe(true);

    const resolver = new ThemeResolver(prisma);
    const resolved = await resolver.resolve(theme.id, 1);
    expect(resolved).not.toBeUndefined();
    expect(resolved?.id).toBe(theme.id);
  });

  it("generates representative sample preview without persisting to DB", async () => {
    const defaultTheme = getVisualTheme(SOFT_EDITORIAL_THEME_ID, SOFT_EDITORIAL_THEME_VERSION)!;
    const preview = compileThemeRepresentativePreview(defaultTheme);

    expect(preview.compositionHtml).toContain("kakeai-root");
    expect(preview.compositionHtml).toContain("テーマプレビュー");
    expect(preview.timeline.totalDurationMs).toBeGreaterThan(0);

    const count = await prisma.theme.count();
    expect(count).toBe(0);
  });

  it("handles non-macOS font catalog adapter returning unsupported state", async () => {
    const nonMacAdapter = new FakeFontCatalogAdapter(false, [], "unsupported_platform");
    const catalog = await nonMacAdapter.getCatalog();
    expect(catalog.supported).toBe(false);
    expect(catalog.reason).toBe("unsupported_platform");
    expect(catalog.faces.length).toBe(0);
  });
});
