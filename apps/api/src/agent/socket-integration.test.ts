import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Asset, ScriptOperation, Work } from "@kakeai/contracts";
import { createAgentClient, AgentClientError, type AgentClient } from "@kakeai/agent-client";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { commitFile } from "../storage/asset-store.ts";
import { createWorker } from "../worker/index.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

// A 1x1 PNG. It is only used to exercise content detection and probing.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

let dataDir: string;
let fixtureDir: string;
let fixturePath: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let agentServer: AgentSocketServer;
let client: AgentClient;
let ffmpegReady = false;

const execFileAsync = promisify(execFile);

async function countVersions(languageEditionId: string): Promise<number> {
  return prisma.scriptVersion.count({ where: { languageEditionId } });
}

function firstEdition(work: Work) {
  const edition = work.languageEditions[0];
  if (edition === undefined) {
    throw new Error("language edition missing");
  }
  return edition;
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

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-integration-"));
  fixtureDir = await mkdtemp(join(tmpdir(), "kakeai-agent-fixture-"));
  fixturePath = join(fixtureDir, "fixture.png");
  await writeFile(fixturePath, PNG_1X1);

  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });
  const fontCatalogService = new FontCatalogService(new FakeFontCatalogAdapter());
  agentServer = await startAgentSocketServer({
    config,
    prisma,
    fontCatalogService,
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "e2e-agent" });
  try {
    await execFileAsync("ffmpeg", ["-version"]);
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("agent socket integration", () => {
  it("exposes the schema and work reads", async () => {
    const schema = await client.request("schema.get", {});
    expect(schema.protocolVersion).toBe(1);
    expect(schema.minProtocolVersion).toBe(1);
    expect(schema.operations.length).toBeGreaterThan(0);
    expect(schema.schemaDigest).toMatch(/^fnv1a64:/u);
    expect(schema.operationDigest).toMatch(/^fnv1a64:/u);

    const work = await createWork("統合テスト作品");
    expect(work.originalLocale).toBe("ja-JP");
    const edition = firstEdition(work);
    expect(edition.currentScriptVersion.versionNumber).toBe(1);

    const fetched = await client.request("work.get", { workId: work.id });
    expect(fetched.work.id).toBe(work.id);
    const listed = await client.request("work.list", {});
    expect(listed.works.some((entry) => entry.id === work.id)).toBe(true);

    const script = await client.request("script.get", {
      languageEditionId: edition.id,
    });
    expect(script.scriptVersion.author).toBe("human");
    expect(script.scriptVersion.id).toBe(edition.currentScriptVersion.id);
  });

  it("renames a work and reports unknown works", async () => {
    const work = await createWork("改名前の作品");

    const updated = await client.request("work.update", {
      workId: work.id,
      title: "改名後の作品",
    });
    expect(updated.work.id).toBe(work.id);
    expect(updated.work.title).toBe("改名後の作品");

    const fetched = await client.request("work.get", { workId: work.id });
    expect(fetched.work.title).toBe("改名後の作品");

    await expectAgentError(
      client.request("work.update", { workId: "missing-work", title: "改名" }),
      "RESOURCE_NOT_FOUND",
    );
    await expectAgentError(
      client.request("work.update", { workId: work.id, title: "   " }),
      "VALIDATION_ERROR",
    );
  });

  it("returns a still PNG of a render artifact at the requested time", async () => {
    if (!ffmpegReady) {
      return;
    }
    const work = await createWork("プレビュー確認作品");
    const sourcePath = join(fixtureDir, `preview-source-${randomUUID()}.mp4`);
    await execFileAsync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=30",
      "-frames:v",
      "60",
      "-pix_fmt",
      "yuv420p",
      sourcePath,
    ]);
    const bytes = await readFile(sourcePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `artifacts/test-preview-${randomUUID()}.mp4`;
    await commitFile(sourcePath, storageKey, config.directories);
    const job = await prisma.job.create({
      data: {
        kind: "render",
        status: "succeeded",
        snapshotSchemaVersion: 1,
        inputSnapshotJson: "{}",
        workId: work.id,
      },
    });
    const artifact = await prisma.artifact.create({
      data: {
        jobId: job.id,
        role: "render",
        format: "mp4",
        storageKey,
        sha256,
        byteSize: BigInt(bytes.length),
        durationMs: 2000,
        widthPx: 320,
        heightPx: 240,
      },
    });

    const frame = await client.request("preview.frame", {
      artifactId: artifact.id,
      timeMs: 1500,
    });
    expect(frame.artifactId).toBe(artifact.id);
    expect(frame.requestedTimeMs).toBe(1500);
    expect(frame.resolvedTimeMs).toBeLessThanOrEqual(1500);
    expect(frame.width).toBe(320);
    expect(frame.height).toBe(240);
    expect(frame.mimeType).toBe("image/png");
    const png = Buffer.from(frame.pngBase64, "base64");
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(320);
    expect(png.readUInt32BE(20)).toBe(240);

    await expectAgentError(
      client.request("preview.frame", { artifactId: artifact.id, timeMs: 5000 }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("preview.frame", { artifactId: "missing-artifact", timeMs: 0 }),
      "RESOURCE_NOT_FOUND",
    );

    const caption = await prisma.artifact.create({
      data: {
        jobId: job.id,
        role: "caption",
        format: "vtt",
        storageKey: `artifacts/test-caption-${randomUUID()}.vtt`,
        sha256: "0".repeat(64),
        byteSize: BigInt(10),
      },
    });
    await expectAgentError(
      client.request("preview.frame", { artifactId: caption.id, timeMs: 0 }),
      "VALIDATION_ERROR",
    );
  });

  it("edits through the operation core with stale, replay and conflict rules", async () => {
    const work = await createWork("編集テスト作品");
    const edition = firstEdition(work);
    const baseScriptVersionId = edition.currentScriptVersion.id;
    const operations: ScriptOperation[] = [
      { op: "scene.add", kind: "point", key: "scene-1", label: "AI追加" },
      {
        op: "line.add",
        sceneId: { key: "scene-1" },
        captionText: "最初の要点です。",
      },
    ];

    const edited = await client.request("script.edit", {
      baseScriptVersionId,
      requestId: "edit-e2e-1",
      operations,
    });
    expect(edited.replay).toBe(false);
    expect(edited.scriptVersion.author).toBe("agent");
    expect(edited.scriptVersion.authorAgentId).toBe("e2e-agent");
    expect(edited.scriptVersion.agentRequestId).toBe("edit-e2e-1");
    expect(edited.scriptVersion.agentRequestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(edited.created.sceneIds).toHaveLength(1);
    expect(edited.timeline.totalDurationMs).toBeGreaterThan(0);
    expect(await countVersions(edition.id)).toBe(2);

    const readBack = await client.request("script.get", {
      scriptVersionId: edited.scriptVersion.id,
    });
    expect(readBack.scriptVersion.id).toBe(edited.scriptVersion.id);

    const replayed = await client.request("script.edit", {
      baseScriptVersionId,
      requestId: "edit-e2e-1",
      operations,
    });
    expect(replayed.replay).toBe(true);
    expect(replayed.scriptVersion.id).toBe(edited.scriptVersion.id);
    expect(await countVersions(edition.id)).toBe(2);

    const conflict = await expectAgentError(
      client.request("script.edit", {
        baseScriptVersionId,
        requestId: "edit-e2e-1",
        operations: [{ op: "scene.add", kind: "point" }],
      }),
      "IDEMPOTENCY_CONFLICT",
    );
    expect(conflict.issues.length).toBeGreaterThan(0);

    await expectAgentError(
      client.request("script.edit", {
        baseScriptVersionId,
        requestId: "edit-e2e-stale",
        operations: [{ op: "scene.add", kind: "point" }],
      }),
      "SCRIPT_BASE_STALE",
    );
    expect(await countVersions(edition.id)).toBe(2);

    await expectAgentError(
      client.request("script.edit", {
        baseScriptVersionId: edited.scriptVersion.id,
        requestId: "edit-e2e-fail",
        operations: [
          {
            op: "line.setText",
            sceneId: "missing-scene",
            lineId: "missing-line",
            captionText: "x",
          },
        ],
      }),
      "EDIT_TARGET_NOT_FOUND",
    );
    expect(await countVersions(edition.id)).toBe(2);

    const validated = await client.request("script.validate", {
      baseScriptVersionId: edited.scriptVersion.id,
      operations: [{ op: "scene.add", kind: "point" }],
    });
    expect(validated.timeline.totalDurationMs).toBeGreaterThan(0);
    expect(await countVersions(edition.id)).toBe(2);

    const validatedContent = await client.request("script.validate", {
      content: edited.scriptVersion.content,
    });
    expect(validatedContent.timeline.totalDurationMs).toBeGreaterThan(0);
    expect(await countVersions(edition.id)).toBe(2);

    const saved = await client.request("script.save", {
      languageEditionId: edition.id,
      content: edited.scriptVersion.content,
    });
    expect(saved.scriptVersion.author).toBe("agent");
    expect(saved.scriptVersion.authorAgentId).toBe("e2e-agent");
    expect(saved.scriptVersion.agentRequestId).toBeNull();
    expect(saved.scriptVersion.agentRequestHash).toBeNull();
    expect(await countVersions(edition.id)).toBe(3);
  });

  it("imports a local asset with provenance, dedupes and tags it", async () => {
    let probeAvailable = true;
    try {
      await import("node:child_process").then(({ execFile }) =>
        new Promise<void>((resolve, reject) => {
          execFile("ffprobe", ["-version"], (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }),
      );
    } catch {
      probeAvailable = false;
    }
    if (!probeAvailable) {
      return;
    }

    const first = await client.request("asset.import", {
      path: fixturePath,
      originalFilename: "fixture.png",
      provenance: {
        model: "test-model",
        prompt: "a single pixel",
        parameters: { steps: 4 },
      },
    });
    expect(first.asset.status).toBe("processing");
    expect(first.asset.origin).toBe("generated");
    expect(first.deduplicated).toBe(false);
    expect(first.jobId).not.toBeNull();
    expect(first.asset.originalFilename).toBe("fixture.png");

    const stored = await prisma.asset.findUniqueOrThrow({
      where: { id: first.asset.id },
    });
    expect(stored.provenanceJson).toContain("test-model");
    expect(stored.provenanceJson).toContain("a single pixel");
    expect(stored.provenanceJson).not.toContain(fixtureDir);

    while (await worker.runOnce()) {
      continue;
    }
    const job = await client.request("job.get", { jobId: first.jobId! });
    expect(job.job.status).toBe("succeeded");
    const ready = await client.request("asset.get", { assetId: first.asset.id });
    expect(ready.asset.status).toBe("ready");

    const second = await client.request("asset.import", { path: fixturePath });
    expect(second.deduplicated).toBe(true);
    expect(second.asset.id).toBe(first.asset.id);
    expect(second.jobId).toBeNull();

    const tagged = await client.request("asset.tag", {
      assetId: first.asset.id,
      tags: ["ai-generated"],
    });
    expect(tagged.asset.tags).toEqual(["ai-generated"]);
    const listed = await client.request("asset.list", { kind: "image" });
    expect(listed.assets.some((asset: Asset) => asset.id === first.asset.id)).toBe(true);
  });

  it("searches and pages assets through the socket contract", async () => {
    const createdAt = new Date("2026-05-01T00:00:00.000Z");
    const rows = [
      {
        id: "socket-search-a",
        filename: "Socket-Search-Alpha.png",
        tags: ["socket-x", "socket-y"],
        favorite: true,
        archived: false,
      },
      {
        id: "socket-search-b",
        filename: "socket-search-beta.png",
        tags: ["socket-x"],
        favorite: true,
        archived: false,
      },
      {
        id: "socket-search-c",
        filename: "socket-search-gamma.png",
        tags: ["socket-y"],
        favorite: false,
        archived: true,
      },
    ];
    for (const row of rows) {
      await prisma.asset.create({
        data: {
          id: row.id,
          kind: "image",
          origin: "uploaded",
          status: "ready",
          storageKey: `assets/${row.id}`,
          originalFilename: row.filename,
          mediaType: "image/png",
          byteSize: BigInt(10),
          sha256: `sha-${row.id}`,
          tagsJson: JSON.stringify(row.tags),
          favoritedAt: row.favorite ? new Date("2026-05-02T00:00:00.000Z") : null,
          archivedAt: row.archived ? new Date("2026-05-03T00:00:00.000Z") : null,
          createdAt,
        },
      });
    }

    const compound = await client.request("asset.list", {
      kind: "image",
      status: "ready",
      filename: "socket-search",
      tags: ["socket-x"],
      tagMode: "and",
      favorite: true,
      archived: "exclude",
      limit: 10,
    });
    expect(compound.assets.map((asset) => asset.id)).toEqual([
      "socket-search-b",
      "socket-search-a",
    ]);
    expect(compound.nextCursor).toBeNull();
    expect(compound.total).toBe(2);

    const firstPage = await client.request("asset.list", {
      filename: "socket-search",
      archived: "include",
      limit: 2,
    });
    expect(firstPage.assets.map((asset) => asset.id)).toEqual([
      "socket-search-c",
      "socket-search-b",
    ]);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.total).toBe(3);

    const secondPage = await client.request("asset.list", {
      filename: "socket-search",
      archived: "include",
      limit: 2,
      cursor: firstPage.nextCursor ?? "",
    });
    expect(secondPage.assets.map((asset) => asset.id)).toEqual(["socket-search-a"]);
    expect(secondPage.nextCursor).toBeNull();
    expect(secondPage.total).toBe(3);

    const invalid = await expectAgentError(
      client.request("asset.list", { cursor: "not-a-cursor" }),
      "VALIDATION_ERROR",
    );
    expect(invalid.issues?.[0]?.path).toEqual(["cursor"]);
  });

  it("applies the sort, metadata filters and total count over the socket", async () => {
    const createdAt = new Date("2026-05-10T00:00:00.000Z");
    const rows = [
      {
        id: "socket-sort-a",
        filename: "socket-sort-bravo.mp4",
        hasAudio: true,
        durationMs: 4_000,
      },
      {
        id: "socket-sort-b",
        filename: "socket-sort-alpha.mp4",
        hasAudio: false,
        durationMs: 2_000,
      },
      {
        id: "socket-sort-c",
        filename: "socket-sort-charlie.mp4",
        hasAudio: true,
        durationMs: null,
      },
    ];
    for (const row of rows) {
      await prisma.asset.create({
        data: {
          id: row.id,
          kind: "video",
          origin: "uploaded",
          status: "ready",
          storageKey: `assets/${row.id}`,
          originalFilename: row.filename,
          mediaType: "video/mp4",
          byteSize: BigInt(10),
          sha256: `sha-${row.id}`,
          hasAudio: row.hasAudio,
          durationMs: row.durationMs,
          createdAt,
        },
      });
    }

    const byName = await client.request("asset.list", {
      filename: "socket-sort-",
      sort: "filename_asc",
    });
    expect(byName.assets.map((asset) => asset.id)).toEqual([
      "socket-sort-b",
      "socket-sort-a",
      "socket-sort-c",
    ]);
    expect(byName.total).toBe(3);

    const byDuration = await client.request("asset.list", {
      filename: "socket-sort-",
      sort: "duration_asc",
    });
    expect(byDuration.assets.map((asset) => asset.id)).toEqual([
      "socket-sort-b",
      "socket-sort-a",
      "socket-sort-c",
    ]);
    expect(byDuration.total).toBe(3);

    const withAudio = await client.request("asset.list", {
      filename: "socket-sort-",
      hasAudio: true,
    });
    expect(withAudio.assets.map((asset) => asset.id)).toEqual([
      "socket-sort-c",
      "socket-sort-a",
    ]);
    expect(withAudio.total).toBe(2);

    const ranged = await client.request("asset.list", {
      filename: "socket-sort-",
      durationMinMs: 1_000,
      durationMaxMs: 5_000,
    });
    expect(ranged.assets.map((asset) => asset.id)).toEqual([
      "socket-sort-b",
      "socket-sort-a",
    ]);
    expect(ranged.total).toBe(2);

    const firstPage = await client.request("asset.list", {
      filename: "socket-sort-",
      sort: "filename_asc",
      limit: 2,
    });
    expect(firstPage.assets.map((asset) => asset.id)).toEqual([
      "socket-sort-b",
      "socket-sort-a",
    ]);
    expect(firstPage.nextCursor).not.toBeNull();
    expect(firstPage.total).toBe(3);

    const mismatched = await expectAgentError(
      client.request("asset.list", {
        filename: "socket-sort-",
        sort: "createdAt_desc",
        limit: 2,
        cursor: firstPage.nextCursor ?? "",
      }),
      "VALIDATION_ERROR",
    );
    expect(mismatched.issues?.[0]?.path).toEqual(["cursor"]);
  });

  it("starts and cancels a render job without starting another worker", async () => {
    const work = await createWork("レンダーテスト作品");
    const edition = firstEdition(work);
    const started = await client.request("render.start", {
      scriptVersionId: edition.currentScriptVersion.id,
    });
    expect(started.job.status).toBe("queued");
    expect(started.job.workId).toBe(work.id);
    expect(started.job.scriptVersionId).toBe(edition.currentScriptVersion.id);

    await new Promise((resolve) => setTimeout(resolve, 150));
    const stillQueued = await client.request("job.get", { jobId: started.job.id });
    expect(stillQueued.job.status).toBe("queued");
    // The socket must enqueue only; the test worker has never been started, so
    // a second worker would be the only thing able to claim this job.
    expect(worker.status()).toBe("notReady");
    expect(await prisma.job.count({ where: { status: "running" } })).toBe(0);

    const listed = await client.request("job.list", { workId: work.id });
    expect(listed.jobs.some((job) => job.id === started.job.id)).toBe(true);

    const cancelled = await client.request("job.cancel", { jobId: started.job.id });
    expect(cancelled.job.status).toBe("cancelled");
    expect(await countVersions(edition.id)).toBe(1);
  });
});
