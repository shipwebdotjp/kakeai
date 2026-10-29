import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AppConfig } from "../../config.ts";
import { loadConfig } from "../../config.ts";
import { createPrismaClient } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { applySqlitePragmas } from "../../db/pragmas.ts";
import { ensureDataDirectories } from "../../storage/paths.ts";
import { createLanguageEditionsRouter } from "./language-editions.ts";
import { createScriptVersionsRouter } from "./script-versions.ts";
import { createYouTubeTemplatesRouter } from "./youtube-templates.ts";
import * as worksService from "../../services/works.ts";
import * as scriptVersionsService from "../../services/script-versions.ts";

let dataDir: string;
let prisma: ReturnType<typeof createPrismaClient>;
let server: Server;
let origin: string;

async function req(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  return fetch(`${origin}${path}`, {
    ...options,
    headers,
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-youtube-test-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config: AppConfig = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);

  const app = express();
  app.use(express.json());
  app.use(createLanguageEditionsRouter({ prisma, directories: config.directories }));
  app.use(createScriptVersionsRouter({ prisma, directories: config.directories, config }));
  app.use(createYouTubeTemplatesRouter(prisma));
  app.use(
    (
      err: { status?: number; code?: string; details?: unknown },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(err.status ?? 500).json({
        error: { code: err.code ?? "INTERNAL_ERROR", details: err.details },
      });
    },
  );

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${address.port}`;
}, 30000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("YouTube publication HTTP endpoints", () => {
  it("GET and PUT /language-editions/:editionId/youtube-settings round-trips settings", async () => {
    const work = await worksService.createWork(prisma, "YouTube HTTP Test Work", "ja-JP");
    const editionId = work.languageEditions[0]!.id;

    // GET default settings
    const getRes = await req(`/language-editions/${editionId}/youtube-settings`);
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as {
      data: {
        languageEditionId: string;
        document: { title: string; visibility: string; description: string };
      };
    };

    expect(getBody.data.languageEditionId).toBe(editionId);
    expect(getBody.data.document.title).toBe("YouTube HTTP Test Work");
    expect(getBody.data.document.visibility).toBe("public");

    const updatedDoc = {
      ...getBody.data.document,
      title: "更新後のタイトル",
      description: "更新後の説明文",
      tags: ["タグA", "タグB"],
      visibility: "unlisted",
      publishAt: "2026-12-31T23:59:59.000Z",
    };

    // PUT settings
    const putRes = await req(`/language-editions/${editionId}/youtube-settings`, {
      method: "PUT",
      body: JSON.stringify(updatedDoc),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as {
      data: {
        document: { title: string; description: string; visibility: string; publishAt: string };
      };
    };

    expect(putBody.data.document.title).toBe("更新後のタイトル");
    expect(putBody.data.document.description).toBe("更新後の説明文");
    expect(putBody.data.document.visibility).toBe("unlisted");
    expect(putBody.data.document.publishAt).toBe("2026-12-31T23:59:59.000Z");

    // Verify GET again
    const verifyGet = await req(`/language-editions/${editionId}/youtube-settings`);
    expect(verifyGet.status).toBe(200);
    const verifyBody = (await verifyGet.json()) as {
      data: { document: { title: string } };
    };
    expect(verifyBody.data.document.title).toBe("更新後のタイトル");

    // Saving script version does NOT overwrite youtube settings
    const currentScript = await scriptVersionsService.getCurrentScriptVersion(prisma, editionId);
    await scriptVersionsService.saveScriptVersion(prisma, editionId, {
      sourceScriptVersionId: currentScript.id,
      content: currentScript.content,
    });

    const getAfterScriptSave = await req(`/language-editions/${editionId}/youtube-settings`);
    expect(getAfterScriptSave.status).toBe(200);
    const afterScriptSaveBody = (await getAfterScriptSave.json()) as {
      data: { document: { title: string } };
    };
    expect(afterScriptSaveBody.data.document.title).toBe("更新後のタイトル");
  });

  it("GET /script-versions/:scriptVersionId/youtube-chapters returns chapter candidate and warnings", async () => {
    const work = await worksService.createWork(prisma, "Chapters HTTP Work", "ja-JP");
    const editionId = work.languageEditions[0]!.id;
    const currentScript = await scriptVersionsService.getCurrentScriptVersion(prisma, editionId);

    const res = await req(`/script-versions/${currentScript.id}/youtube-chapters`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { scriptVersionId: string; chaptersText: string; warnings: unknown[] };
    };

    expect(body.data.scriptVersionId).toBe(currentScript.id);
    expect(body.data.chaptersText).toContain("00:00 導入");
    expect(Array.isArray(body.data.warnings)).toBe(true);
  });

  it("manages YouTube settings templates (list, create, get, update overwrite, delete, duplicate name 409)", async () => {
    const work = await worksService.createWork(prisma, "Template Test Work", "ja-JP");
    const editionId = work.languageEditions[0]!.id;

    const settingsRes = await req(`/language-editions/${editionId}/youtube-settings`);
    const settings = ((await settingsRes.json()) as { data: { document: unknown } }).data.document;

    // Create template
    const createRes = await req("/youtube-settings-templates", {
      method: "POST",
      body: JSON.stringify({
        name: "デフォルト設定テンプレート",
        document: settings,
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as {
      data: { id: string; name: string; document: { title: string } };
    };
    const templateId = createBody.data.id;
    expect(createBody.data.name).toBe("デフォルト設定テンプレート");
    expect(createBody.data.document.title).toBe("Template Test Work");

    // Duplicate name create fails with 409
    const dupRes = await req("/youtube-settings-templates", {
      method: "POST",
      body: JSON.stringify({
        name: "デフォルト設定テンプレート",
        document: settings,
      }),
    });
    expect(dupRes.status).toBe(409);

    // List templates
    const listRes = await req("/youtube-settings-templates");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: { name: string }[] };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.name).toBe("デフォルト設定テンプレート");

    // Get template
    const getTemplateRes = await req(`/youtube-settings-templates/${templateId}`);
    expect(getTemplateRes.status).toBe(200);
    const getTemplateBody = (await getTemplateRes.json()) as { data: { id: string } };
    expect(getTemplateBody.data.id).toBe(templateId);

    // Update template (full overwrite)
    const updatedDoc = {
      ...(settings as Record<string, unknown>),
      title: "テンプレート上書き後のタイトル",
      visibility: "private",
    };
    const updateRes = await req(`/youtube-settings-templates/${templateId}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "更新後のテンプレート名",
        document: updatedDoc,
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as {
      data: { name: string; document: { title: string; visibility: string } };
    };
    expect(updateBody.data.name).toBe("更新後のテンプレート名");
    expect(updateBody.data.document.title).toBe("テンプレート上書き後のタイトル");
    expect(updateBody.data.document.visibility).toBe("private");

    // Delete template
    const deleteRes = await req(`/youtube-settings-templates/${templateId}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(204);

    // Verify deleted
    const verifyDelete = await req(`/youtube-settings-templates/${templateId}`);
    expect(verifyDelete.status).toBe(404);
  });
});
