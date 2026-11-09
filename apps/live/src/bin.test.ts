import {
  liveRunConfigSchema,
  liveRuntimeConfigSchema,
  type LiveRunConfig,
} from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import { parseLiveArgs, resolveControlToken, validateYouTubeRun } from "./bin.ts";

describe("live CLI arguments", () => {
  it("parses the manual package launch form", () => {
    expect(
      parseLiveArgs([
        "--package",
        "pkg",
        "--run-config",
        "/runs/manual/run-config.json",
        "--port",
        "3020",
        "--config",
        "live.json",
      ]),
    ).toEqual({
      kind: "run",
      packageDir: "pkg",
      port: 3020,
      configPath: "live.json",
      runId: undefined,
      runDir: undefined,
      controlTokenFile: undefined,
      runConfigPath: "/runs/manual/run-config.json",
    });
  });

  it("parses the Kakeai launch form", () => {
    expect(
      parseLiveArgs([
        "--package",
        "pkg",
        "--run-id",
        "run_1",
        "--run-dir",
        "/runs/run_1",
        "--control-token-file",
        "/runs/run_1/control-token",
        "--run-config",
        "/runs/run_1/run-config.json",
      ]),
    ).toEqual({
      kind: "run",
      packageDir: "pkg",
      port: undefined,
      configPath: undefined,
      runId: "run_1",
      runDir: "/runs/run_1",
      controlTokenFile: "/runs/run_1/control-token",
      runConfigPath: "/runs/run_1/run-config.json",
    });
  });

  it("parses the auth subcommand without --package", () => {
    expect(parseLiveArgs(["auth", "--config", "live.json"])).toEqual({
      kind: "auth",
      configPath: "live.json",
    });
    expect(parseLiveArgs(["auth"])).toEqual({ kind: "auth", configPath: undefined });
  });

  it("rejects missing package and unknown arguments", () => {
    expect(() => parseLiveArgs([])).toThrow(/--package/);
    expect(() => parseLiveArgs(["auth", "--package", "pkg"])).toThrow(/不明な引数/);
    expect(() => parseLiveArgs(["--package", "pkg", "--unknown"])).toThrow(/不明な引数/);
    expect(() => parseLiveArgs(["--package", "pkg"])).toThrow(/--run-config/);
    expect(() => parseLiveArgs(["--package", "pkg", "--test"])).toThrow(/不明な引数/);
    expect(() =>
      parseLiveArgs(["--package", "pkg", "--run-dir", "/runs/run_1"]),
    ).toThrow(/--run-id/);
  });

  it("handles help", () => {
    expect(parseLiveArgs(["--help"])).toEqual({ kind: "help" });
  });
});

describe("live control token", () => {
  it("leaves control disabled only when the environment variable is unset", async () => {
    await expect(resolveControlToken(undefined, {})).resolves.toBeUndefined();
    await expect(
      resolveControlToken(undefined, { KAKEAI_LIVE_CONTROL_TOKEN: "  " }),
    ).rejects.toThrow(/空/);
    await expect(
      resolveControlToken(undefined, { KAKEAI_LIVE_CONTROL_TOKEN: " token " }),
    ).resolves.toBe("token");
  });
});

describe("live YouTube validation", () => {
  const runtimeConfig = liveRuntimeConfigSchema.parse({
    llm: {
      mode: "local",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "test-model",
    },
    tts: { adapters: {} },
    port: 3010,
    dataDir: "/tmp/kakeai-live",
    youtube: {
      apiKey: "api-key-1",
      videoUrl: "https://youtu.be/local-config",
      liveChatId: "chat-local",
    },
  });
  const runConfig = liveRunConfigSchema.parse({
    schemaVersion: 1,
    runId: "run-1",
    programVersionId: "program-version-1",
    package: {
      packageId: "livepkg-test",
      manifestSha256: "a".repeat(64),
      packagePath: "/tmp/kakeai/package",
    },
    source: {
      kind: "youtube",
      videoUrl: "https://youtu.be/run-source",
      liveChatId: null,
    },
    startAt: null,
    requestedPort: 3010,
  });

  it("accepts a Run target without using the local target", () => {
    expect(() => validateYouTubeRun(runtimeConfig, runConfig)).not.toThrow();
  });

  it("does not fill explicit null Run targets from local config", () => {
    const nullTarget: LiveRunConfig = {
      ...runConfig,
      source: { kind: "youtube", videoUrl: null, liveChatId: null },
    };
    expect(() => validateYouTubeRun(runtimeConfig, nullTarget)).toThrow(/Run 設定に/);
  });
});
