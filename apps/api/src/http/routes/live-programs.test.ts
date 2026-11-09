import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  addScriptCue,
  createLiveAsset,
  createLiveCharacter,
  createLiveTestContext,
  createLiveVoiceProfile,
  liveFormatFixture,
  type LiveTestContext,
} from "../../services/live-program-test-helpers.ts";
import { ApiError } from "../errors.ts";
import { createLiveFormatsRouter } from "./live-formats.ts";
import { createLiveProgramsRouter } from "./live-programs.ts";

let context: LiveTestContext;
let server: Server;
let origin: string;

beforeAll(async () => {
  context = await createLiveTestContext("kakeai-live-routes-");
  await createLiveAsset(context.prisma, {
    id: "asset-char",
    kind: "image",
    mediaType: "image/png",
  });
  await createLiveCharacter(context.prisma, {
    id: "char-left",
    name: "左キャラ",
    appearanceAssetId: "asset-char",
  });
  await createLiveVoiceProfile(context.prisma, { id: "voice-left" });

  const app = express();
  app.use(express.json());
  app.use(createLiveFormatsRouter(context.prisma));
  app.use(createLiveProgramsRouter(context.prisma));
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

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: any; error?: any }> {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json()) as { data?: any; error?: any };
  return {
    status: response.status,
    data: json.data,
    ...(json.error === undefined ? {} : { error: json.error }),
  };
}

describe("live program HTTP routes", () => {
  it("creates a format, a program, saves a draft and finalizes a version", async () => {
    const document = liveFormatFixture({
      characterId: "char-left",
      voiceProfileId: "voice-left",
    });

    const createdFormat = await request("POST", "/live-formats", { document });
    expect(createdFormat.status).toBe(201);
    const formatId = createdFormat.data.id as string;

    const listedFormats = await request("GET", "/live-formats");
    expect(listedFormats.status).toBe(200);
    expect(listedFormats.data.items).toHaveLength(1);

    const duplicated = await request("POST", `/live-formats/${formatId}/duplicate`, {
      name: "複製",
    });
    expect(duplicated.status).toBe(201);
    expect(duplicated.data.id).not.toBe(formatId);

    const createdProgram = await request("POST", "/live-programs", {
      formatId,
      title: "ルート経由の番組",
    });
    expect(createdProgram.status).toBe(201);
    expect(createdProgram.data.draftRevision).toBe(0);
    const programId = createdProgram.data.id as string;

    const saved = await request("PUT", `/live-programs/${programId}/draft`, {
      expectedRevision: 0,
      document: addScriptCue(createdProgram.data.draftDocument),
    });
    expect(saved.status).toBe(200);
    expect(saved.data.draftRevision).toBe(1);

    const stale = await request("PUT", `/live-programs/${programId}/draft`, {
      expectedRevision: 0,
      document: addScriptCue(createdProgram.data.draftDocument),
    });
    expect(stale.status).toBe(409);
    expect(stale.error.code).toBe("LIVE_PROGRAM_REVISION_CONFLICT");
    expect(stale.error.details.currentRevision).toBe(1);

    const finalized = await request("POST", `/live-programs/${programId}/versions`, {
      expectedRevision: 1,
      note: "route test",
    });
    expect(finalized.status).toBe(201);
    expect(finalized.data.versionNumber).toBe(1);

    const versions = await request("GET", `/live-programs/${programId}/versions`);
    expect(versions.status).toBe(200);
    expect(versions.data.map((version: { id: string }) => version.id)).toEqual([
      finalized.data.id,
    ]);

    const version = await request(
      "GET",
      `/live-programs/${programId}/versions/${finalized.data.id}`,
    );
    expect(version.status).toBe(200);
    expect(version.data.document.title).toBe("ルート経由の番組");
    expect(version.data.resolutionSnapshot.theme.id).toBe("soft-editorial");

    const materials = await request("GET", `/live-programs/${programId}/materials`);
    expect(materials.status).toBe(200);
    expect(materials.data.items).toEqual([]);
  });
});
