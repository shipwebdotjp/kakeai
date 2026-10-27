import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { AssetListPage } from "@kakeai/contracts";
import type { AppConfig } from "../../config.ts";
import { loadConfig } from "../../config.ts";
import { createPrismaClient } from "../../db/client.ts";
import { runMigrations } from "../../db/migrate.ts";
import { applySqlitePragmas } from "../../db/pragmas.ts";
import { ensureDataDirectories } from "../../storage/paths.ts";
import { createAssetsRouter } from "./assets.ts";

let dataDir: string;
let server: Server;
let origin: string;
let disconnect: () => Promise<void>;
let prisma: ReturnType<typeof createPrismaClient>;

const mediaGuard: RequestHandler = (_req, _res, next) => next();

async function seed(input: {
  id: string;
  filename: string;
  kind?: "image" | "video" | "audio";
  status?: "processing" | "ready" | "failed";
  tags?: string[];
  favorite?: boolean;
  archived?: boolean;
  hasAudio?: boolean;
  durationMs?: number | null;
  widthPx?: number | null;
  heightPx?: number | null;
  createdAt?: Date;
}): Promise<void> {
  await prisma.asset.create({
    data: {
      id: input.id,
      kind: input.kind ?? "image",
      origin: "uploaded",
      status: input.status ?? "ready",
      storageKey: `assets/route-${randomUUID()}`,
      originalFilename: input.filename,
      mediaType: "image/png",
      byteSize: BigInt(10),
      sha256: `sha-route-${randomUUID()}`,
      durationMs: input.durationMs ?? null,
      widthPx: input.widthPx ?? null,
      heightPx: input.heightPx ?? null,
      hasAudio: input.hasAudio ?? false,
      tagsJson:
        input.tags === undefined || input.tags.length === 0
          ? null
          : JSON.stringify(input.tags),
      favoritedAt: input.favorite === true ? new Date("2026-01-02T00:00:00.000Z") : null,
      archivedAt: input.archived === true ? new Date("2026-01-03T00:00:00.000Z") : null,
      createdAt: input.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    },
  });
}

async function get(path: string): Promise<Response> {
  return fetch(`${origin}${path}`);
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-assets-route-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  const config: AppConfig = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  disconnect = () => prisma.$disconnect();

  await seed({
    id: "route-a",
    filename: "Route-Summer.PNG",
    tags: ["背景", "夏"],
    favorite: true,
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
  });
  await seed({
    id: "route-b",
    filename: "route-summer-two.png",
    tags: ["背景", "夏"],
    favorite: true,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  });
  await seed({
    id: "route-c",
    filename: "route-archived.png",
    tags: ["背景", "夏"],
    favorite: true,
    archived: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  await seed({
    id: "route-d",
    filename: "route-summer-audio.wav",
    kind: "audio",
    tags: ["背景"],
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
  });
  await seed({
    id: "route-e",
    filename: "media-short.mp4",
    kind: "video",
    hasAudio: true,
    durationMs: 1_000,
    widthPx: 640,
    heightPx: 360,
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
  });
  await seed({
    id: "route-f",
    filename: "media-long.mp4",
    kind: "video",
    hasAudio: true,
    durationMs: 9_000,
    widthPx: 1920,
    heightPx: 1080,
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
  });

  const app = express();
  app.use(express.json());
  app.use(createAssetsRouter({ prisma, directories: config.directories, limits: config.limits, mediaGuard }));
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
}, 60000);

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("assets route search", () => {
  it("parses combined filters and returns the page contract", async () => {
    const res = await get(
      "/assets?kind=image&status=ready&filename=SUMMER&tags=%E8%83%8C%E6%99%AF,%E5%A4%8F&tagMode=and&favorite=true",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: AssetListPage };
    expect(body.data.assets.map((asset) => asset.id)).toEqual(["route-a", "route-b"]);
    expect(body.data.nextCursor).toBeNull();

    // `tag` remains an alias of `tags` for HTTP callers.
    const alias = (await (
      await get("/assets?tag=%E8%83%8C%E6%99%AF&tag=%E5%A4%8F&tagMode=and")
    ).json()) as { data: AssetListPage };
    expect(alias.data.assets.map((asset) => asset.id)).toEqual(["route-a", "route-b"]);
  });

  it("excludes archived assets unless requested", async () => {
    const excluded = (await (await get("/assets?filename=route-")).json()) as {
      data: AssetListPage;
    };
    expect(excluded.data.assets.map((asset) => asset.id)).toEqual([
      "route-d",
      "route-a",
      "route-b",
    ]);

    const included = (await (
      await get("/assets?filename=route-&archived=include")
    ).json()) as { data: AssetListPage };
    expect(included.data.assets.map((asset) => asset.id)).toEqual([
      "route-d",
      "route-a",
      "route-b",
      "route-c",
    ]);

    const only = (await (await get("/assets?filename=route-&archived=only")).json()) as {
      data: AssetListPage;
    };
    expect(only.data.assets.map((asset) => asset.id)).toEqual(["route-c"]);
  });

  it("pages with the opaque cursor", async () => {
    const first = (await (await get("/assets?filename=route-&limit=2")).json()) as {
      data: AssetListPage;
    };
    expect(first.data.assets.map((asset) => asset.id)).toEqual(["route-d", "route-a"]);
    expect(first.data.nextCursor).not.toBeNull();

    const second = (await (
      await get(
        `/assets?filename=route-&limit=2&cursor=${encodeURIComponent(first.data.nextCursor ?? "")}`,
      )
    ).json()) as { data: AssetListPage };
    expect(second.data.assets.map((asset) => asset.id)).toEqual(["route-b"]);
    expect(second.data.nextCursor).toBeNull();
  });

  it("rejects invalid query values with 422", async () => {
    for (const path of [
      "/assets?kind=document",
      "/assets?status=unknown",
      "/assets?limit=0",
      "/assets?limit=abc",
      "/assets?favorite=maybe",
      "/assets?hasAudio=maybe",
      "/assets?durationMinMs=-1",
      "/assets?durationMaxMs=abc",
      "/assets?durationMinMs=1.5",
      "/assets?durationMinMs=9000&durationMaxMs=1000",
      "/assets?durationMaxMs=9223372036854775807",
      "/assets?widthPx=0",
      "/assets?widthPx=abc",
      "/assets?heightMaxPx=1.5",
      "/assets?widthMinPx=2000&widthMaxPx=1000",
      "/assets?widthPx=100&widthMinPx=200",
      "/assets?sort=createdAt",
      "/assets?tag=",
      "/assets?cursor=not-a-cursor",
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(422);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("accepts the sort and metadata filters and returns the total count", async () => {
    const sorted = (await (await get("/assets?filename=media-&sort=filename_asc")).json()) as {
      data: AssetListPage;
    };
    expect(sorted.data.assets.map((asset) => asset.id)).toEqual(["route-f", "route-e"]);
    expect(sorted.data.total).toBe(2);

    const byDuration = (await (
      await get("/assets?filename=media-&sort=duration_asc")
    ).json()) as { data: AssetListPage };
    expect(byDuration.data.assets.map((asset) => asset.id)).toEqual(["route-e", "route-f"]);

    const withAudio = (await (
      await get("/assets?filename=media-&hasAudio=true")
    ).json()) as { data: AssetListPage };
    expect(withAudio.data.assets.map((asset) => asset.id)).toEqual(["route-f", "route-e"]);
    expect(withAudio.data.total).toBe(2);

    const ranged = (await (
      await get("/assets?filename=media-&durationMinMs=2000&durationMaxMs=10000")
    ).json()) as { data: AssetListPage };
    expect(ranged.data.assets.map((asset) => asset.id)).toEqual(["route-f"]);
    expect(ranged.data.total).toBe(1);

    const exactSize = (await (
      await get("/assets?filename=media-&widthPx=1920&heightPx=1080")
    ).json()) as { data: AssetListPage };
    expect(exactSize.data.assets.map((asset) => asset.id)).toEqual(["route-f"]);
    expect(exactSize.data.total).toBe(1);

    const sizeRange = (await (
      await get("/assets?filename=media-&widthMinPx=640&widthMaxPx=1000")
    ).json()) as { data: AssetListPage };
    expect(sizeRange.data.assets.map((asset) => asset.id)).toEqual(["route-e"]);
    expect(sizeRange.data.total).toBe(1);
  });

  it("keeps the total count stable across pages of one filter set", async () => {
    const first = (await (await get("/assets?filename=route-&limit=2")).json()) as {
      data: AssetListPage;
    };
    expect(first.data.total).toBe(3);

    const second = (await (
      await get(
        `/assets?filename=route-&limit=2&cursor=${encodeURIComponent(first.data.nextCursor ?? "")}`,
      )
    ).json()) as { data: AssetListPage };
    expect(second.data.total).toBe(3);
  });

  it("rejects a cursor that was produced for another sort", async () => {
    const first = (await (
      await get("/assets?filename=route-&sort=createdAt_desc&limit=1")
    ).json()) as { data: AssetListPage };
    expect(first.data.nextCursor).not.toBeNull();

    const res = await get(
      `/assets?filename=route-&sort=filename_asc&limit=1&cursor=${encodeURIComponent(first.data.nextCursor ?? "")}`,
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: { issues: unknown[] } } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.issues[0]).toMatchObject({ path: ["cursor"] });
  });
});
