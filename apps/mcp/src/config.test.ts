import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_ID,
  McpConfigError,
  parseMcpArgs,
  readPackageVersion,
} from "./config.ts";

describe("MCP configuration", () => {
  it("defaults the agent id and lets the client resolve the socket", () => {
    expect(parseMcpArgs([], {})).toEqual({
      kind: "run",
      config: { agentId: DEFAULT_AGENT_ID },
    });
  });

  it("reads environment overrides", () => {
    expect(
      parseMcpArgs([], {
        KAKEAI_AGENT_ID: "claude-code",
        KAKEAI_SOCKET: "/run/kakeai.sock",
        KAKEAI_DATA_DIR: "/data/kakeai",
      }),
    ).toEqual({
      kind: "run",
      config: {
        agentId: "claude-code",
        socketPath: "/run/kakeai.sock",
      },
    });
  });

  it("prefers arguments over the environment", () => {
    expect(
      parseMcpArgs(
        ["--agent-id", "arg-agent", "--socket=/tmp/arg.sock", "--data-dir", "/tmp/data"],
        { KAKEAI_AGENT_ID: "env-agent", KAKEAI_SOCKET: "/tmp/env.sock" },
      ),
    ).toEqual({
      kind: "run",
      config: {
        agentId: "arg-agent",
        socketPath: "/tmp/arg.sock",
        dataRoot: "/tmp/data",
      },
    });
  });

  it("handles help and version", () => {
    expect(parseMcpArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseMcpArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseMcpArgs(["--version"])).toEqual({ kind: "version" });
    expect(parseMcpArgs(["-V"])).toEqual({ kind: "version" });
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/u);
  });

  it("rejects unknown or incomplete arguments", () => {
    expect(() => parseMcpArgs(["--unknown"])).toThrow(McpConfigError);
    expect(() => parseMcpArgs(["--socket"])).toThrow(McpConfigError);
    expect(() => parseMcpArgs(["--agent-id="])).toThrow(McpConfigError);
    expect(() => parseMcpArgs(["--socket", "--agent-id"])).toThrow(McpConfigError);
  });
});
