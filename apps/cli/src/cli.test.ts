import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentClientError } from "@kakeai/agent-client";
import {
  AGENT_ERROR_CODES,
  agentOperationCatalog,
  buildAgentSchemaGetResult,
  type AgentOperationName,
} from "@kakeai/contracts";
import { parseCliArgs, readPackageVersion, DEFAULT_AGENT_ID } from "./config.ts";
import { CliError } from "./errors.ts";
import { resolveCliCommand, subcommandNames } from "./commands.ts";
import { runCli, type CliIo, type CliRequester } from "./run.ts";
import {
  fixtureAsset,
  fixtureRenderJob,
  fixtureTtsJob,
  fixtureWork,
} from "@kakeai/contracts/testing/agent-fixtures";

type Handler = (operation: AgentOperationName, input: unknown) => unknown;

function fakeRequester(handler: Handler): CliRequester {
  return {
    request: ((operation: string, input: unknown) =>
      Promise.resolve().then(() =>
        handler(operation as AgentOperationName, input),
      )) as unknown as CliRequester["request"],
  };
}

interface Captured {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
}

function capture(
  handler: Handler,
  extra: Partial<Pick<CliIo, "env" | "cwd" | "readStdin" | "now" | "sleep">> = {},
): Captured {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      request: fakeRequester(handler),
      ...extra,
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

function stderrPayload(text: string): { code: string; issues?: unknown[] } {
  expect(text.trim().split("\n")).toHaveLength(1);
  return JSON.parse(text) as { code: string; issues?: unknown[] };
}

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop()!, { recursive: true, force: true });
  }
});

describe("CLI argument parsing", () => {
  it("resolves every catalog operation name exactly, plus job.wait", () => {
    for (const descriptor of agentOperationCatalog) {
      expect(parseCliArgs([descriptor.name], {})).toEqual({
        kind: "run",
        command: {
          kind: "operation",
          operation: descriptor.name,
          longRunning: descriptor.longRunning,
        },
        options: { pretty: false, wait: false, agentId: DEFAULT_AGENT_ID },
      });
    }
    expect(parseCliArgs(["job.wait", "job-1"], {})).toEqual({
      kind: "run",
      command: { kind: "jobWait" },
      options: {
        pretty: false,
        wait: false,
        agentId: DEFAULT_AGENT_ID,
        jobId: "job-1",
      },
    });
  });

  it("does not register deletion or removal subcommands", () => {
    expect(resolveCliCommand("work.delete")).toBeUndefined();
    expect(resolveCliCommand("asset.delete")).toBeUndefined();
    expect(resolveCliCommand("composition.delete")).toBeUndefined();
    expect(subcommandNames()).toEqual(
      expect.arrayContaining(["tts.create", "tts.createBulk", "job.wait"]),
    );
    for (const name of subcommandNames()) {
      expect(name).not.toMatch(/(delete|remove|destroy|purge|external)/u);
    }
  });

  it("rejects unknown subcommands and extra arguments as usage errors", () => {
    for (const argv of [
      ["work.delete"],
      ["nope"],
      ["schema.get", "extra"],
      ["job.wait", "a", "b"],
      ["operations", "extra"],
    ]) {
      try {
        parseCliArgs(argv, {});
        throw new Error(`expected usage error for ${argv.join(" ")}`);
      } catch (error) {
        expect(error).toBeInstanceOf(CliError);
        expect((error as CliError).code).toBe("CLI_USAGE_ERROR");
        expect((error as CliError).exitCode).toBe(2);
      }
    }
  });

  it("accepts global options before or after the subcommand and prefers arguments over env", () => {
    const env = {
      KAKEAI_AGENT_ID: "env-agent",
      KAKEAI_SOCKET: "/tmp/env.sock",
      KAKEAI_DATA_DIR: "/data/env",
    };
    expect(
      parseCliArgs(
        [
          "--pretty",
          "work.create",
          "--input=-",
          "--agent-id",
          "arg-agent",
          "--socket=/tmp/arg.sock",
          "--data-dir",
          "/data/arg",
          "--timeout",
          "5000",
        ],
        env,
      ),
    ).toEqual({
      kind: "run",
      command: {
        kind: "operation",
        operation: "work.create",
        longRunning: false,
      },
      options: {
        pretty: true,
        wait: false,
        agentId: "arg-agent",
        input: "-",
        socketPath: "/tmp/arg.sock",
        dataRoot: "/data/arg",
        timeoutMs: 5000,
      },
    });
    expect(parseCliArgs(["schema.get"], env)).toMatchObject({
      options: { agentId: "env-agent", socketPath: "/tmp/env.sock", dataRoot: "/data/env" },
    });
  });

  it("restricts --wait and the polling options to Job-returning commands", () => {
    expect(() => parseCliArgs(["schema.get", "--wait"], {})).toThrow(CliError);
    expect(() => parseCliArgs(["work.create", "--wait"], {})).toThrow(CliError);
    expect(() => parseCliArgs(["schema.get", "--timeout-ms", "10"], {})).toThrow(CliError);
    expect(parseCliArgs(["render.start", "--wait"], {})).toMatchObject({ options: { wait: true } });
    expect(parseCliArgs(["tts.create", "--wait"], {})).toMatchObject({ options: { wait: true } });
    expect(parseCliArgs(["tts.createBulk", "--wait"], {})).toMatchObject({
      options: { wait: true },
    });
    expect(
      parseCliArgs(["asset.import", "--wait", "--timeout-ms", "20", "--interval-ms", "10"], {}),
    ).toMatchObject({ options: { wait: true, waitTimeoutMs: 20, waitIntervalMs: 10 } });
  });

  it("validates numeric and unknown options", () => {
    expect(() => parseCliArgs(["--timeout", "0", "schema.get"], {})).toThrow(CliError);
    expect(() => parseCliArgs(["--timeout", "abc", "schema.get"], {})).toThrow(CliError);
    expect(() => parseCliArgs(["--nope", "schema.get"], {})).toThrow(CliError);
    expect(() => parseCliArgs(["--input=", "schema.get"], {})).toThrow(CliError);
  });

  it("handles help and version without a subcommand", () => {
    expect(parseCliArgs([], {})).toEqual({ kind: "help" });
    expect(parseCliArgs(["--help"], {})).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"], {})).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"], {})).toEqual({ kind: "version" });
    expect(parseCliArgs(["-V"], {})).toEqual({ kind: "version" });
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/u);
  });
});

describe("CLI invocation", () => {
  it("prints deterministic JSON to stdout on success", async () => {
    const captured = capture((operation) => {
      expect(operation).toBe("schema.get");
      return buildAgentSchemaGetResult();
    });
    const exitCode = await runCli(["schema.get"], captured.io);
    expect(exitCode).toBe(0);
    expect(captured.stderr()).toBe("");
    expect(captured.stdout()).toBe(`${JSON.stringify(buildAgentSchemaGetResult())}\n`);
  });

  it("reads inline JSON, a file and stdin", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kakeai-cli-input-"));
    dirs.push(dir);
    const file = join(dir, "input.json");
    await writeFile(file, JSON.stringify({ title: "ファイルから" }), "utf8");

    const inputs: unknown[] = [];
    const handler = (operation: AgentOperationName, input: unknown): unknown => {
      expect(operation).toBe("work.create");
      inputs.push(input);
      return { work: fixtureWork() };
    };

    const inline = capture(handler);
    expect(
      await runCli(["work.create", "--input", '{"title":"インライン"}'], inline.io),
    ).toBe(0);
    expect(inputs.at(-1)).toEqual({ title: "インライン" });

    const fromFile = capture(handler);
    expect(await runCli(["work.create", "--input", file], fromFile.io)).toBe(0);
    expect(inputs.at(-1)).toEqual({ title: "ファイルから" });

    const fromStdin = capture(handler, { readStdin: async () => '{"title":"標準入力"}' });
    expect(await runCli(["work.create", "--input", "-"], fromStdin.io)).toBe(0);
    expect(inputs.at(-1)).toEqual({ title: "標準入力" });

    for (const captured of [inline, fromFile, fromStdin]) {
      expect(captured.stderr()).toBe("");
      expect(JSON.parse(captured.stdout())).toEqual({ work: fixtureWork() });
    }
  });

  it("forwards asset.list filters and prints the page contract", async () => {
    const filters = {
      kind: "image",
      status: "ready",
      filename: "bgm",
      tags: ["intro", "bgm"],
      tagMode: "or",
      favorite: true,
      archived: "include",
      limit: 1,
    };
    let received: unknown;
    const captured = capture((operation, input) => {
      expect(operation).toBe("asset.list");
      received = input;
      return { assets: [fixtureAsset()], nextCursor: "cursor-2" };
    });
    expect(
      await runCli(["asset.list", "--input", JSON.stringify(filters)], captured.io),
    ).toBe(0);
    expect(received).toEqual(filters);
    expect(captured.stderr()).toBe("");
    expect(JSON.parse(captured.stdout())).toEqual({
      assets: [fixtureAsset()],
      nextCursor: "cursor-2",
    });
  });

  it("forwards tts.create and tts.createBulk and waits on a single tts Job", async () => {
    const received: Array<{ operation: AgentOperationName; input: unknown }> = [];
    const handler = (operation: AgentOperationName, input: unknown): unknown => {
      received.push({ operation, input });
      switch (operation) {
        case "tts.create":
          return { job: fixtureTtsJob("queued") };
        case "tts.createBulk":
          return {
            jobs: [{ narrationSegmentId: "line-p1-1", job: fixtureTtsJob("queued", "job-bulk-1") }],
            excluded: [
              {
                narrationSegmentId: "line-p1-2",
                code: "TTS_INPUT_INVALID",
                message: "声が未設定です。",
              },
            ],
          };
        case "job.get":
          return { job: fixtureTtsJob("succeeded") };
        default:
          throw new Error(`unexpected operation: ${operation}`);
      }
    };

    const created = capture(handler);
    expect(
      await runCli(
        [
          "tts.create",
          "--input",
          '{"scriptVersionId":"scr-1","narrationSegmentId":"line-p1-1","speedScale":1.25}',
        ],
        created.io,
      ),
    ).toBe(0);
    expect(received[0]).toEqual({
      operation: "tts.create",
      input: { scriptVersionId: "scr-1", narrationSegmentId: "line-p1-1", speedScale: 1.25 },
    });
    expect(JSON.parse(created.stdout())).toMatchObject({ job: { kind: "tts", status: "queued" } });

    const bulk = capture(handler);
    expect(
      await runCli(["tts.createBulk", "--input", '{"scriptVersionId":"scr-1"}'], bulk.io),
    ).toBe(0);
    expect(JSON.parse(bulk.stdout())).toMatchObject({
      jobs: [{ narrationSegmentId: "line-p1-1" }],
      excluded: [{ narrationSegmentId: "line-p1-2", code: "TTS_INPUT_INVALID" }],
    });

    // Bulk enqueues several Jobs, so --wait has no single Job to poll.
    const bulkWaited = capture(handler, { now: () => 0, sleep: async () => undefined });
    expect(
      await runCli(
        [
          "tts.createBulk",
          "--input",
          '{"scriptVersionId":"scr-1"}',
          "--wait",
          "--timeout-ms",
          "100",
        ],
        bulkWaited.io,
      ),
    ).toBe(0);
    const bulkPayload = JSON.parse(bulkWaited.stdout()) as {
      result: { jobs: unknown[] };
      wait: unknown;
    };
    expect(bulkPayload.result.jobs).toHaveLength(1);
    expect(bulkPayload.wait).toBeNull();

    const waited = capture(handler, { now: () => 0, sleep: async () => undefined });
    expect(
      await runCli(
        [
          "tts.create",
          "--input",
          '{"scriptVersionId":"scr-1","narrationSegmentId":"line-p1-1"}',
          "--wait",
          "--timeout-ms",
          "100",
        ],
        waited.io,
      ),
    ).toBe(0);
    const payload = JSON.parse(waited.stdout()) as {
      result: { job: { id: string } };
      wait: { job: { status: string; ttsResult: { assetId: string } | null } };
    };
    expect(payload.result.job.id).toBe("job-tts-1");
    expect(payload.wait.job.status).toBe("succeeded");
    expect(payload.wait.job.ttsResult?.assetId).toBe("asset-tts-1");
  });

  it("rejects invalid inputs before sending anything", async () => {
    let calls = 0;
    const handler: Handler = () => {
      calls += 1;
      return { work: fixtureWork() };
    };

    const missingField = capture(handler);
    expect(await runCli(["work.create"], missingField.io)).toBe(1);
    expect(calls).toBe(0);
    expect(missingField.stdout()).toBe("");
    const validation = stderrPayload(missingField.stderr());
    expect(validation.code).toBe("VALIDATION_ERROR");
    expect(validation.issues?.length).toBeGreaterThan(0);

    const unknownField = capture(handler);
    expect(
      await runCli(["work.create", "--input", '{"title":"x","extra":true}'], unknownField.io),
    ).toBe(1);
    expect(stderrPayload(unknownField.stderr()).code).toBe("VALIDATION_ERROR");

    const invalidJson = capture(handler);
    expect(await runCli(["work.create", "--input", "{oops"], invalidJson.io)).toBe(2);
    expect(stderrPayload(invalidJson.stderr()).code).toBe("CLI_INPUT_ERROR");

    const missingFile = capture(handler);
    expect(
      await runCli(["work.create", "--input", join(tmpdir(), "no-such-input.json")], missingFile.io),
    ).toBe(2);
    expect(stderrPayload(missingFile.stderr()).code).toBe("CLI_INPUT_ERROR");
    expect(calls).toBe(0);
  });

  it("reports usage errors without a stack trace", async () => {
    const captured = capture(() => {
      throw new Error("must not be called");
    });
    expect(await runCli(["work.delete", "--input", "{}"], captured.io)).toBe(2);
    expect(captured.stdout()).toBe("");
    expect(stderrPayload(captured.stderr()).code).toBe("CLI_USAGE_ERROR");
    expect(captured.stderr()).not.toContain("at ");
  });

  it("maps client failures to stable codes and exit code 1", async () => {
    const captured = capture(() => {
      throw new AgentClientError(AGENT_ERROR_CODES.APP_UNAVAILABLE);
    });
    expect(await runCli(["work.list"], captured.io)).toBe(1);
    expect(captured.stdout()).toBe("");
    expect(stderrPayload(captured.stderr()).code).toBe("AGENT_APP_UNAVAILABLE");
  });

  it("does not leak unexpected errors", async () => {
    const captured = capture(() => {
      throw new Error("secret detail");
    });
    expect(await runCli(["work.list"], captured.io)).toBe(1);
    expect(stderrPayload(captured.stderr()).code).toBe("CLI_INTERNAL_ERROR");
    expect(captured.stderr()).not.toContain("secret detail");
  });

  it("prints help grouped by kind and the operation catalog", async () => {
    const help = capture(() => {
      throw new Error("must not be called");
    });
    expect(await runCli(["--help"], help.io)).toBe(0);
    expect(help.stderr()).toBe("");
    const text = help.stdout();
    expect(text).toContain("読み取り");
    expect(text).toContain("変更");
    for (const name of agentOperationCatalog.map((entry) => entry.name)) {
      expect(text).toContain(name);
    }
    expect(text).toContain("job.wait");

    const version = capture(() => {
      throw new Error("must not be called");
    });
    expect(await runCli(["--version"], version.io)).toBe(0);
    expect(version.stdout().trim()).toMatch(/^\d+\.\d+\.\d+/u);

    const operations = capture(() => {
      throw new Error("must not be called");
    });
    expect(await runCli(["operations"], operations.io)).toBe(0);
    expect(JSON.parse(operations.stdout())).toEqual({ operations: agentOperationCatalog });
  });

  it("pretty prints JSON", async () => {
    const captured = capture(() => ({ work: fixtureWork() }));
    expect(await runCli(["work.get", "--input", '{"workId":"work-1"}', "--pretty"], captured.io)).toBe(0);
    const text = captured.stdout();
    expect(text).toContain("\n  \"work\": {");
    expect(JSON.parse(text)).toEqual({ work: fixtureWork() });
  });

  it("waits for a Job and reports a budget expiry as a successful result", async () => {
    let clock = 0;
    const polled: string[] = [];
    const captured = capture(
      (operation, input) => {
        if (operation === "job.get") {
          polled.push((input as { jobId: string }).jobId);
          return { job: fixtureRenderJob(clock >= 20 ? "succeeded" : "running") };
        }
        throw new Error(`unexpected operation: ${operation}`);
      },
      {
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );

    expect(
      await runCli(["job.wait", "job-render-1", "--timeout-ms", "20", "--interval-ms", "10"], captured.io),
    ).toBe(0);
    const result = JSON.parse(captured.stdout()) as {
      timedOut: boolean;
      polls: number;
      job: { status: string };
    };
    expect(result.timedOut).toBe(false);
    expect(result.job.status).toBe("succeeded");
    expect(result.polls).toBe(3);
    expect(polled).toEqual(["job-render-1", "job-render-1", "job-render-1"]);

    const timedOut = capture(
      () => ({ job: fixtureRenderJob("queued") }),
      {
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      },
    );
    expect(await runCli(["job.wait", "job-render-1", "--timeout-ms", "0"], timedOut.io)).toBe(0);
    const expired = JSON.parse(timedOut.stdout()) as { timedOut: boolean; polls: number };
    expect(expired.timedOut).toBe(true);
    expect(expired.polls).toBe(1);
  });

  it("accepts job.wait input from JSON and validates the merged request", async () => {
    const captured = capture(() => ({ job: fixtureRenderJob("succeeded") }));
    expect(
      await runCli(["job.wait", "--input", '{"jobId":"job-render-1"}'], captured.io),
    ).toBe(0);
    expect(JSON.parse(captured.stdout())).toMatchObject({ job: { id: "job-render-1" } });

    const missing = capture(() => {
      throw new Error("must not be called");
    });
    expect(await runCli(["job.wait"], missing.io)).toBe(1);
    expect(stderrPayload(missing.stderr()).code).toBe("VALIDATION_ERROR");
  });

  it("--wait wraps the operation result with the job wait", async () => {
    const captured = capture(
      (operation) => {
        if (operation === "render.start") {
          return { job: fixtureRenderJob("queued", "job-render-1") };
        }
        if (operation === "job.get") {
          return { job: fixtureRenderJob("succeeded", "job-render-1") };
        }
        throw new Error(`unexpected operation: ${operation}`);
      },
      { now: () => 0, sleep: async () => undefined },
    );
    expect(
      await runCli(
        ["render.start", "--input", '{"scriptVersionId":"scr-2"}', "--wait", "--timeout-ms", "100"],
        captured.io,
      ),
    ).toBe(0);
    const payload = JSON.parse(captured.stdout()) as {
      result: { job: { id: string } };
      wait: { job: { status: string }; timedOut: boolean };
    };
    expect(payload.result.job.id).toBe("job-render-1");
    expect(payload.wait.job.status).toBe("succeeded");
    expect(payload.wait.timedOut).toBe(false);

    const deduplicated = capture(() => ({
      asset: {
        id: "asset-1",
        kind: "image",
        origin: "generated",
        status: "ready",
        originalFilename: "a.png",
        mediaType: "image/png",
        byteSize: 1,
        sha256: "sha",
        durationMs: null,
        widthPx: 1,
        heightPx: 1,
        hasAudio: false,
        tags: [],
        favoritedAt: null,
        archivedAt: null,
        createdAt: "2026-10-21T00:00:00.000Z",
        contentUrl: "/assets/asset-1/content",
      },
      jobId: null,
      deduplicated: true,
    }));
    expect(
      await runCli(
        ["asset.import", "--input", '{"path":"/tmp/a.png"}', "--wait"],
        deduplicated.io,
      ),
    ).toBe(0);
    expect(JSON.parse(deduplicated.stdout())).toMatchObject({ result: { jobId: null }, wait: null });
  });
});
