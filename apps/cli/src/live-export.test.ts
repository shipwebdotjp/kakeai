import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLiveExport } from "./live-export";

const NOW = "2026-11-07T12:00:00.000Z";
const HASH = "a".repeat(64);

function baseJob(status: "queued" | "succeeded" | "failed") {
  return {
    id: "job-1",
    kind: "live_export" as const,
    status,
    workId: null,
    assetId: null,
    languageEditionId: null,
    scriptVersionId: null,
    programId: "program-1",
    programVersionId: "program-version-1",
    progressPercent: status === "succeeded" ? 100 : 0,
    createdAt: NOW,
    startedAt: status === "queued" ? null : NOW,
    finishedAt: status === "queued" ? null : NOW,
    error: status === "failed" ? { code: "LIVE_EXPORT_TTS_FAILED", message: "TTS failed" } : null,
    ttsResult: null,
    liveExportResult:
      status === "queued"
        ? null
        : {
            packagePath: status === "succeeded" ? "/tmp/package" : null,
            packageId: status === "succeeded" ? "livepkg-test" : null,
            manifestSha256: status === "succeeded" ? HASH : null,
            fileCount: status === "succeeded" ? 3 : null,
            preparedCueCount: status === "succeeded" ? 2 : null,
            warnings: [],
            failures:
              status === "failed"
                ? [{ stage: "tts", id: "cue-1", message: "TTS failed" }]
                : [],
          },
    artifacts: [],
  };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kakeai-live-cli-"));
  await writeFile(
    join(dir, "comments.json"),
    JSON.stringify([{ atMs: 0, author: "A", text: "こんにちは" }]),
    "utf8",
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("live:export CLI", () => {
  it("posts the program version and fixture, then polls to success", async () => {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    const origins: (string | undefined)[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      origins.push((init?.headers as Record<string, string> | undefined)?.origin);
      if (url.endsWith("/api/v1/live-exports")) {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ data: baseJob("queued") }), { status: 202 });
      }
      return new Response(JSON.stringify({ data: baseJob("succeeded") }), { status: 200 });
    }) as typeof fetch;

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runLiveExport(
      [
        "--program-version",
        "program-version-1",
        "--fixture",
        "comments.json",
        "--out",
        "program-package",
      ],
      { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
      {
        cwd: dir,
        env: { KAKEAI_API_URL: "http://test.local" },
        fetchImpl,
        sleep: async () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(stderr.join("")).toBe("");
    expect(JSON.parse(stdout.join("")).packagePath).toBe("/tmp/package");
    expect(calls).toEqual([
      "http://test.local/api/v1/live-exports",
      "http://test.local/api/v1/jobs/job-1",
    ]);
    expect(origins[0]).toBe("http://test.local");
    const body = bodies[0] as {
      programVersionId: string;
      outDir: string;
      workId?: unknown;
      scriptVersionId?: unknown;
      profile?: unknown;
      fixture: unknown[];
    };
    expect(body.programVersionId).toBe("program-version-1");
    expect(body.outDir).toBe(join(dir, "program-package"));
    expect(body.fixture).toHaveLength(1);
    expect(body.workId).toBeUndefined();
    expect(body.scriptVersionId).toBeUndefined();
    expect(body.profile).toBeUndefined();
  });

  it.each<[string, string?]>([
    ["--work", "work-1"],
    ["--script-version", "script-1"],
    ["--profile", "show.json"],
    ["--auto-profile"],
    ["--save-profile", "profile.json"],
    ["--title", "タイトル"],
    ["--no-comments"],
    ["--dry-run"],
    ["--force"],
  ])("rejects the removed %s option", async (flag, value) => {
    const fetchImpl = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const stderr: string[] = [];
    const args = ["--program-version", "program-version-1", "--out", "package", flag];
    if (value !== undefined) {
      args.push(value);
    }
    const code = await runLiveExport(
      args,
      { stdout: () => undefined, stderr: (text) => stderr.push(text) },
      {
        cwd: dir,
        env: { KAKEAI_API_URL: "http://test.local" },
        fetchImpl,
        sleep: async () => undefined,
      },
    );

    expect(code).toBe(2);
    expect(JSON.parse(stderr.join("")).code).toBe("LIVE_EXPORT_CLI_USAGE");
  });

  it("requires --program-version", async () => {
    const stderr: string[] = [];
    const code = await runLiveExport(
      ["--out", "package"],
      { stdout: () => undefined, stderr: (text) => stderr.push(text) },
      {
        cwd: dir,
        env: { KAKEAI_API_URL: "http://test.local" },
        fetchImpl: (async () => {
          throw new Error("fetch should not be called");
        }) as typeof fetch,
        sleep: async () => undefined,
      },
    );

    expect(code).toBe(2);
    expect(JSON.parse(stderr.join("")).code).toBe("LIVE_EXPORT_CLI_USAGE");
  });

  it("reports a failed job and exits 1", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/v1/live-exports")) {
        return new Response(JSON.stringify({ data: baseJob("queued") }), { status: 202 });
      }
      return new Response(JSON.stringify({ data: baseJob("failed") }), { status: 200 });
    }) as typeof fetch;

    const stderr: string[] = [];
    const code = await runLiveExport(
      ["--program-version", "program-version-1", "--out", "package"],
      { stdout: () => undefined, stderr: (text) => stderr.push(text) },
      {
        cwd: dir,
        env: { KAKEAI_API_URL: "http://test.local" },
        fetchImpl,
        sleep: async () => undefined,
      },
    );

    expect(code).toBe(1);
    const error = JSON.parse(stderr.join(""));
    expect(error.status).toBe("failed");
    expect(error.failures[0].stage).toBe("tts");
  });

  it("shows help without calling the API", async () => {
    const stdout: string[] = [];
    const code = await runLiveExport(
      ["--help"],
      { stdout: (text) => stdout.push(text), stderr: () => undefined },
      {
        fetchImpl: (async () => {
          throw new Error("fetch should not be called");
        }) as typeof fetch,
      },
    );

    expect(code).toBe(0);
    expect(stdout.join("")).toContain("--program-version");
    expect(stdout.join("")).not.toContain("--profile");
  });
});
