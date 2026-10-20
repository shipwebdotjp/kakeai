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
import { createFaceSetsRouter } from "./face-sets.ts";

describe("face-sets route", () => {
  let dataDir: string;
  let server: Server;
  let origin: string;
  let disconnect: () => Promise<void>;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kakeai-faceset-route-"));
    process.env.KAKEAI_DATA_DIR = dataDir;
    const config: AppConfig = loadConfig();
    await ensureDataDirectories(config.directories);
    await runMigrations();
    const prisma = createPrismaClient(config.databaseUrl);
    await applySqlitePragmas(prisma);
    disconnect = () => prisma.$disconnect();

    const app = express();
    app.use(express.json());
    app.use(createFaceSetsRouter({ prisma }));
    app.use(
      (
        err: { status?: number; code?: string },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(err.status ?? 500).json({ error: { code: err.code ?? "INTERNAL_ERROR" } });
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

  it("lists an empty library", async () => {
    const res = await fetch(`${origin}/face-sets`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("rejects a missing face set", async () => {
    const res = await fetch(`${origin}/face-sets/fs-missing`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("rejects an invalid request body", async () => {
    const res = await fetch(`${origin}/face-sets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", layers: [], expressions: [] }),
    });
    expect(res.status).toBe(422);
  });
});
