import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createCompositionsRouter, isPathInside } from "./compositions.ts";

describe("isPathInside", () => {
  const bundleDir = "/data/compositions/bundles/hash";

  it("accepts the directory itself and files below it", () => {
    expect(isPathInside(bundleDir, bundleDir)).toBe(true);
    expect(isPathInside(bundleDir, `${bundleDir}/index.html`)).toBe(true);
    expect(isPathInside(bundleDir, `${bundleDir}/assets/logo.png`)).toBe(true);
  });

  it("rejects siblings that only share a name prefix", () => {
    expect(isPathInside(bundleDir, `${bundleDir}2/index.html`)).toBe(false);
    expect(isPathInside(bundleDir, "/data/compositions/bundles/hash-extra/x")).toBe(false);
  });

  it("rejects escapes above the directory", () => {
    expect(isPathInside(bundleDir, "/data/compositions/bundles/other/x")).toBe(false);
    expect(isPathInside(bundleDir, "/data/compositions")).toBe(false);
  });
});

describe("compositions content route", () => {
  let dataDir: string;
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "kakeai-composition-route-"));
    const bundleDir = join(dataDir, "compositions/bundles/hash/ver-1");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "index.html"), "<!doctype html><html>ok</html>", "utf-8");

    const service = {
      dataDir,
      getVersionById: async (id: string) => ({
        id,
        compositionId: "cmp_1",
        versionNumber: 1,
        bundleHash: "hash",
        storageKey: "compositions/bundles/hash/ver-1",
        manifest: {
          entrypoint: "index.html",
          contentHash: "hash",
          runtimeCompositionId: "cmp.test",
          width: 1920,
          height: 1080,
          durationMs: 5000,
          dependencies: [],
        },
        createdAt: new Date(0).toISOString(),
      }),
      getDraftFiles: async () => ({
        entrypoint: "index.html",
        files: { "index.html": "<!doctype html>draft" },
      }),
      validateDraft: async () => ({
        entrypoint: "index.html",
        runtimeCompositionId: "cmp.test",
        width: 1920,
        height: 1080,
        durationMs: 5000,
        dependencies: [],
      }),
    };

    const app = express();
    app.use(express.json());
    app.use("/compositions", createCompositionsRouter(service as never));
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
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await rm(dataDir, { recursive: true, force: true });
  });

  it("serves a bundle file through the named wildcard route", async () => {
    const res = await fetch(`${origin}/compositions/versions/ver-1/content/index.html`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ok");
  });

  it("returns 404 for a missing file", async () => {
    const res = await fetch(`${origin}/compositions/versions/ver-1/content/missing.html`);
    expect(res.status).toBe(404);
  });

  it("rejects path traversal outside the bundle", async () => {
    const res = await fetch(
      `${origin}/compositions/versions/ver-1/content/..%2f..%2f..%2fmanifest.json`,
    );
    expect(res.status).toBe(403);
  });

  it("reads draft files back", async () => {
    const res = await fetch(`${origin}/compositions/cmp_1/draft/files`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entrypoint: string; files: Record<string, string> } };
    expect(body.data.entrypoint).toBe("index.html");
    expect(body.data.files["index.html"]).toContain("draft");
  });

  it("validates a draft with publish?dryRun=true", async () => {
    const res = await fetch(`${origin}/compositions/cmp_1/publish?dryRun=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { manifest: { runtimeCompositionId: string } } };
    expect(body.data.manifest.runtimeCompositionId).toBe("cmp.test");
  });

  it("rejects an invalid dryRun value", async () => {
    const res = await fetch(`${origin}/compositions/cmp_1/publish?dryRun=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});
