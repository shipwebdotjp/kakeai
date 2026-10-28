import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Work } from "@kakeai/contracts";
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
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

let dataDir: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let agentServer: AgentSocketServer;
let client: AgentClient;

function firstEdition(work: Work) {
  const edition = work.languageEditions[0];
  if (edition === undefined) {
    throw new Error("language edition missing");
  }
  return edition;
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
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-agent-history-"));
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
  });
  client = createAgentClient({ dataRoot: config.dataRoot, agentId: "history-e2e-agent" });
}, 60000);

afterAll(async () => {
  await agentServer.close();
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
});

describe("script version history and restore", () => {
  it("lists versions, restores a past version, and replays the request idempotently", async () => {
    const work = (await client.request("work.create", { title: "履歴テスト" })).work;
    const edition = firstEdition(work);
    const v1 = edition.currentScriptVersion.id;

    const edited = await client.request("script.edit", {
      baseScriptVersionId: v1,
      requestId: "history-edit-1",
      operations: [
        { op: "scene.add", kind: "point", key: "history-scene", label: "履歴テスト" },
      ],
    });
    const v2 = edited.scriptVersion.id;

    const history = await client.request("script.listVersions", {
      languageEditionId: edition.id,
    });
    expect(history.languageEditionId).toBe(edition.id);
    expect(history.currentScriptVersionId).toBe(v2);
    expect(history.scriptVersions.map((version) => version.id)).toEqual([v2, v1]);
    expect(history.scriptVersions[0]?.sourceScriptVersionId).toBeNull();

    const restored = await client.request("script.restore", {
      scriptVersionId: v1,
      baseScriptVersionId: v2,
      requestId: "history-restore-1",
    });
    expect(restored.replay).toBe(false);
    expect(restored.scriptVersion.versionNumber).toBe(3);
    expect(restored.scriptVersion.author).toBe("agent");
    expect(restored.scriptVersion.authorAgentId).toBe("history-e2e-agent");
    expect(restored.scriptVersion.sourceScriptVersionId).toBe(v1);

    const v1Content = (
      await client.request("script.get", { scriptVersionId: v1 })
    ).scriptVersion.content;
    expect(restored.scriptVersion.content).toEqual(v1Content);

    const replay = await client.request("script.restore", {
      scriptVersionId: v1,
      baseScriptVersionId: v2,
      requestId: "history-restore-1",
    });
    expect(replay.replay).toBe(true);
    expect(replay.scriptVersion.id).toBe(restored.scriptVersion.id);
    expect(
      await prisma.scriptVersion.count({
        where: { languageEditionId: edition.id },
      }),
    ).toBe(3);

    await expectAgentError(
      client.request("script.restore", {
        scriptVersionId: v2,
        baseScriptVersionId: restored.scriptVersion.id,
        requestId: "history-restore-1",
      }),
      "IDEMPOTENCY_CONFLICT",
    );

    await expectAgentError(
      client.request("script.restore", {
        scriptVersionId: restored.scriptVersion.id,
        requestId: "history-restore-current",
      }),
      "VALIDATION_ERROR",
    );

    await expectAgentError(
      client.request("script.restore", {
        scriptVersionId: v2,
        baseScriptVersionId: v1,
        requestId: "history-restore-stale",
      }),
      "SCRIPT_BASE_STALE",
    );

    const otherWork = (await client.request("work.create", { title: "別作品" })).work;
    await expectAgentError(
      client.request("script.restore", {
        scriptVersionId: v2,
        baseScriptVersionId: firstEdition(otherWork).currentScriptVersion.id,
        requestId: "history-restore-other-edition",
      }),
      "VALIDATION_ERROR",
    );
  });

  it("reports missing editions and versions with stable codes", async () => {
    await expectAgentError(
      client.request("script.listVersions", { languageEditionId: "led-missing" }),
      "WORK_NOT_FOUND",
    );
    await expectAgentError(
      client.request("script.restore", {
        scriptVersionId: "scr-missing",
        requestId: "history-restore-missing",
      }),
      "WORK_NOT_FOUND",
    );
  });
});

describe("work clone and recovery data", () => {
  it("creates a child work from the current version and records the source", async () => {
    const work = (await client.request("work.create", { title: "複製元" })).work;
    const edition = firstEdition(work);
    const sourceVersionId = edition.currentScriptVersion.id;

    const cloned = (
      await client.request("work.clone", {
        workId: work.id,
        title: "複製先",
        sourceEditionId: edition.id,
      })
    ).work;
    expect(cloned.title).toBe("複製先");
    expect(cloned.parentWorkId).toBe(work.id);

    const clonedEdition = firstEdition(cloned);
    const clonedVersion = await prisma.scriptVersion.findUniqueOrThrow({
      where: { id: clonedEdition.currentScriptVersion.id },
    });
    expect(clonedVersion.author).toBe("agent");
    expect(clonedVersion.authorAgentId).toBe("history-e2e-agent");
    expect(clonedVersion.sourceScriptVersionId).toBe(sourceVersionId);

    const sourceContent = (
      await client.request("script.get", { scriptVersionId: sourceVersionId })
    ).scriptVersion.content;
    const clonedContent = (
      await client.request("script.get", { scriptVersionId: clonedVersion.id })
    ).scriptVersion.content;
    expect(clonedContent).toEqual(sourceContent);

    const listed = await client.request("work.list", {});
    const child = listed.works.find((entry) => entry.id === cloned.id);
    expect(child?.parentWorkId).toBe(work.id);
    expect(child?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);

    await expectAgentError(
      client.request("work.clone", {
        workId: "wrk-missing",
        title: "不明",
        sourceEditionId: "led-missing",
      }),
      "WORK_NOT_FOUND",
    );
  });
});
