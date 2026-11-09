import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { httpLiveControlClient, type LiveControlTarget } from "./control-client.ts";

function target(overrides: Partial<LiveControlTarget> = {}): LiveControlTarget {
  const logDir = "/tmp/kakeai-live-run";
  return {
    url: "http://127.0.0.1:3010",
    tokenFile: join(logDir, "control-token"),
    logDir,
    expectedPort: 3010,
    ...overrides,
  };
}

describe("httpLiveControlClient target validation", () => {
  it("never reads or sends the token to a non-loopback host", async () => {
    await expect(
      httpLiveControlClient.status(target({ url: "http://example.com:3010" })),
    ).rejects.toThrow(/127\.0\.0\.1 または ::1/);
  });

  it("requires the expected port and a token under the Run directory", async () => {
    await expect(
      httpLiveControlClient.status(
        target({ url: "http://127.0.0.1:3011", expectedPort: 3010 }),
      ),
    ).rejects.toThrow(/ポート/);
    await expect(
      httpLiveControlClient.stop(
        target({ tokenFile: "/tmp/other/control-token" }),
      ),
    ).rejects.toThrow(/Run ディレクトリの外/);
    await expect(
      httpLiveControlClient.status(target({ url: "http://[::1]:3010" })),
    ).rejects.toThrow(/ENOENT/);
  });
});
