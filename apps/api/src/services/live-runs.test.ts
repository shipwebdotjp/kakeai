import { createHash } from "node:crypto";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  livePackageManifestSchema,
  livePackageShowSchema,
  liveRunConfigSchema,
  type CreateLiveRunRequest,
  type LiveControlStatus,
  type LivePackageBuild,
} from "@kakeai/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { LiveControlClient } from "../live-runs/control-client.ts";
import type { LiveRunLauncher } from "../live-runs/launcher.ts";
import type { LiveProcessController } from "../live-runs/process.ts";
import {
  createLiveRun,
  getLiveRun,
  launchLiveRun,
  listLiveRuns,
  stopLiveRun,
} from "./live-runs.ts";
import { createLiveTestContext, type LiveTestContext } from "./live-program-test-helpers.ts";

const DOC_SHA = "a".repeat(64);
const SNAPSHOT_SHA = "b".repeat(64);
const MANIFEST_TIME = "2026-11-07T12:00:00.000Z";

let context: LiveTestContext;
let versionId: string;
let programId: string;

function minimalShow() {
  const cue = (id: string, caption: string) => ({
    id,
    origin: "live" as const,
    speaker: "left" as const,
    caption,
    speech: caption,
    expression: "normal",
    audio: `audio/prepared/${id}.wav`,
    durationMs: 1000,
  });
  return livePackageShowSchema.parse({
    schemaVersion: 2,
    show: {
      title: "Run テスト",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: "theme.css",
      characters: { left: "char-left", right: null },
    },
    segments: [
      {
        id: "seg-opening",
        kind: "opening",
        label: "オープニング",
        targetDurationMs: 60_000,
        cues: ["cue-opening"],
      },
      {
        id: "seg-script",
        kind: "script",
        label: "本編",
        targetDurationMs: 300_000,
        cues: ["cue-script"],
      },
      {
        id: "seg-closing",
        kind: "closing",
        label: "クロージング",
        targetDurationMs: 60_000,
        cues: ["cue-closing"],
      },
    ],
    cues: [
      cue("cue-opening", "始まります。"),
      cue("cue-script", "本編です。"),
      cue("cue-closing", "終わります。"),
      cue("cue-fallback", "補足します。"),
    ],
    speakers: [
      {
        id: "spk-left",
        name: "左",
        side: "left",
        characterId: "char-left",
        voice: {
          adapterId: "voicevox",
          voiceId: "voice-1",
          speedScale: 1,
          settings: {},
        },
      },
    ],
    safety: {
      blockedTopics: [],
      persona: "解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-fallback",
    },
    commentPolicy: {
      mode: "corner",
      freshnessMin: 10,
      maxCommentsPerCorner: 4,
      maxHumanPinsPerCorner: 4,
      maxExtraSlots: 2,
      allowImmediateInterrupt: false,
      skipWhenEmpty: true,
    },
    playout: {
      minBufferMs: 10_000,
      maxThinkingMs: 2000,
      closingReserveMs: 120_000,
      noApprovalDelay: true,
    },
  });
}

interface PackageOptions {
  packageId?: string;
  programVersionId?: string;
  /** Set false to model an arbitrary directory that no export produced. */
  withExportJob?: boolean;
}

async function writePackage(
  rootDir: string,
  options: PackageOptions = {},
): Promise<LivePackageBuild> {
  const packageId = options.packageId ?? "livepkg-test";
  const programVersionId = options.programVersionId ?? versionId;
  const showText = `${JSON.stringify(minimalShow(), null, 2)}\n`;
  await mkdir(rootDir, { recursive: true });
  await writeFile(join(rootDir, "show.json"), showText, "utf8");
  const manifest = livePackageManifestSchema.parse({
    packageSchemaVersion: 2,
    exporterVersion: "0.1.0",
    packageId,
    createdAt: MANIFEST_TIME,
    source: {
      programId,
      programVersionId,
      programVersionNumber: 1,
      programDocumentSha256: DOC_SHA,
      resolutionSnapshotSha256: SNAPSHOT_SHA,
      theme: { id: "neutral", version: 1 },
    },
    cardSchemaVersion: 1,
    files: [],
    fonts: [],
    voices: [],
  });
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(rootDir, "manifest.json"), manifestText, "utf8");
  const packageBuild: LivePackageBuild = {
    packageId,
    manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
    packagePath: rootDir,
  };
  if (options.withExportJob ?? true) {
    await createSucceededExportJob(packageBuild, programVersionId);
  }
  return packageBuild;
}

async function createSucceededExportJob(
  packageBuild: LivePackageBuild,
  programVersionId: string,
): Promise<void> {
  await context.prisma.job.create({
    data: {
      kind: "live_export",
      status: "succeeded",
      snapshotSchemaVersion: 1,
      inputSnapshotJson: JSON.stringify({
        kind: "live_export",
        programId,
        programVersionId,
      }),
      resultJson: JSON.stringify({
        packagePath: packageBuild.packagePath,
        packageId: packageBuild.packageId,
        manifestSha256: packageBuild.manifestSha256,
        fileCount: 2,
        preparedCueCount: 1,
        warnings: [],
        failures: [],
      }),
      progressPercent: 100,
      finishedAt: new Date(MANIFEST_TIME),
    },
  });
}

function youtubeRequest(packageBuild: LivePackageBuild): CreateLiveRunRequest {
  return {
    programVersionId: versionId,
    packageBuild,
    source: {
      kind: "youtube",
      videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    },
    startAt: "2026-11-15T10:00:00.000Z",
    requestedPort: 3020,
  };
}

function controlStatus(
  overrides: Partial<LiveControlStatus> = {},
): LiveControlStatus {
  return {
    ok: true,
    runId: "run_1",
    ready: true,
    stageUrl: "http://127.0.0.1:3020/stage",
    consoleUrl: "http://127.0.0.1:3020/console",
    status: "ready",
    phase: "pre_show",
    showStarted: false,
    showEnded: false,
    startedAt: MANIFEST_TIME,
    failure: null,
    ...overrides,
  };
}

class FakeLauncher implements LiveRunLauncher {
  readonly calls: Parameters<LiveRunLauncher["launch"]>[0][] = [];
  async launch(input: Parameters<LiveRunLauncher["launch"]>[0]) {
    this.calls.push(input);
    return { pid: 4242 };
  }
}

class FakeControl implements LiveControlClient {
  statusValue: LiveControlStatus = controlStatus();
  stopCalls = 0;
  async status(): Promise<LiveControlStatus> {
    return this.statusValue;
  }
  async stop(): Promise<void> {
    this.stopCalls += 1;
  }
}

function fakeProcesses(alive: Set<number>) {
  const stops: number[] = [];
  const controller: LiveProcessController = {
    isAlive: (pid) => alive.has(pid),
    stop: async (pid) => {
      stops.push(pid);
      alive.delete(pid);
    },
  };
  return { controller, stops };
}

beforeAll(async () => {
  context = await createLiveTestContext("kakeai-live-runs-");
  const program = await context.prisma.liveProgram.create({
    data: { id: "program-1", title: "Run テスト", draftJson: "{}" },
  });
  programId = program.id;
  const version = await context.prisma.liveProgramVersion.create({
    data: {
      id: "program-version-1",
      programId: program.id,
      versionNumber: 1,
      schemaVersion: 1,
      documentJson: "{}",
      documentSha256: DOC_SHA,
      resolutionSnapshotJson: "{}",
      resolutionSnapshotSha256: SNAPSHOT_SHA,
    },
  });
  versionId = version.id;
}, 120_000);

afterAll(async () => {
  await context.close();
});

// Ports must not stay claimed between tests; each test creates its own Run.
afterEach(async () => {
  await context.prisma.liveRun.updateMany({ data: { status: "stopped" } });
});

describe("createLiveRun", () => {
  it("copies a fixture into the Run directory and fixes its hash", async () => {
    const packageDir = join(context.dataDir, "packages", "fixture");
    const packageBuild = await writePackage(packageDir);
    const sourceFile = join(context.dataDir, "source-fixture.json");
    const comments = [
      { atMs: 1000, author: "みかん", text: "こんにちは", kind: "normal" },
    ];
    const original = `${JSON.stringify(comments, null, 2)}\n`;
    await writeFile(sourceFile, original, "utf8");
    const packageManifestBefore = await readFile(join(packageDir, "manifest.json"));
    const versionBefore = await context.prisma.liveProgramVersion.findUniqueOrThrow({
      where: { id: versionId },
    });

    const run = await createLiveRun(
      { prisma: context.prisma, dataRoot: context.dataDir },
      {
        programVersionId: versionId,
        packageBuild,
        source: { kind: "fixture", fixturePath: sourceFile },
        startAt: null,
        requestedPort: 3021,
      },
    );

    const copied = await readFile(join(run.logDir, "fixtures", "comments.json"), "utf8");
    expect(copied).toBe(original);
    expect(await readFile(sourceFile, "utf8")).toBe(original);
    expect(await readFile(join(packageDir, "manifest.json"))).toEqual(
      packageManifestBefore,
    );
    const versionAfter = await context.prisma.liveProgramVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    expect(versionAfter.documentJson).toBe(versionBefore.documentJson);
    expect(versionAfter.documentSha256).toBe(versionBefore.documentSha256);
    expect(run.source).toEqual({
      kind: "fixture",
      fixtureFile: "fixtures/comments.json",
      fixtureSha256: createHash("sha256").update(copied).digest("hex"),
    });
    const stored = JSON.parse(
      (await context.prisma.liveRun.findUniqueOrThrow({ where: { id: run.id } }))
        .sourceJson,
    );
    expect(stored.fixtureSha256).toBe(run.source.kind === "fixture" ? run.source.fixtureSha256 : "");

    const launcher = new FakeLauncher();
    await launchLiveRun(
      {
        prisma: context.prisma,
        dataRoot: context.dataDir,
        launcher,
        controlClient: new FakeControl(),
        processController: fakeProcesses(new Set([4242])).controller,
      },
      run.id,
    );
    const runConfig = liveRunConfigSchema.parse(
      JSON.parse(await readFile(join(run.logDir, "run-config.json"), "utf8")),
    );
    expect(runConfig.source).toEqual({
      kind: "fixture",
      fixturePath: join(run.logDir, "fixtures", "comments.json"),
      fixtureSha256: run.source.kind === "fixture" ? run.source.fixtureSha256 : "",
    });
  });

  it("rejects a package build from a different Program Version", async () => {
    const packageDir = join(context.dataDir, "packages", "mismatch");
    const packageBuild = await writePackage(packageDir, {
      programVersionId: "program-version-other",
    });
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        youtubeRequest(packageBuild),
      ),
    ).rejects.toMatchObject({ code: "LIVE_RUN_PACKAGE_INVALID" });
  });

  it("rejects a v1 manifest build", async () => {
    const packageDir = join(context.dataDir, "packages", "legacy");
    const legacyManifest = {
      packageSchemaVersion: 1,
      exporterVersion: "0.1.0",
      packageId: "livepkg-legacy",
      createdAt: MANIFEST_TIME,
      source: {
        workId: "work-1",
        languageEditionId: "edition-1",
        scriptVersionId: "script-1",
        theme: { id: "neutral", version: 1 },
        profileSha256: "c".repeat(64),
      },
      cardSchemaVersion: 1,
      files: [],
      fonts: [],
      voices: [],
    };
    const manifestText = `${JSON.stringify(legacyManifest, null, 2)}\n`;
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, "show.json"), `${JSON.stringify(minimalShow(), null, 2)}\n`);
    await writeFile(join(packageDir, "manifest.json"), manifestText, "utf8");
    const packageBuild: LivePackageBuild = {
      packageId: "livepkg-legacy",
      manifestSha256: createHash("sha256").update(manifestText).digest("hex"),
      packagePath: packageDir,
    };
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        youtubeRequest(packageBuild),
      ),
    ).rejects.toMatchObject({ code: "LIVE_RUN_PACKAGE_INVALID" });
  });

  it("rejects a manifest hash that does not match manifest.json", async () => {
    const packageDir = join(context.dataDir, "packages", "hash");
    const packageBuild = await writePackage(packageDir);
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        youtubeRequest({ ...packageBuild, manifestSha256: "d".repeat(64) }),
      ),
    ).rejects.toMatchObject({ code: "LIVE_RUN_PACKAGE_INVALID" });
  });

  it("rejects a package directory that no succeeded export Job produced", async () => {
    const packageDir = join(context.dataDir, "packages", "hand-written");
    const packageBuild = await writePackage(packageDir, { withExportJob: false });
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        youtubeRequest(packageBuild),
      ),
    ).rejects.toMatchObject({ code: "LIVE_RUN_PACKAGE_INVALID" });
  });

  it("accepts a build older than many newer exports of the same version", async () => {
    const packageDir = join(context.dataDir, "packages", "old-build");
    const packageBuild = await writePackage(packageDir);
    const newer = Date.now() + 60_000;
    for (let index = 0; index < 60; index += 1) {
      await context.prisma.job.create({
        data: {
          kind: "live_export",
          status: "succeeded",
          snapshotSchemaVersion: 1,
          inputSnapshotJson: JSON.stringify({
            kind: "live_export",
            programId,
            programVersionId: versionId,
          }),
          // Contains the searched path as a prefix so this job is a candidate
          // that the old take: 50 query would have counted.
          resultJson: JSON.stringify({
            packagePath: `${packageDir}-noise-${index}`,
            packageId: "livepkg-noise",
            manifestSha256: "e".repeat(64),
            fileCount: 2,
            preparedCueCount: 1,
            warnings: [],
            failures: [],
          }),
          progressPercent: 100,
          createdAt: new Date(newer + index),
          finishedAt: new Date(newer + index),
        },
      });
    }
    const run = await createLiveRun(
      { prisma: context.prisma, dataRoot: context.dataDir },
      { ...youtubeRequest(packageBuild), requestedPort: 3031 },
    );
    expect(run.packageBuild.packageId).toBe(packageBuild.packageId);
  });

  it("rejects privileged ports and ports owned by a non-terminal Run", async () => {
    const packageDir = join(context.dataDir, "packages", "ports");
    const packageBuild = await writePackage(packageDir);
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        { ...youtubeRequest(packageBuild), requestedPort: 80 },
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        { ...youtubeRequest(packageBuild), requestedPort: 65_536 },
      ),
    ).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });

    const request = { ...youtubeRequest(packageBuild), requestedPort: 3025 };
    await createLiveRun({ prisma: context.prisma, dataRoot: context.dataDir }, request);
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        { ...request, packageBuild },
      ),
    ).rejects.toMatchObject({ status: 409, code: "INVALID_STATE" });
  });

  it("rejects a fixture path that is not a regular file", async () => {
    const packageDir = join(context.dataDir, "packages", "fixture-kind");
    const packageBuild = await writePackage(packageDir);
    const sourceDir = join(context.dataDir, "fixture-directory");
    await mkdir(sourceDir, { recursive: true });
    await expect(
      createLiveRun(
        { prisma: context.prisma, dataRoot: context.dataDir },
        {
          ...youtubeRequest(packageBuild),
          source: { kind: "fixture", fixturePath: sourceDir },
        },
      ),
    ).rejects.toMatchObject({ status: 422, code: "LIVE_RUN_FIXTURE_INVALID" });
  });

  it("follows a fixture symlink to a regular file", async () => {
    const packageDir = join(context.dataDir, "packages", "fixture-symlink");
    const packageBuild = await writePackage(packageDir);
    const sourceFile = join(context.dataDir, "fixture-target.json");
    const comments = [
      { atMs: 1000, author: "みかん", text: "こんにちは", kind: "normal" },
    ];
    await writeFile(sourceFile, `${JSON.stringify(comments, null, 2)}\n`, "utf8");
    const linkPath = join(context.dataDir, "fixture-link.json");
    await symlink(sourceFile, linkPath);
    const run = await createLiveRun(
      { prisma: context.prisma, dataRoot: context.dataDir },
      {
        ...youtubeRequest(packageBuild),
        requestedPort: 3030,
        source: { kind: "fixture", fixturePath: linkPath },
      },
    );
    const copied = await readFile(join(run.logDir, "fixtures", "comments.json"), "utf8");
    expect(JSON.parse(copied)).toEqual(comments);
  });
});

describe("launch and reconnect", () => {
  it("writes a 0600 control token and launches detached without secrets", async () => {
    const packageDir = join(context.dataDir, "packages", "launch");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const control = new FakeControl();
    const alive = new Set<number>();
    const processes = fakeProcesses(alive);
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: control,
      processController: processes.controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    const launched = await launchLiveRun(deps, run.id);
    expect(launched.status).toBe("launching");
    expect(launched.control.pid).toBe(4242);
    alive.add(4242);

    const row = await context.prisma.liveRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(row.controlTokenRef).not.toBeNull();
    const token = (await readFile(row.controlTokenRef!, "utf8")).trim();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect((await stat(row.controlTokenRef!)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(launched)).not.toContain(token);

    expect(launcher.calls).toHaveLength(1);
    expect(launcher.calls[0]).toMatchObject({
      runId: run.id,
      packagePath: packageDir,
      runDir: run.logDir,
      port: 3020,
      controlTokenFile: row.controlTokenRef,
      runConfigPath: join(run.logDir, "run-config.json"),
    });
    const runConfig = liveRunConfigSchema.parse(
      JSON.parse(await readFile(join(run.logDir, "run-config.json"), "utf8")),
    );
    expect(runConfig.source).toEqual({
      kind: "youtube",
      videoUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      liveChatId: null,
    });
    expect(JSON.stringify(runConfig)).not.toMatch(
      /apiKey|clientSecret|llm|tts|controlToken|token/i,
    );

    const connected = await getLiveRun(deps, run.id);
    expect(connected.status).toBe("running");
    expect(connected.state).toEqual({
      ready: true,
      showStarted: false,
      showEnded: false,
      phase: "pre_show",
    });
    expect(launcher.calls).toHaveLength(1);
  });

  it("keeps a newly launched run in launching while control is not up yet", async () => {
    const packageDir = join(context.dataDir, "packages", "starting");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const alive = new Set<number>([4242]);
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: {
        status: async () => {
          throw new Error("not listening yet");
        },
        stop: async () => undefined,
      } satisfies LiveControlClient,
      processController: fakeProcesses(alive).controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    await launchLiveRun(deps, run.id);
    const stillLaunching = await getLiveRun(deps, run.id);
    expect(stillLaunching.status).toBe("launching");
    expect(stillLaunching.failure).toBeNull();
    expect(launcher.calls).toHaveLength(1);
  });

  it("does not treat a launching run without a stored PID as exited during launch grace", async () => {
    const packageDir = join(context.dataDir, "packages", "pid-race");
    const packageBuild = await writePackage(packageDir);
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher: new FakeLauncher(),
      controlClient: new FakeControl(),
      processController: fakeProcesses(new Set<number>()).controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    await context.prisma.liveRun.update({
      where: { id: run.id },
      data: {
        status: "launching",
        controlUrl: "http://127.0.0.1:3020",
        controlTokenRef: join(run.logDir, "control-token"),
        launchedAt: new Date(),
      },
    });
    const reconnected = await getLiveRun(deps, run.id);
    expect(reconnected.status).toBe("launching");
    expect(reconnected.failure).toBeNull();
  });

  it("rejects a launch when another non-terminal Run owns the port", async () => {
    const packageDir = join(context.dataDir, "packages", "launch-port");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: new FakeControl(),
      processController: fakeProcesses(new Set<number>()).controller,
    };
    await createLiveRun(deps, {
      ...youtubeRequest(packageBuild),
      requestedPort: 3026,
    });
    const second = await createLiveRun(deps, {
      ...youtubeRequest(packageBuild),
      requestedPort: 3027,
    });
    await context.prisma.liveRun.update({
      where: { id: second.id },
      data: { requestedPort: 3026 },
    });
    await expect(launchLiveRun(deps, second.id)).rejects.toMatchObject({
      status: 409,
      code: "INVALID_STATE",
    });
    expect(launcher.calls).toHaveLength(0);
  });

  it("records a failed stop when control fails and there is no PID", async () => {
    const packageDir = join(context.dataDir, "packages", "stop-control-failure");
    const packageBuild = await writePackage(packageDir);
    const controlClient: LiveControlClient = {
      status: async () => controlStatus(),
      stop: async () => {
        throw new Error("connection refused");
      },
    };
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher: new FakeLauncher(),
      controlClient,
      processController: fakeProcesses(new Set<number>()).controller,
    };
    const run = await createLiveRun(deps, {
      ...youtubeRequest(packageBuild),
      requestedPort: 3028,
    });
    await context.prisma.liveRun.update({
      where: { id: run.id },
      data: {
        status: "launching",
        controlUrl: "http://127.0.0.1:3028",
        controlTokenRef: join(run.logDir, "control-token"),
        launchedAt: new Date(),
      },
    });

    const stopped = await stopLiveRun(deps, run.id);
    expect(stopped.status).toBe("failed");
    expect(stopped.failure?.code).toBe("stop_failed");
    expect(stopped.failure?.message).toMatch(/connection refused/);
  });

  it("terminates the spawned process when persisting the PID fails", async () => {
    const packageDir = join(context.dataDir, "packages", "pid-save");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const alive = new Set<number>([4242]);
    const processes = fakeProcesses(alive);
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: new FakeControl(),
      processController: processes.controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    const updateSpy = vi
      .spyOn(context.prisma.liveRun, "update")
      .mockRejectedValueOnce(new Error("db down"));
    try {
      await expect(launchLiveRun(deps, run.id)).rejects.toMatchObject({
        code: "LIVE_RUN_LAUNCH_FAILED",
      });
    } finally {
      updateSpy.mockRestore();
    }
    expect(processes.stops).toEqual([4242]);
    const row = await context.prisma.liveRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(row.status).toBe("failed");
  });

  it("marks a dead process as failed without relaunching", async () => {
    const packageDir = join(context.dataDir, "packages", "dead");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const control = new FakeControl();
    const alive = new Set<number>();
    const processes = fakeProcesses(alive);
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: control,
      processController: processes.controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    await launchLiveRun(deps, run.id);
    const failed = await getLiveRun(deps, run.id);
    expect(failed.status).toBe("failed");
    expect(failed.failure?.code).toBe("process_exited");
    expect(failed.endedAt).not.toBeNull();
    expect(launcher.calls).toHaveLength(1);
  });

  it("rejects a second launch", async () => {
    const packageDir = join(context.dataDir, "packages", "double");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: new FakeControl(),
      processController: fakeProcesses(new Set([4242])).controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    await launchLiveRun(deps, run.id);
    await expect(launchLiveRun(deps, run.id)).rejects.toMatchObject({
      code: "LIVE_RUN_ALREADY_LAUNCHED",
    });
    expect(launcher.calls).toHaveLength(1);
  });

  it("stops through the control endpoint and records endedAt", async () => {
    const packageDir = join(context.dataDir, "packages", "stop");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const control = new FakeControl();
    const alive = new Set<number>();
    const processes = fakeProcesses(alive);
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: control,
      processController: processes.controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    await launchLiveRun(deps, run.id);
    alive.add(4242);
    const stopped = await stopLiveRun(deps, run.id);
    expect(control.stopCalls).toBe(1);
    expect(processes.stops).toEqual([4242]);
    expect(stopped.status).toBe("stopped");
    expect(stopped.endedAt).not.toBeNull();
    expect(launcher.calls).toHaveLength(1);
  });

  it("lists runs with reconciled state", async () => {
    const packageDir = join(context.dataDir, "packages", "list");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const control = new FakeControl();
    const alive = new Set([4242]);
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: control,
      processController: fakeProcesses(alive).controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    await launchLiveRun(deps, run.id);
    const list = await listLiveRuns(deps, 50, 0);
    const item = list.items.find((entry) => entry.id === run.id);
    expect(item?.status).toBe("running");
    expect(item?.stageUrl).toBe("http://127.0.0.1:3020/stage");
  });

  it("keeps the list when one reconciliation fails", async () => {
    const packageDir = join(context.dataDir, "packages", "list-failure");
    const packageBuild = await writePackage(packageDir);
    const launcher = new FakeLauncher();
    const deps = {
      prisma: context.prisma,
      dataRoot: context.dataDir,
      launcher,
      controlClient: new FakeControl(),
      processController: fakeProcesses(new Set<number>()).controller,
    };
    const run = await createLiveRun(deps, youtubeRequest(packageBuild));
    await launchLiveRun(deps, run.id);
    const updateSpy = vi
      .spyOn(context.prisma.liveRun, "update")
      .mockRejectedValueOnce(new Error("db down"));
    let list;
    try {
      list = await listLiveRuns(deps, 50, 0);
    } finally {
      updateSpy.mockRestore();
    }
    expect(list.items.find((entry) => entry.id === run.id)?.status).toBe(
      "launching",
    );
  });
});
