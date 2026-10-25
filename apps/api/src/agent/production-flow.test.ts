import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createKakeaiMcpServer,
  mcpToolEntries,
  mcpToolName,
  toMcpTool,
} from "@kakeai/mcp";
import { createAgentClient } from "@kakeai/agent-client";
import { runCli, type CliIo } from "@kakeai/cli";
import {
  agentOperationCatalog,
  agentOperationInputSchemas,
  agentOperationNames,
  agentOperationOutputSchemas,
  type AgentOperationName,
  type AgentVisualTemplate,
  type Asset,
  type CharacterLibraryEntry,
  type Job,
  type ScriptEditResult,
  type ScriptValidateResult,
  type ScriptVersion,
  type Work,
} from "@kakeai/contracts";
import type { AppConfig } from "../config.ts";
import { loadConfig } from "../config.ts";
import { createPrismaClient } from "../db/client.ts";
import { runMigrations } from "../db/migrate.ts";
import { applySqlitePragmas } from "../db/pragmas.ts";
import { createCharacter } from "../services/character-library.ts";
import { FakeFontCatalogAdapter, FontCatalogService } from "../services/font-catalog.ts";
import { createVoiceProfile } from "../services/voice-profiles.ts";
import { ensureDataDirectories } from "../storage/paths.ts";
import {
  startMockVoicevoxServer,
  wavFixture,
  type MockVoicevoxServer,
} from "../testing/tts-mocks.ts";
import { createWorker } from "../worker/index.ts";
import { startAgentSocketServer, type AgentSocketServer } from "./socket-server.ts";

// A 1x1 PNG. It is only used to exercise content detection and probing.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=",
  "base64",
);

const MOCK_VOICE_ID = "uuid-metantan:2";
const MOCK_SPEAKERS = [
  {
    name: "四国めたん",
    speaker_uuid: "uuid-metantan",
    styles: [{ name: "ノーマル", id: 2 }],
  },
];

const AGENT_ID = "production-flow-agent";

let dataDir: string;
let fixtureDir: string;
let imagePath: string;
let audioPath: string;
let config: AppConfig;
let prisma: ReturnType<typeof createPrismaClient>;
let worker: ReturnType<typeof createWorker>;
let agentServer: AgentSocketServer;
let mcpServer: ReturnType<typeof createKakeaiMcpServer>;
let mcpClient: Client;
let ttsEngine: MockVoicevoxServer;

function ffprobeAvailable(): boolean {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const probeAvailable = ffprobeAvailable();

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function json(text: string): unknown {
  expect(text.trim().split("\n")).toHaveLength(1);
  return JSON.parse(text) as unknown;
}

function mcpText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content;
  const first = content?.[0];
  if (first === undefined || first.type !== "text" || first.text === undefined) {
    throw new Error("expected a text content block");
  }
  return first.text;
}

function structured<T>(result: unknown): T {
  return (result as { structuredContent?: unknown }).structuredContent as T;
}

/** Calls one MCP tool and fails the test with the binding error payload. */
async function call<T>(toolName: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await mcpClient.callTool({ name: toolName, arguments: args });
  if ((result as { isError?: boolean }).isError === true) {
    throw new Error(`${toolName} failed: ${mcpText(result)}`);
  }
  return structured<T>(result);
}

/** Runs the CLI in-process against the real local socket. */
async function cli(argv: string[]): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    // Explicitly empty so a developer's KAKEAI_* environment cannot leak in.
    env: {},
  };
  const exitCode = await runCli(["--data-dir", dataDir, ...argv], io);
  return { exitCode, stdout: out.join(""), stderr: err.join("") };
}

async function drainWorker(): Promise<void> {
  while (await worker.runOnce()) {
    continue;
  }
}

/** Mirrors the MCP binding's Zod-to-JSON-Schema conversion for assertions. */
function generatedToolSchema(
  schema: z.ZodType,
  io: "input" | "output",
): Record<string, unknown> {
  const { $schema: _schema, ...rest } = z.toJSONSchema(schema, { io }) as Record<
    string,
    unknown
  >;
  return rest.type === undefined ? { type: "object", ...rest } : rest;
}

/**
 * Builds a valid template input from the schema catalog instead of hardcoding
 * field names: every required media field gets the ready image, selects take
 * their first declared option, text fields a fixed string and booleans false.
 */
function templateInputFor(
  template: AgentVisualTemplate,
  imageAssetId: string,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of template.inputFields) {
    switch (field.kind) {
      case "media":
        input[field.key] = imageAssetId;
        break;
      case "select": {
        if (field.optional === true) {
          break;
        }
        const option = field.options[0];
        if (option === undefined) {
          throw new Error(`template ${template.id} has an empty select: ${field.key}`);
        }
        input[field.key] = option.value;
        break;
      }
      case "text":
        input[field.key] = "制作フローの画像";
        break;
      case "boolean":
        input[field.key] = false;
        break;
      default:
        // Every other field kind is optional on the templates used here.
        break;
    }
  }
  return input;
}

function firstEdition(work: Work) {
  const edition = work.languageEditions[0];
  if (edition === undefined) {
    throw new Error("language edition missing");
  }
  return edition;
}

function sceneIn(content: ScriptVersion["content"], sceneId: string) {
  const scene = content.scenes.find((entry) => entry.id === sceneId);
  if (scene === undefined) {
    throw new Error(`scene missing: ${sceneId}`);
  }
  return scene;
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "kakeai-production-flow-"));
  fixtureDir = await mkdtemp(join(tmpdir(), "kakeai-production-flow-fixture-"));
  imagePath = join(fixtureDir, "flow-photo.png");
  audioPath = join(fixtureDir, "flow-tone.wav");
  await writeFile(imagePath, PNG_1X1);
  await writeFile(audioPath, wavFixture(1000, 440));

  process.env.KAKEAI_DATA_DIR = dataDir;
  config = loadConfig();
  await ensureDataDirectories(config.directories);
  await runMigrations();
  prisma = createPrismaClient(config.databaseUrl);
  await applySqlitePragmas(prisma);
  worker = createWorker({ prisma, config });
  // A distinct tone/duration so the synthesized asset does not deduplicate
  // onto the imported fixture.
  ttsEngine = await startMockVoicevoxServer({
    speakers: MOCK_SPEAKERS,
    wav: wavFixture(1250, 660),
  });
  config.voiceBaseUrls.voicevox = ttsEngine.baseUrl;
  agentServer = await startAgentSocketServer({
    config,
    prisma,
    // The real font profiler is slow and must never run in tests.
    fontCatalogService: new FontCatalogService(new FakeFontCatalogAdapter()),
  });

  mcpServer = createKakeaiMcpServer({
    request: createAgentClient({ dataRoot: config.dataRoot, agentId: AGENT_ID }),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "production-flow-client", version: "0.0.0" }, {
    capabilities: {},
  });
  await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)]);
}, 60000);

afterAll(async () => {
  await mcpClient.close();
  await mcpServer.close();
  await agentServer.close();
  await ttsEngine.close();
  await prisma.$disconnect();
  delete process.env.KAKEAI_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true });
  await rm(fixtureDir, { recursive: true, force: true });
});

describe("binding catalogs", () => {
  it("lists every agent operation as an MCP tool with contract-generated schemas", async () => {
    const listed = await mcpClient.listTools();
    const expectedOperations = agentOperationNames.map(mcpToolName).sort();
    const operationToolNames = listed.tools
      .map((tool) => tool.name)
      .filter((name) => name !== "kakeai_job_wait")
      .sort();

    // Counts and names derive from the contracts catalog, not a second list.
    expect(listed.tools).toHaveLength(agentOperationNames.length + 1);
    expect(operationToolNames).toEqual(expectedOperations);
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(
      [...expectedOperations, "kakeai_job_wait"].sort(),
    );

    for (const entry of mcpToolEntries) {
      const tool = listed.tools.find((candidate) => candidate.name === entry.toolName);
      expect(tool).toBeDefined();
      expect(tool?.inputSchema).toEqual(toMcpTool(entry).inputSchema);
      expect(tool?.outputSchema).toEqual(toMcpTool(entry).outputSchema);
      expect(tool?.inputSchema.type).toBe("object");
      expect(tool?.outputSchema?.type).toBe("object");
    }

    // The A9 operations ship the shared TTS / character / asset schemas.
    for (const operation of [
      "tts.create",
      "tts.createBulk",
      "character.list",
      "character.get",
      "asset.list",
    ] as const) {
      const tool = listed.tools.find((candidate) => candidate.name === mcpToolName(operation));
      expect(tool?.inputSchema).toEqual(
        generatedToolSchema(agentOperationInputSchemas[operation], "input"),
      );
      expect(tool?.outputSchema).toEqual(
        generatedToolSchema(agentOperationOutputSchemas[operation], "output"),
      );
    }
    const ttsTool = listed.tools.find((tool) => tool.name === mcpToolName("tts.create"));
    expect(ttsTool?.annotations?.readOnlyHint).toBe(false);
    expect(ttsTool?.inputSchema.properties).toHaveProperty("narrationSegmentId");
    expect(ttsTool?.outputSchema?.properties).toHaveProperty("job");
    const characterList = listed.tools.find(
      (tool) => tool.name === mcpToolName("character.list"),
    );
    expect(characterList?.annotations?.readOnlyHint).toBe(true);
    expect(characterList?.outputSchema?.properties).toHaveProperty("characters");
  });

  it("lists the same operation set through the CLI operations catalog", async () => {
    const result = await cli(["operations"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const catalog = json(result.stdout) as {
      operations: Array<{ name: string; kind: string; longRunning: boolean }>;
    };

    expect(catalog.operations).toEqual(agentOperationCatalog.map((entry) => ({ ...entry })));
    expect(catalog.operations.map((entry) => entry.name)).toEqual([...agentOperationNames]);
    expect(
      catalog.operations.map((entry) => mcpToolName(entry.name as AgentOperationName)).sort(),
    ).toEqual(agentOperationNames.map(mcpToolName).sort());
    expect(catalog.operations).toContainEqual({
      name: "tts.create",
      kind: "mutation",
      longRunning: true,
    });
    expect(catalog.operations).toContainEqual({
      name: "character.list",
      kind: "read",
      longRunning: false,
    });
  });
});

describe("production flow through the MCP binding", () => {
  it.skipIf(!probeAvailable)(
    "runs create → import → character → edit → tts → cue → render end to end",
    async () => {
      // a. Create the work and read the initial (human) script version.
      const schema = await call<{
        templates: AgentVisualTemplate[];
        warningCodes: string[];
        agentOperations: Array<{ name: string; kind: string; longRunning: boolean }>;
      }>("kakeai_schema_get");
      expect(schema.agentOperations).toHaveLength(agentOperationNames.length);

      const created = await call<{ work: Work }>("kakeai_work_create", {
        title: "制作フロー統合テスト",
      });
      const edition = firstEdition(created.work);
      const initial = await call<{ scriptVersion: ScriptVersion }>("kakeai_script_get", {
        languageEditionId: edition.id,
      });
      expect(initial.scriptVersion.versionNumber).toBe(1);
      expect(initial.scriptVersion.author).toBe("human");
      expect(initial.scriptVersion.content.scenes.map((scene) => scene.kind)).toEqual([
        "intro",
        "point",
        "outro",
      ]);

      // b. Import and tag a ready image and a ready audio asset.
      const imageImport = await call<{ asset: Asset; jobId: string | null }>(
        "kakeai_asset_import",
        { path: imagePath, originalFilename: "flow-photo.png" },
      );
      expect(imageImport.jobId).not.toBeNull();
      const audioImport = await call<{ asset: Asset; jobId: string | null }>(
        "kakeai_asset_import",
        { path: audioPath, originalFilename: "flow-tone.wav" },
      );
      expect(audioImport.jobId).not.toBeNull();

      // Nothing moves the ingest Jobs until this test drains the single worker.
      expect(worker.status()).toBe("notReady");
      const queuedIngest = await call<{ job: Job }>("kakeai_job_get", {
        jobId: imageImport.jobId,
      });
      expect(queuedIngest.job.status).toBe("queued");
      await drainWorker();

      const imageJob = await call<{ job: Job; timedOut: boolean }>("kakeai_job_wait", {
        jobId: imageImport.jobId,
        timeoutMs: 5000,
        intervalMs: 10,
      });
      expect(imageJob.timedOut).toBe(false);
      expect(imageJob.job.status).toBe("succeeded");
      const audioJob = await call<{ job: Job; timedOut: boolean }>("kakeai_job_wait", {
        jobId: audioImport.jobId,
        timeoutMs: 5000,
        intervalMs: 10,
      });
      expect(audioJob.timedOut).toBe(false);
      expect(audioJob.job.status).toBe("succeeded");

      const imageAsset = (
        await call<{ asset: Asset }>("kakeai_asset_get", { assetId: imageImport.asset.id })
      ).asset;
      const audioAsset = (
        await call<{ asset: Asset }>("kakeai_asset_get", { assetId: audioImport.asset.id })
      ).asset;
      expect(imageAsset).toMatchObject({ kind: "image", status: "ready" });
      expect(audioAsset).toMatchObject({ kind: "audio", status: "ready" });
      expect(audioAsset.durationMs).toBeGreaterThan(0);

      await call<{ asset: Asset }>("kakeai_asset_tag", {
        assetId: imageAsset.id,
        tags: ["production-flow", "背景"],
      });
      await call<{ asset: Asset }>("kakeai_asset_tag", {
        assetId: audioAsset.id,
        tags: ["production-flow", "bgm"],
      });

      const imageQuery = {
        kind: "image",
        status: "ready",
        filename: "PHOTO",
        tags: ["production-flow", "背景"],
        tagMode: "and",
        limit: 10,
      };
      const imagePage = await call<{ assets: Asset[]; nextCursor: string | null }>(
        "kakeai_asset_list",
        imageQuery,
      );
      expect(imagePage.assets.map((asset) => asset.id)).toEqual([imageAsset.id]);
      expect(imagePage.nextCursor).toBeNull();
      expect(imagePage.assets[0]?.tags).toEqual(["production-flow", "背景"]);

      const audioPage = await call<{ assets: Asset[] }>("kakeai_asset_list", {
        kind: "audio",
        status: "ready",
        filename: "tone",
        tags: ["production-flow", "bgm"],
        tagMode: "and",
      });
      expect(audioPage.assets.map((asset) => asset.id)).toEqual([audioAsset.id]);

      // Tag AND is a real intersection: the image misses the audio tag.
      const mismatch = await call<{ assets: Asset[] }>("kakeai_asset_list", {
        kind: "image",
        tags: ["production-flow", "bgm"],
        tagMode: "and",
      });
      expect(mismatch.assets).toEqual([]);

      // Parity: CLI stdout and MCP structuredContent agree on the same socket.
      const listViaCli = await cli([
        "asset.list",
        "--input",
        JSON.stringify(imageQuery),
      ]);
      expect(listViaCli.exitCode).toBe(0);
      expect(listViaCli.stderr).toBe("");
      expect(json(listViaCli.stdout)).toEqual(imagePage);

      // c. Seed the character library directly: library mutations are not
      // exposed to agents, so the test uses the HTTP surface's service.
      const voiceProfile = await createVoiceProfile(prisma, {
        name: "めたん",
        adapterId: "voicevox",
        voiceId: MOCK_VOICE_ID,
        locale: "ja-JP",
        settings: {},
      });
      const libraryCharacter = await createCharacter(prisma, {
        name: "四国めたん",
        voices: [{ locale: "ja-JP", voiceProfileId: voiceProfile.id }],
        appearances: [
          {
            id: "production-flow-appearance",
            assetId: imageAsset.id,
            expression: "smile",
            pose: "front",
            label: "通常",
            faceSetId: null,
          },
        ],
      });

      const library = await call<{ characters: CharacterLibraryEntry[] }>(
        "kakeai_character_list",
      );
      const libraryEntry = library.characters.find((entry) => entry.id === libraryCharacter.id);
      expect(libraryEntry?.voices).toEqual([{ locale: "ja-JP", voiceProfileId: voiceProfile.id }]);
      expect(libraryEntry?.appearances).toHaveLength(1);
      expect(libraryEntry?.appearances[0]).toMatchObject({
        assetId: imageAsset.id,
        expression: "smile",
        pose: "front",
      });
      const fetchedCharacter = await call<{ character: CharacterLibraryEntry }>(
        "kakeai_character_get",
        { characterId: libraryCharacter.id },
      );
      expect(fetchedCharacter.character).toEqual(libraryEntry);

      const charactersViaCli = await cli(["character.list"]);
      expect(charactersViaCli.exitCode).toBe(0);
      expect(charactersViaCli.stderr).toBe("");
      expect(json(charactersViaCli.stdout)).toEqual(library);

      // d. Add a point scene and copy the library character in one edit, then
      // consume the returned speaker and appearance IDs in a second edit.
      const edit1 = await call<ScriptEditResult>("kakeai_script_edit", {
        baseScriptVersionId: initial.scriptVersion.id,
        requestId: `${AGENT_ID}:d1`,
        operations: [
          { op: "scene.add", kind: "point", key: "flow-point", index: 1, label: "要点" },
          {
            op: "line.add",
            sceneId: { key: "flow-point" },
            key: "flow-line-speaker",
            captionText: "キャラクターが話します。",
            speechText: "キャラクターが話します。",
          },
          {
            op: "line.add",
            sceneId: { key: "flow-point" },
            key: "flow-line-copy",
            captionText: "コピーしたキャラクターです。",
            speechText: "コピーしたキャラクターです。",
          },
          { op: "character.addFromLibrary", libraryCharacterId: libraryCharacter.id },
        ],
      });
      expect(edit1.replay).toBe(false);
      expect(edit1.created.sceneIds).toHaveLength(1);
      expect(edit1.created.lineIds).toHaveLength(2);
      expect(edit1.created.speakerIds).toHaveLength(1);
      expect(edit1.created.appearanceIds).toHaveLength(1);
      expect(edit1.created.characterIds).toHaveLength(1);

      const pointSceneId = edit1.created.sceneIds[0]!;
      const speakerId = edit1.created.speakerIds[0]!;
      const characterId = edit1.created.characterIds[0]!;
      const appearanceId = edit1.created.appearanceIds[0]!;
      const [speakerLineId, copyLineId] = edit1.created.lineIds as [string, string];
      const copiedScene = sceneIn(edit1.scriptVersion.content, pointSceneId);
      expect(copiedScene.lines.map((line) => line.id)).toEqual([speakerLineId, copyLineId]);
      const copiedSpeaker = edit1.scriptVersion.content.speakers.find(
        (speaker) => speaker.id === speakerId,
      );
      expect(copiedSpeaker).toMatchObject({ characterId, voiceProfileId: voiceProfile.id });

      const edit2 = await call<ScriptEditResult>("kakeai_script_edit", {
        baseScriptVersionId: edit1.scriptVersion.id,
        requestId: `${AGENT_ID}:d2`,
        operations: [
          {
            op: "line.setSpeaker",
            sceneId: pointSceneId,
            lineId: speakerLineId,
            speakerId,
          },
          {
            op: "standing.set",
            sceneId: pointSceneId,
            side: "left",
            characterId,
            appearanceId,
          },
        ],
      });
      const sceneAfterStanding = sceneIn(edit2.scriptVersion.content, pointSceneId);
      expect(
        sceneAfterStanding.lines.find((line) => line.id === speakerLineId)?.speakerId,
      ).toBe(speakerId);
      expect(
        sceneAfterStanding.lines.find((line) => line.id === copyLineId)?.speakerId,
      ).toBeNull();
      const standing = sceneAfterStanding.visualCues.find(
        (cue) => cue.template.id === "character.standing",
      );
      expect(standing?.input).toMatchObject({ characterId, appearanceId, side: "left" });

      // e. Synthesize one line, then attach the produced Take through an edit.
      const ttsJob = await call<{ job: Job }>("kakeai_tts_create", {
        scriptVersionId: edit2.scriptVersion.id,
        narrationSegmentId: speakerLineId,
      });
      expect(ttsJob.job).toMatchObject({ kind: "tts", status: "queued" });
      expect(ttsJob.job.scriptVersionId).toBe(edit2.scriptVersion.id);
      const untouched = await call<{ job: Job }>("kakeai_job_get", { jobId: ttsJob.job.id });
      expect(untouched.job.status).toBe("queued");
      await drainWorker();

      const synthesized = await call<{ job: Job; timedOut: boolean }>("kakeai_job_wait", {
        jobId: ttsJob.job.id,
        timeoutMs: 5000,
        intervalMs: 10,
      });
      expect(synthesized.timedOut).toBe(false);
      expect(synthesized.job.status).toBe("succeeded");
      expect(synthesized.job.ttsResult).toMatchObject({
        narrationSegmentId: speakerLineId,
        source: "tts",
      });
      const ttsResult = synthesized.job.ttsResult!;
      expect(ttsResult.durationMs).toBeGreaterThan(0);
      expect(ttsEngine.counters.synthesis).toBe(1);
      const generated = (
        await call<{ asset: Asset }>("kakeai_asset_get", { assetId: ttsResult.assetId })
      ).asset;
      expect(generated).toMatchObject({ kind: "audio", status: "ready", origin: "generated" });

      const reread = await call<{ scriptVersion: ScriptVersion }>("kakeai_script_get", {
        languageEditionId: edition.id,
      });
      expect(reread.scriptVersion.id).toBe(edit2.scriptVersion.id);

      const edit3 = await call<ScriptEditResult>("kakeai_script_edit", {
        baseScriptVersionId: reread.scriptVersion.id,
        requestId: `${AGENT_ID}:e1`,
        operations: [
          {
            op: "line.assignTake",
            sceneId: pointSceneId,
            lineId: speakerLineId,
            assetId: ttsResult.assetId,
            source: "tts",
          },
        ],
      });
      expect(edit3.scriptVersion.versionNumber).toBe(
        reread.scriptVersion.versionNumber + 1,
      );
      const takeId = edit3.created.audioTakeIds[0]!;
      expect(
        edit3.scriptVersion.content.audioTakes.find((take) => take.id === takeId),
      ).toMatchObject({
        narrationSegmentId: speakerLineId,
        source: "tts",
        assetId: ttsResult.assetId,
        durationMs: ttsResult.durationMs,
      });
      expect(
        sceneIn(edit3.scriptVersion.content, pointSceneId).lines.find(
          (line) => line.id === speakerLineId,
        )?.selectedAudioTakeId,
      ).toBe(takeId);

      // f. Add a VisualCue from a catalog template and a work-range BGM.
      const mediaTemplate = schema.templates.find(
        (template) =>
          template.layers.length > 0 &&
          template.inputFields.some(
            (field) => field.kind === "media" && field.assetKinds.includes("image"),
          ),
      );
      if (mediaTemplate === undefined) {
        throw new Error("schema.get did not describe an image template");
      }
      const cueInput = templateInputFor(mediaTemplate, imageAsset.id);
      const edit4 = await call<ScriptEditResult>("kakeai_script_edit", {
        baseScriptVersionId: edit3.scriptVersion.id,
        requestId: `${AGENT_ID}:f1`,
        operations: [
          {
            op: "cue.add",
            key: "flow-media-cue",
            sceneId: pointSceneId,
            template: { id: mediaTemplate.id, version: mediaTemplate.version },
            range: { kind: "scene" },
            layer: mediaTemplate.layers[0]!,
            input: cueInput,
          },
          {
            op: "audio.add",
            key: "flow-bgm",
            role: "bgm",
            assetId: audioAsset.id,
            range: { kind: "work" },
            gainDb: -6,
            loop: true,
          },
        ],
      });
      expect(edit4.created.cueIds).toHaveLength(1);
      expect(edit4.created.audioCueIds).toHaveLength(1);
      const addedCue = sceneIn(edit4.scriptVersion.content, pointSceneId).visualCues.find(
        (cue) => cue.id === edit4.created.cueIds[0],
      );
      expect(addedCue).toMatchObject({
        template: { id: mediaTemplate.id, version: mediaTemplate.version },
      });
      expect(addedCue?.input).toMatchObject({ assetId: imageAsset.id });
      expect(
        edit4.scriptVersion.content.audioCues.find(
          (cue) => cue.id === edit4.created.audioCueIds[0],
        ),
      ).toMatchObject({ role: "bgm", assetId: audioAsset.id, range: { kind: "work" } });

      // g. Validate, then queue a render Job without draining it.
      const validated = await call<ScriptValidateResult>("kakeai_script_validate", {
        content: edit4.scriptVersion.content,
      });
      expect(validated.warnings).toBeInstanceOf(Array);
      for (const warning of validated.warnings) {
        expect(schema.warningCodes).toContain(warning.code);
      }
      expect(validated.timeline.totalDurationMs).toBeGreaterThan(0);
      expect(validated.timeline.scenes).toHaveLength(
        edit4.scriptVersion.content.scenes.length,
      );

      const render = await call<{ job: Job }>("kakeai_render_start", {
        scriptVersionId: edit4.scriptVersion.id,
      });
      expect(render.job).toMatchObject({
        kind: "render",
        status: "queued",
        scriptVersionId: edit4.scriptVersion.id,
      });
      expect(render.job.artifacts).toEqual([]);
      const notDrained = await call<{ job: Job; timedOut: boolean }>("kakeai_job_wait", {
        jobId: render.job.id,
        timeoutMs: 0,
        intervalMs: 10,
      });
      expect(notDrained.job.status).toBe("queued");
      expect(notDrained.timedOut).toBe(true);

      // h. Every ScriptVersion this flow created is attributed to the agent.
      const edits: Array<{ result: ScriptEditResult; requestId: string }> = [
        { result: edit1, requestId: `${AGENT_ID}:d1` },
        { result: edit2, requestId: `${AGENT_ID}:d2` },
        { result: edit3, requestId: `${AGENT_ID}:e1` },
        { result: edit4, requestId: `${AGENT_ID}:f1` },
      ];
      expect(edits.map((entry) => entry.result.scriptVersion.versionNumber)).toEqual([
        initial.scriptVersion.versionNumber + 1,
        initial.scriptVersion.versionNumber + 2,
        initial.scriptVersion.versionNumber + 3,
        initial.scriptVersion.versionNumber + 4,
      ]);
      for (const { result, requestId } of edits) {
        expect(result.scriptVersion.author).toBe("agent");
        expect(result.scriptVersion.authorAgentId).toBe(AGENT_ID);
        expect(result.scriptVersion.agentRequestId).toBe(requestId);
        expect(result.scriptVersion.agentRequestHash).toMatch(/^sha256:/u);
      }
      const current = await call<{ work: Work }>("kakeai_work_get", {
        workId: created.work.id,
      });
      expect(firstEdition(current.work).currentScriptVersion.id).toBe(
        edit4.scriptVersion.id,
      );

      // Only voice assignment is writable on the agent surface.
      expect(agentOperationNames.filter((name) => name.startsWith("character."))).toEqual([
        "character.list",
        "character.get",
        "character.setVoices",
      ]);
      const unknownTool = await mcpClient.callTool({
        name: "kakeai_character_create",
        arguments: { name: "作らない" },
      });
      expect((unknownTool as { isError?: boolean }).isError).toBe(true);
      expect((JSON.parse(mcpText(unknownTool)) as { code: string }).code).toBe(
        "MCP_TOOL_UNKNOWN",
      );
      const libraryAfter = await call<{ characters: CharacterLibraryEntry[] }>(
        "kakeai_character_list",
      );
      expect(libraryAfter.characters.map((entry) => entry.id)).toEqual([
        libraryCharacter.id,
      ]);
      expect(await prisma.character.count()).toBe(1);
      expect(await prisma.characterAppearance.count()).toBe(1);
    },
    120000,
  );
});
