import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_PROTOCOL_VERSION,
  agentResponseSchema,
  type AgentOperationName,
  type AgentResponse,
  type Work,
} from "@kakeai/contracts";
import {
  AgentClientError,
  createAgentClient,
  type AgentClient,
} from "@kakeai/agent-client";
import { connect } from "node:net";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import type { Rasterizer } from "../media/rasterize.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { assetStorageKey, commitFile } from "../storage/asset-store.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

// A 1x1 PNG. The fake rasterizers return it unchanged.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

const TEMPLATE = { id: "thumbnail.cutout-hero", version: 1 } as const;

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let agentServer: AgentSocketServer;
let client: AgentClient;
let lastRenderedHtml = "";

const fakePreviewRasterizer: PreviewRasterizer = {
  renderFrame: async () => PNG_1X1,
};

const fakeRasterizer: Rasterizer = {
  renderPng: async (html) => {
    lastRenderedHtml = html;
    return PNG_1X1;
  },
};

async function createImageAsset(): Promise<string> {
  const png = Buffer.concat([PNG_1X1, Buffer.from(randomUUID())]);
  const sha256 = createHash("sha256").update(png).digest("hex");
  const storageKey = assetStorageKey(sha256);
  const temp = join(config.directories.tmp, `thumbnail-asset-${sha256}`);
  await writeFile(temp, png);
  await commitFile(temp, storageKey, config.directories);
  const row = await prisma.asset.create({
    data: {
      kind: "image",
      origin: "uploaded",
      status: "ready",
      storageKey,
      originalFilename: "thumbnail-photo.png",
      mediaType: "image/png",
      byteSize: BigInt(png.length),
      sha256,
      widthPx: 1,
      heightPx: 1,
    },
  });
  return row.id;
}

function firstEdition(work: Work) {
  const edition = work.languageEditions[0];
  if (edition === undefined) {
    throw new Error("language edition missing");
  }
  return edition;
}

function inputFor(backgroundAssetId: string, foregroundAssetId: string) {
  return {
    headline: "**AI**で作るサムネイル",
    backgroundAssetId,
    foregroundAssetId,
  };
}

async function createWork(title: string): Promise<Work> {
  const result = await client.request("work.create", { title });
  return result.work;
}

async function expectAgentError(
  promise: Promise<unknown>,
  code: string,
): Promise<AgentClientError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AgentClientError);
    expect((error as AgentClientError).code).toBe(code);
    return error as AgentClientError;
  }
  throw new Error(`expected ${code}`);
}

/** Sends one NDJSON request directly so the resident server, not the client
 * catalog, decides whether the operation is registered. */
function rawRequest(
  socketPath: string,
  operation: string,
  input: unknown,
  requestId = "raw-thumbnail-1",
): Promise<AgentResponse> {
  return new Promise<AgentResponse>((resolve, reject) => {
    const socket = connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("timed out waiting for the raw response"));
    }, 5000);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ protocolVersion: AGENT_PROTOCOL_VERSION })}\n`);
      socket.write(`${JSON.stringify({ requestId, operation, input })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      clearTimeout(timer);
      socket.destroy();
      resolve(agentResponseSchema.parse(JSON.parse(buffer.slice(0, newline))));
    });
  });
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-thumbnail-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  agentServer = await startAgentSocketServer({
    config,
    prisma,
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
    previewRasterizer: fakePreviewRasterizer,
    rasterizer: fakeRasterizer,
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "thumbnail-e2e-agent" });
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent thumbnail operations over the socket", () => {
  it("catalogs thumbnail operations and keeps deletion and presets unregistered", async () => {
    const schema = await client.request("schema.get", {});
    for (const name of [
      "thumbnail.listTemplates",
      "thumbnail.list",
      "thumbnail.get",
      "thumbnail.appearance",
      "preview.thumbnail",
      "thumbnail.image",
    ] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
    for (const name of [
      "thumbnail.create",
      "thumbnail.update",
      "thumbnail.setPrimary",
    ] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "mutation",
        longRunning: false,
      });
    }

    for (const operation of [
      "thumbnail.delete",
      "thumbnail.setAppearance",
      "thumbnailAppearancePreset.list",
    ]) {
      const response = await rawRequest(client.socketPath, operation, {}, `raw-${operation}`);
      expect(response.ok).toBe(false);
      if (!response.ok) {
        expect(response.error.code).toBe("AGENT_OPERATION_UNKNOWN");
      }
    }

    await expectAgentError(
      client.request("thumbnail.delete" as AgentOperationName, {} as never),
      "AGENT_OPERATION_UNKNOWN",
    );
  });

  it("publishes the bundled thumbnail template with its input contract", async () => {
    const listed = await client.request("thumbnail.listTemplates", {});
    const template = listed.templates.find(
      (entry) => entry.id === TEMPLATE.id && entry.version === TEMPLATE.version,
    );
    expect(template).toBeDefined();
    expect(template?.display.label).toBeTruthy();
    expect(template?.inputSchema).toMatchObject({
      type: "object",
      required: ["headline", "backgroundAssetId", "foregroundAssetId"],
    });
    expect(template?.example).toMatchObject({
      headline: expect.any(String),
      backgroundAssetId: expect.any(String),
      foregroundAssetId: expect.any(String),
    });
  });

  it("creates, updates, previews, selects and renders a candidate", async () => {
    const work = await createWork("サムネイル統合テスト作品");
    const edition = firstEdition(work);
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    const input = inputFor(backgroundAssetId, foregroundAssetId);

    const initial = await client.request("thumbnail.list", {
      languageEditionId: edition.id,
    });
    expect(initial.thumbnails).toEqual([]);

    const first = await client.request("thumbnail.create", {
      languageEditionId: edition.id,
      label: "候補1",
      template: TEMPLATE,
      input,
    });
    expect(first.thumbnail.isPrimary).toBe(true);
    expect(first.thumbnail.schemaVersion).toBe(3);
    expect(first.thumbnail.appearanceOverride).toBeNull();

    const second = await client.request("thumbnail.create", {
      languageEditionId: edition.id,
      label: "候補2",
      template: TEMPLATE,
      input: { ...input, subline: "補足" },
      appearanceOverride: { headline: { color: "#00FFFF" } },
    });
    expect(second.thumbnail.isPrimary).toBe(false);
    expect(second.thumbnail.appearanceOverride).toEqual({
      headline: { color: "#00FFFF" },
    });

    const fetched = await client.request("thumbnail.get", {
      thumbnailId: second.thumbnail.id,
    });
    expect(fetched.thumbnail).toEqual(second.thumbnail);

    const updated = await client.request("thumbnail.update", {
      thumbnailId: second.thumbnail.id,
      label: "候補2 改",
      template: TEMPLATE,
      input: { ...input, headline: "更新した見出し" },
      appearanceOverride: { headline: { color: "#FF00FF" } },
    });
    expect(updated.thumbnail.label).toBe("候補2 改");
    expect(updated.thumbnail.appearanceOverride).toEqual({
      headline: { color: "#FF00FF" },
    });
    expect(updated.thumbnail.isPrimary).toBe(false);

    const appearance = await client.request("thumbnail.appearance", {
      languageEditionId: edition.id,
    });
    expect(appearance.appearance).toBeNull();
    expect(appearance.resolved.headline.fontSize).toBeGreaterThan(0);

    const primary = await client.request("thumbnail.setPrimary", {
      languageEditionId: edition.id,
      thumbnailId: second.thumbnail.id,
    });
    expect(primary.thumbnail?.id).toBe(second.thumbnail.id);
    expect(primary.thumbnail?.isPrimary).toBe(true);

    const listed = await client.request("thumbnail.list", {
      languageEditionId: edition.id,
    });
    expect(listed.thumbnails.filter((entry) => entry.isPrimary)).toHaveLength(1);
    expect(listed.thumbnails.find((entry) => entry.isPrimary)?.id).toBe(
      second.thumbnail.id,
    );

    lastRenderedHtml = "";
    const image = await client.request("thumbnail.image", {
      thumbnailId: second.thumbnail.id,
    });
    expect(image.thumbnailId).toBe(second.thumbnail.id);
    expect(image.width).toBe(1280);
    expect(image.height).toBe(720);
    expect(image.mimeType).toBe("image/png");
    expect(image.filename).toBe("サムネイル統合テスト作品.png");
    expect(Buffer.from(image.pngBase64, "base64")).toEqual(PNG_1X1);
    expect(lastRenderedHtml.match(/data:image\/png;base64,/g)).toHaveLength(2);
    expect(lastRenderedHtml).toContain("#FF00FF");

    const countBeforePreview = await prisma.thumbnail.count({
      where: { languageEditionId: edition.id },
    });
    lastRenderedHtml = "";
    const preview = await client.request("preview.thumbnail", {
      languageEditionId: edition.id,
      template: TEMPLATE,
      input: { ...input, headline: "未保存の見出し" },
      appearance: { headline: { color: "#123456" } },
    });
    expect(preview.languageEditionId).toBe(edition.id);
    expect(preview.width).toBe(1280);
    expect(preview.height).toBe(720);
    expect(preview.mimeType).toBe("image/png");
    expect(Buffer.from(preview.pngBase64, "base64")).toEqual(PNG_1X1);
    expect(lastRenderedHtml).toContain("未保存の見出し");
    expect(lastRenderedHtml).toContain("color:#123456");
    expect(
      await prisma.thumbnail.count({ where: { languageEditionId: edition.id } }),
    ).toBe(countBeforePreview);

    const cleared = await client.request("thumbnail.setPrimary", {
      languageEditionId: edition.id,
      thumbnailId: null,
    });
    expect(cleared.thumbnail).toBeNull();
    const afterClear = await client.request("thumbnail.list", {
      languageEditionId: edition.id,
    });
    expect(afterClear.thumbnails.every((entry) => !entry.isPrimary)).toBe(true);
  });

  it("returns stable error codes for missing resources and invalid input", async () => {
    const work = await createWork("サムネイルエラー作品");
    const edition = firstEdition(work);
    const backgroundAssetId = await createImageAsset();
    const foregroundAssetId = await createImageAsset();
    const input = inputFor(backgroundAssetId, foregroundAssetId);

    await expectAgentError(
      client.request("thumbnail.list", { languageEditionId: "led_missing" }),
      "WORK_NOT_FOUND",
    );
    await expectAgentError(
      client.request("thumbnail.get", { thumbnailId: "thm_missing" }),
      "RESOURCE_NOT_FOUND",
    );
    await expectAgentError(
      client.request("thumbnail.image", { thumbnailId: "thm_missing" }),
      "RESOURCE_NOT_FOUND",
    );
    await expectAgentError(
      client.request("thumbnail.appearance", { languageEditionId: "led_missing" }),
      "WORK_NOT_FOUND",
    );
    await expectAgentError(
      client.request("thumbnail.create", {
        languageEditionId: edition.id,
        label: "不正",
        template: { id: "thumbnail.missing", version: 1 },
        input,
      }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("thumbnail.create", {
        languageEditionId: edition.id,
        label: "不正",
        template: TEMPLATE,
        input: { ...input, foregroundAssetId: "ast_missing" },
      }),
      "ASSET_NOT_FOUND",
    );
    await expectAgentError(
      client.request("preview.thumbnail", {
        languageEditionId: edition.id,
        template: TEMPLATE,
        input: { backgroundAssetId, foregroundAssetId },
      }),
      "VALIDATION_ERROR",
    );

    const otherWork = await createWork("別のサムネイル作品");
    const otherEdition = firstEdition(otherWork);
    const created = await client.request("thumbnail.create", {
      languageEditionId: edition.id,
      label: "候補",
      template: TEMPLATE,
      input,
    });
    await expectAgentError(
      client.request("thumbnail.setPrimary", {
        languageEditionId: otherEdition.id,
        thumbnailId: created.thumbnail.id,
      }),
      "RESOURCE_NOT_FOUND",
    );
  });
});
