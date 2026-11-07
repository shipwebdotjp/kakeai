import { describe, expect, it } from "vitest";
import { parseLiveArgs } from "./bin.ts";

describe("live CLI arguments", () => {
  it("parses the existing package launch form", () => {
    expect(
      parseLiveArgs(["--package", "pkg", "--test", "--port", "3020", "--config", "live.json"]),
    ).toEqual({
      kind: "run",
      packageDir: "pkg",
      testMode: true,
      port: 3020,
      configPath: "live.json",
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
  });

  it("handles help", () => {
    expect(parseLiveArgs(["--help"])).toEqual({ kind: "help" });
  });
});
