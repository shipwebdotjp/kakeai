import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveShowProfileSchema } from "@kakeai/contracts";
import { runLiveExport } from "./live-export";

const NOW = "2026-11-07T12:00:00.000Z";
const HASH = "a".repeat(64);

function baseJob(status: "queued" | "succeeded" | "failed") {
  return {
    id: "job-1",
    kind: "live_export" as const,
    status,
    workId: "work-1",
    assetId: null,
    languageEditionId: "edition-1",
    scriptVersionId: "script-1",
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

function profile(fixture = "comments.json") {
  return {
    schemaVersion: 1,
    show: {
      title: "テスト",
      locale: "ja-JP",
      targetDurationMs: 600_000,
      stageTemplate: "news-desk",
      theme: "theme.css",
      characters: { left: "char-left", right: null },
      startAt: null,
    },
    commentSource: { kind: "fixture" },
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
    scriptCues: [{ id: "cue-script", lineId: "line-1" }],
    liveCues: [
      {
        id: "cue-opening",
        speaker: "left",
        caption: "始まります。",
        speech: "はじまります。",
        expression: "normal",
      },
      {
        id: "cue-closing",
        speaker: "left",
        caption: "終わります。",
        speech: "おわります。",
        expression: "normal",
      },
    ],
    materials: [],
    safety: {
      blockedTopics: [],
      persona: "解説役",
      maxResponseChars: 180,
      maxResponseCues: 2,
      fallbackCueId: "cue-opening",
    },
    test: { fixture },
  };
}

function autoProfile() {
  const value = profile();
  value.commentSource = { kind: "youtube" };
  delete (value as { test?: unknown }).test;
  return value;
}

function autoProfileResult() {
  return {
    profile: autoProfile(),
    summary: {
      title: "テスト",
      targetDurationMs: 600_000,
      characters: { left: "左", right: null },
      segments: [
        {
          kind: "opening" as const,
          label: "オープニング",
          cueCount: 1,
          materialLabel: null,
        },
        {
          kind: "script" as const,
          label: "本編",
          cueCount: 1,
          materialLabel: null,
        },
        {
          kind: "closing" as const,
          label: "クロージング",
          cueCount: 1,
          materialLabel: null,
        },
      ],
      materials: [],
    },
    warnings: ["placeholder の opening cue を作成しました。"],
  };
}

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "kakeai-live-cli-"));
  await writeFile(join(dir, "show.json"), JSON.stringify(profile()), "utf8");
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
  it("posts the profile and fixture, then polls to success", async () => {
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
        "--work",
        "work-1",
        "--script-version",
        "script-1",
        "--profile",
        "show.json",
        "--out",
        "package",
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
    const output = JSON.parse(stdout.join(""));
    expect(output.packagePath).toBe("/tmp/package");
    expect(calls[0]).toBe("http://test.local/api/v1/live-exports");
    expect(calls[1]).toBe("http://test.local/api/v1/jobs/job-1");
    expect(origins[0]).toBe("http://test.local");
    const body = bodies[0] as { outDir: string; fixture: unknown[] };
    expect(body.outDir).toBe(join(dir, "package"));
    expect(body.fixture).toHaveLength(1);
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
      [
        "--work",
        "work-1",
        "--script-version",
        "script-1",
        "--profile",
        "show.json",
        "--out",
        "package",
      ],
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

  it("generates, saves, and exports an auto profile", async () => {
    const calls: string[] = [];
    const autoBodies: unknown[] = [];
    const exportBodies: unknown[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/v1/live-profiles/auto")) {
        autoBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ data: autoProfileResult() }), { status: 200 });
      }
      if (url.endsWith("/api/v1/live-exports")) {
        exportBodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ data: baseJob("queued") }), { status: 202 });
      }
      return new Response(JSON.stringify({ data: baseJob("succeeded") }), { status: 200 });
    }) as typeof fetch;

    const stderr: string[] = [];
    const code = await runLiveExport(
      [
        "--work",
        "work-1",
        "--script-version",
        "script-1",
        "--auto-profile",
        "--save-profile",
        "generated.json",
        "--out",
        "package",
      ],
      { stdout: () => undefined, stderr: (text) => stderr.push(text) },
      {
        cwd: dir,
        env: { KAKEAI_API_URL: "http://test.local" },
        fetchImpl,
        sleep: async () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(calls[0]).toBe("http://test.local/api/v1/live-profiles/auto");
    expect(autoBodies[0]).toMatchObject({
      workId: "work-1",
      scriptVersionId: "script-1",
      includeCommentCorners: true,
    });
    expect(stderr.join("").length).toBeGreaterThan(0);
    const saved = liveShowProfileSchema.parse(
      JSON.parse(await readFile(join(dir, "generated.json"), "utf8")),
    );
    expect(saved.show.title).toBe("テスト");
    const body = exportBodies[0] as {
      profile: { show: { title: string } };
      outDir: string;
    };
    expect(body.profile.show.title).toBe("テスト");
    expect(body.outDir).toBe(join(dir, "package"));
  });

  it("dry-runs an auto profile without creating an export job", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/v1/live-profiles/auto")) {
        return new Response(JSON.stringify({ data: autoProfileResult() }), { status: 200 });
      }
      throw new Error(`unexpected call: ${url}`);
    }) as typeof fetch;

    const code = await runLiveExport(
      [
        "--work",
        "work-1",
        "--script-version",
        "script-1",
        "--auto-profile",
        "--save-profile",
        "dry.json",
        "--dry-run",
      ],
      { stdout: () => undefined, stderr: () => undefined },
      {
        cwd: dir,
        env: { KAKEAI_API_URL: "http://test.local" },
        fetchImpl,
        sleep: async () => undefined,
      },
    );

    expect(code).toBe(0);
    expect(calls).toEqual(["http://test.local/api/v1/live-profiles/auto"]);
    const saved = liveShowProfileSchema.parse(
      JSON.parse(await readFile(join(dir, "dry.json"), "utf8")),
    );
    expect(saved.show.title).toBe("テスト");
  });

  it("rejects --profile with --auto-profile", async () => {
    const fetchImpl = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const stderr: string[] = [];
    const code = await runLiveExport(
      [
        "--work",
        "work-1",
        "--script-version",
        "script-1",
        "--profile",
        "show.json",
        "--auto-profile",
        "--out",
        "package",
      ],
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

  it("requires --save-profile with --auto-profile unless dry-run", async () => {
    const fetchImpl = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const stderr: string[] = [];
    const code = await runLiveExport(
      [
        "--work",
        "work-1",
        "--script-version",
        "script-1",
        "--auto-profile",
        "--out",
        "package",
      ],
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
});
