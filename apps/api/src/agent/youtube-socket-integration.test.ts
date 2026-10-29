import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentOperationNames } from "@kakeai/contracts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { dispatchAgentOperation, type AgentOperationContext } from "./operations.ts";
import { getSharedFontCatalogService } from "../services/font-catalog.ts";
import { getSharedPreviewRasterizer } from "../media/preview-rasterize.ts";
import { getSharedRasterizer } from "../media/rasterize.ts";
import { ThemeService } from "../services/themes.ts";
import { CompositionService } from "../services/compositions.ts";
import { CompositionAuthoringService } from "../services/authoring-context.ts";
import * as worksService from "../services/works.ts";
import * as scriptVersionsService from "../services/script-versions.ts";

let dataDir: string;
let prisma: ReturnType<typeof createPrismaClient>;
let context: AgentOperationContext;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-youtube-agent-test-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);

  const fontCatalogService = getSharedFontCatalogService();
  context = {
    prisma,
    config,
    directories: config.directories,
    fontCatalogService,
    previewRasterizer: getSharedPreviewRasterizer(),
    rasterizer: getSharedRasterizer(),
    themes: new ThemeService(prisma, fontCatalogService),
    compositions: new CompositionService({
      db: prisma,
      dataDir: config.directories.root,
    }),
    compositionAuthoring: new CompositionAuthoringService({
      db: prisma,
      fontCatalogService,
    }),
    agentId: "agent-test",
  };
}, 30000);

afterAll(async () => {
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent operations for YouTube settings and chapters", () => {
  it("does not expose YouTube templates to agents", () => {
    const templateOps = (agentOperationNames as readonly string[]).filter((name) =>
      name.toLowerCase().includes("youtubetemplate") || name.toLowerCase().includes("youtube-template") || name.toLowerCase().includes("settings-template"),
    );
    expect(templateOps).toEqual([]);
  });

  it("handles youtubeSettings.get and youtubeSettings.update", async () => {
    const work = await worksService.createWork(prisma, "Agent YouTube Work", "ja-JP");
    const editionId = work.languageEditions[0]!.id;

    // Read initial settings via agent dispatcher
    const readResult = (await dispatchAgentOperation(
      "youtubeSettings.get",
      { languageEditionId: editionId },
      context,
    )) as { languageEditionId: string; document: { title: string; visibility: string } };

    expect(readResult.languageEditionId).toBe(editionId);
    expect(readResult.document.title).toBe("Agent YouTube Work");
    expect(readResult.document.visibility).toBe("public");

    // Update settings via agent dispatcher
    const updateResult = (await dispatchAgentOperation(
      "youtubeSettings.update",
      {
        languageEditionId: editionId,
        settings: {
          ...readResult.document,
          title: "Agent更新後のタイトル",
          visibility: "unlisted",
        },
      },
      context,
    )) as { document: { title: string; visibility: string } };

    expect(updateResult.document.title).toBe("Agent更新後のタイトル");
    expect(updateResult.document.visibility).toBe("unlisted");
  });

  it("handles script.youtubeChapters", async () => {
    const work = await worksService.createWork(prisma, "Agent Chapters Work", "ja-JP");
    const editionId = work.languageEditions[0]!.id;
    const currentScript = await scriptVersionsService.getCurrentScriptVersion(prisma, editionId);

    const chaptersResult = (await dispatchAgentOperation(
      "script.youtubeChapters",
      { scriptVersionId: currentScript.id },
      context,
    )) as { scriptVersionId: string; chaptersText: string; warnings: unknown[] };

    expect(chaptersResult.scriptVersionId).toBe(currentScript.id);
    expect(chaptersResult.chaptersText).toContain("00:00 導入");
    expect(Array.isArray(chaptersResult.warnings)).toBe(true);
  });
});
