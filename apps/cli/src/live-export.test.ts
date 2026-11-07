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
});
