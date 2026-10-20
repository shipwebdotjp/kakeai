import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  agentOperationNames,
  type Composition,
  type Work,
} from "@kakeai/contracts";
import { createAgentClient, AgentClientError, type AgentClient } from "@kakeai/agent-client";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

const RUNTIME_COMPOSITION_ID = "cmp.agent.roundtrip";

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let agentServer: AgentSocketServer;
let client: AgentClient;

/** Unchecked request so unknown operations can be probed through the socket. */
const rawRequest = (
  operation: string,
  input: unknown,
): Promise<unknown> =>
  (client.request as unknown as (op: string, data: unknown) => Promise<unknown>)(
    operation,
    input,
  );

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

async function createWork(title: string): Promise<Work> {
  const result = await client.request("work.create", { title });
  return result.work;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-composition-"));
  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  agentServer = await startAgentSocketServer({
    config,
    prisma,
    // Publish font diagnostics must never reach the real system profiler.
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "composition-agent" });
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("agent composition authoring over the local socket", () => {
  it("creates, publishes and references a composition from script.edit", async () => {
    const empty = await client.request("composition.list", {});
    expect(empty.compositions).toEqual([]);

    const authoringContext = await client.request("composition.authoringContext", {
      visualTheme: { id: SOFT_EDITORIAL_THEME_ID, version: SOFT_EDITORIAL_THEME_VERSION },
      canvasProfile: "landscape",
    });
    expect(authoringContext.context.canvasProfile).toBe("landscape");
    expect(authoringContext.context.seed.styleDirectory).toBe("kakeai-style/");

    const created = await client.request("composition.create", {
      name: "Agent Round Trip",
      runtimeCompositionId: RUNTIME_COMPOSITION_ID,
      canvasProfile: "landscape",
      authoringStyle: {
        visualTheme: { id: SOFT_EDITORIAL_THEME_ID, version: SOFT_EDITORIAL_THEME_VERSION },
      },
    });
    const compositionId = created.composition.id;
    expect(created.composition.name).toBe("Agent Round Trip");
    expect(created.composition.draft?.styleProvenance?.kind).toBe("authored");
    expect(created.composition.versions).toEqual([]);

    const fetched = await client.request("composition.get", { compositionId });
    expect(fetched.composition.runtimeCompositionId).toBe(RUNTIME_COMPOSITION_ID);

    const listed = await client.request("composition.list", {});
    expect(listed.compositions.map((entry: Composition) => entry.id)).toContain(compositionId);

    const seeded = await client.request("composition.draft.get", { compositionId });
    expect(seeded.draft.entrypoint).toBe("index.html");
    expect(seeded.draft.files["index.html"]).toContain(RUNTIME_COMPOSITION_ID);
    expect(seeded.draft.files["kakeai-style/tokens.css"]).toBeDefined();

    const saved = await client.request("composition.draft.save", {
      compositionId,
      files: {
        "index.html": [
          "<!doctype html><html><head><meta charset=\"utf-8\"></head><body>",
          `<div id="app" data-composition-id="${RUNTIME_COMPOSITION_ID}" data-width="1920" data-height="1080" data-duration="4" data-fps="30"></div>`,
          `<script>window.__timelines = window.__timelines || {};window.__timelines["${RUNTIME_COMPOSITION_ID}"] = { duration: 4 };</script>`,
          "</body></html>",
        ].join(""),
        "extra.css": ".kakeai { color: #ffffff; }",
      },
      manifest: { durationMs: 4000, dependencies: ["extra.css"] },
    });
    expect(saved.draft.compositionId).toBe(compositionId);

    const dryRun = await client.request("composition.publish", { compositionId, dryRun: true });
    expect(dryRun.dryRun).toBe(true);
    if (!dryRun.dryRun) {
      throw new Error("expected a dry run outcome");
    }
    expect(dryRun.manifest.runtimeCompositionId).toBe(RUNTIME_COMPOSITION_ID);
    expect(dryRun.manifest.durationMs).toBe(4000);
    expect(Array.isArray(dryRun.fontDiagnostics)).toBe(true);

    const beforePublish = await client.request("composition.get", { compositionId });
    expect(beforePublish.composition.versions ?? []).toHaveLength(0);

    const published = await client.request("composition.publish", { compositionId });
    expect(published.dryRun).toBe(false);
    if (published.dryRun) {
      throw new Error("expected a publish outcome");
    }
    const version = published.version;
    expect(version.versionNumber).toBe(1);
    expect(version.compositionId).toBe(compositionId);
    expect(version.manifest.canvasProfile).toBe("landscape");
    expect(version.manifest.durationMs).toBe(4000);
    expect(version.manifest.contentHash).toBe(version.bundleHash);

    const afterPublish = await client.request("composition.get", { compositionId });
    expect(afterPublish.composition.versions?.map((entry) => entry.id)).toEqual([version.id]);

    const work = await createWork("Composition 参照作品");
    const edition = work.languageEditions[0]!;
    const script = await client.request("script.get", { languageEditionId: edition.id });
    const sceneId = script.scriptVersion.content.scenes[0]!.id;

    const edited = await client.request("script.edit", {
      baseScriptVersionId: script.scriptVersion.id,
      requestId: "a4-composition-cue",
      operations: [
        {
          op: "cue.add",
          sceneId,
          template: { id: "composition.full-bleed", version: 1 },
          range: { kind: "scene" },
          layer: "background",
          input: { compositionVersionId: version.id },
        },
      ],
    });
    expect(edited.scriptVersion.author).toBe("agent");
    expect(edited.created.cueIds).toHaveLength(1);

    const scene = edited.scriptVersion.content.scenes[0]!;
    const cue = scene.visualCues.find((entry) => entry.id === edited.created.cueIds[0]);
    expect(cue?.template.id).toBe("composition.full-bleed");
    expect(cue?.input).toEqual({ compositionVersionId: version.id });

    const readBack = await client.request("script.get", {
      scriptVersionId: edited.scriptVersion.id,
    });
    expect(
      readBack.scriptVersion.content.scenes[0]!.visualCues.some(
        (entry) => entry.id === edited.created.cueIds[0],
      ),
    ).toBe(true);
  }, 120000);

  it("keeps service error codes stable through the socket", async () => {
    await expectAgentError(
      client.request("composition.get", { compositionId: "cmp_missing" }),
      "RESOURCE_NOT_FOUND",
    );
    await expectAgentError(
      client.request("composition.draft.get", { compositionId: "cmp_missing" }),
      "RESOURCE_NOT_FOUND",
    );
    await expectAgentError(
      client.request("composition.publish", { compositionId: "cmp_missing", dryRun: true }),
      "RESOURCE_NOT_FOUND",
    );

    await expectAgentError(rawRequest("composition.get", {}), "VALIDATION_ERROR");

    await expectAgentError(
      rawRequest("composition.publish", { compositionId: "cmp_missing", dryRun: "yes" }),
      "VALIDATION_ERROR",
    );
    await expectAgentError(
      rawRequest("composition.create", { name: "Missing runtime id" }),
      "VALIDATION_ERROR",
    );
  });

  it("does not register or expose composition deletion", async () => {
    expect(
      agentOperationNames.filter((name) => /(delete|remove|destroy|purge)/u.test(name)),
    ).toEqual([]);

    const composition = await client.request("composition.create", {
      name: "Not Deletable",
      runtimeCompositionId: "cmp.agent.not-deletable",
    });
    await expectAgentError(
      rawRequest("composition.delete", { compositionId: composition.composition.id }),
      "AGENT_OPERATION_UNKNOWN",
    );
    const stillThere = await client.request("composition.get", {
      compositionId: composition.composition.id,
    });
    expect(stillThere.composition.id).toBe(composition.composition.id);
  });
});
