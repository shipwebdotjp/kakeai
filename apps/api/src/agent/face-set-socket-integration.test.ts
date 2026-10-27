import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AGENT_PROTOCOL_VERSION,
  agentResponseSchema,
  type AgentResponse,
} from "@kakeai/contracts";
import {
  AgentClientError,
  createAgentClient,
  type AgentClient,
} from "@kakeai/agent-client";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { createCharacter } from "../services/character-library.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import type { Rasterizer } from "../media/rasterize.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

const fakeRasterizer: Rasterizer = {
  async renderPng(_html: string, _width: number, _height: number): Promise<Buffer> {
    return PNG_1X1;
  },
};

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let agentServer: AgentSocketServer;
let client: AgentClient;
let counter = 0;

async function seedImage(widthPx = 1, heightPx = 1) {
  counter += 1;
  const filename = `face-${counter}.png`;
  await writeFile(join(config.directories.assets, filename), PNG_1X1);
  return prisma.asset.create({
    data: {
      kind: "image",
      origin: "uploaded",
      status: "ready",
      storageKey: `assets/${filename}`,
      originalFilename: filename,
      mediaType: "image/png",
      byteSize: BigInt(PNG_1X1.length),
      sha256: `face-sha-${counter}`,
      widthPx,
      heightPx,
    },
  });
}

function layer(id: string, part: "brow" | "eye" | "mouth" | "foreground", assetId: string) {
  return { id, part, assetId, blinkLayerId: null, speakingLayerId: null };
}

async function faceSetInput() {
  const brow = await seedImage();
  const eye = await seedImage();
  const mouth = await seedImage();
  return {
    name: "エージェント表情",
    layers: [
      layer("brow-normal", "brow", brow.id),
      layer("eye-normal", "eye", eye.id),
      layer("mouth-normal", "mouth", mouth.id),
    ],
    expressions: [
      {
        id: "normal",
        name: "通常",
        browLayerId: "brow-normal",
        eyeLayerId: "eye-normal",
        mouthLayerId: "mouth-normal",
      },
    ],
  };
}

async function expectAgentError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AgentClientError);
    expect((error as AgentClientError).code).toBe(code);
    return error as AgentClientError;
  }
  throw new Error(`expected ${code}`);
}

/** Sends one NDJSON request directly so the server, not the client catalog,
 * decides whether the operation is registered. */
function rawRequest(
  socketPath: string,
  operation: string,
  input: unknown,
  requestId = "raw-face-set-1",
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
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-face-set-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  agentServer = await startAgentSocketServer({
    config,
    prisma,
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter(true, [])),
    rasterizer: fakeRasterizer,
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "face-set-e2e-agent" });
}, 60000);

afterAll(async () => {
  await agentServer?.close();
  await prisma?.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("face set socket operations", () => {
  it("catalogs create/update/usages and preview as agent operations", async () => {
    const schema = await client.request("schema.get", {});
    for (const name of ["faceSet.create", "faceSet.update"] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "mutation",
        longRunning: false,
      });
    }
    for (const name of ["faceSet.usages", "preview.faceSet"] as const) {
      expect(schema.agentOperations).toContainEqual({
        name,
        kind: "read",
        longRunning: false,
      });
    }
    const response = await rawRequest(client.socketPath, "faceSet.delete", {});
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe("AGENT_OPERATION_UNKNOWN");
    }
  });

  it("creates, partially updates and lists the usages of a face set", async () => {
    const input = await faceSetInput();
    const created = await client.request("faceSet.create", input);
    expect(created.faceSet.version).toBe(1);
    expect(created.faceSet.name).toBe("エージェント表情");
    expect(created.faceSet.layers.map((entry) => entry.id)).toEqual([
      "brow-normal",
      "eye-normal",
      "mouth-normal",
    ]);

    const renamed = await client.request("faceSet.update", {
      faceSetId: created.faceSet.id,
      name: "名前だけ",
    });
    expect(renamed.faceSet.version).toBe(1);
    expect(renamed.faceSet.layers).toEqual(created.faceSet.layers);

    const revised = await client.request("faceSet.update", {
      faceSetId: created.faceSet.id,
      expressions: [
        ...input.expressions,
        {
          id: "happy",
          name: "笑い",
          browLayerId: "brow-normal",
          eyeLayerId: "eye-normal",
          mouthLayerId: "mouth-normal",
        },
      ],
    });
    expect(revised.faceSet.version).toBe(2);
    expect(revised.faceSet.name).toBe("名前だけ");
    expect(revised.faceSet.layers).toEqual(created.faceSet.layers);
    expect(revised.faceSet.expressions.map((entry) => entry.id)).toEqual([
      "normal",
      "happy",
    ]);

    const base = await seedImage();
    await createCharacter(prisma, {
      name: "リン",
      names: [],
      voices: [],
      appearances: [
        {
          id: "appearance-agent-usage",
          assetId: base.id,
          expression: "smile",
          pose: "front",
          label: "夏服",
          faceSetId: created.faceSet.id,
        },
      ],
    });
    const usages = await client.request("faceSet.usages", {
      faceSetId: created.faceSet.id,
    });
    expect(usages.usages.libraryAppearances).toMatchObject([
      {
        characterName: "リン",
        appearanceId: "appearance-agent-usage",
        label: "夏服",
      },
    ]);
  });

  it("rejects an empty update, an unknown id and mismatched dimensions", async () => {
    const input = await faceSetInput();
    const created = await client.request("faceSet.create", input);

    await expectAgentError(
      client.request("faceSet.update", { faceSetId: created.faceSet.id }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("faceSet.update", {
        faceSetId: "face-set-missing",
        name: "x",
      }),
      "RESOURCE_NOT_FOUND",
    );

    const wide = await seedImage(2, 2);
    await expectAgentError(
      client.request("faceSet.create", {
        ...input,
        layers: input.layers.map((entry, index) => ({
          ...entry,
          assetId: index === 0 ? wide.id : entry.assetId,
        })),
      }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("faceSet.usages", { faceSetId: "face-set-missing" }),
      "RESOURCE_NOT_FOUND",
    );
  });

  it("renders an unsaved face set draft without writing", async () => {
    const input = await faceSetInput();
    const base = await seedImage();
    const preview = await client.request("preview.faceSet", {
      layers: input.layers,
      expressions: input.expressions,
      baseAssetId: base.id,
    });
    expect(preview).toMatchObject({
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    expect(Buffer.from(preview.pngBase64, "base64")).toEqual(PNG_1X1);

    // The default expression is `normal`; an unknown expression is rejected.
    await expectAgentError(
      client.request("preview.faceSet", {
        layers: input.layers,
        expressions: input.expressions,
        expressionId: "missing",
        baseAssetId: base.id,
      }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      client.request("preview.faceSet", {
        layers: input.layers,
        expressions: input.expressions,
        baseAssetId: "asset-missing",
      }),
      "RESOURCE_NOT_FOUND",
    );

    // A non-image layer is rejected with the same reason the write path uses,
    // instead of silently omitting it from the composite.
    const audio = await prisma.asset.create({
      data: {
        kind: "audio",
        origin: "uploaded",
        status: "ready",
        storageKey: "assets/not-an-image",
        originalFilename: "not-an-image.mp3",
        mediaType: "audio/mpeg",
        byteSize: BigInt(10),
        sha256: "face-audio-sha",
      },
    });
    await expectAgentError(
      client.request("preview.faceSet", {
        layers: input.layers.map((entry, index) =>
          index === 0 ? { ...entry, assetId: audio.id } : entry,
        ),
        expressions: input.expressions,
        baseAssetId: base.id,
      }),
      "VALIDATION_ERROR",
    );
  });
});
