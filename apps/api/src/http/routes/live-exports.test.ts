import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createLiveTestContext,
  type LiveTestContext,
} from "../../services/live-program-test-helpers.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../../services/font-catalog.ts";
import { ApiError } from "../errors.ts";
import { createLiveExportsRouter } from "./live-exports.ts";

let context: LiveTestContext;
let server: Server;
let origin: string;

beforeAll(async () => {
  context = await createLiveTestContext("kakeai-live-export-routes-");
  const app = express();
  app.use(express.json());
  app.use(
    createLiveExportsRouter(
      context.prisma,
      new FontCatalogService(new FakeFontCatalogAdapter()),
    ),
  );
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof ApiError) {
        res.status(error.status).json({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
        return;
      }
      res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
    },
  );
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await context.close();
});

async function post(path: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsedBody: unknown = null;
  try {
    parsedBody = JSON.parse(text) as unknown;
  } catch {
    // A 404 from Express is HTML; the status is the assertion.
  }
  return { status: response.status, body: parsedBody };
}

describe("live export routes", () => {
  it("no longer exposes live-profiles/auto", async () => {
    const response = await post("/live-profiles/auto", {
      workId: "work-1",
      scriptVersionId: "script-1",
    });
    expect(response.status).toBe(404);
  });

  it("rejects the removed Work/Show Profile export input", async () => {
    const response = await post("/live-exports", {
      workId: "work-1",
      scriptVersionId: "script-1",
      profile: { schemaVersion: 1 },
      outDir: "/tmp/kakeai/legacy-package",
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(await context.prisma.job.count({ where: { kind: "live_export" } })).toBe(0);
  });

  it("rejects mixing programVersionId with Work fields", async () => {
    const response = await post("/live-exports", {
      programVersionId: "program-version-1",
      workId: "work-1",
      outDir: "/tmp/kakeai/package",
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
