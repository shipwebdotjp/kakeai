import { describe, expect, it } from "vitest";
import { DEFAULT_PORT, allowedOriginsForPort, loadConfig } from "./config.ts";

describe("allowedOriginsForPort", () => {
  it("accepts the loopback hostnames on the configured port", () => {
    const origins = allowedOriginsForPort(4317);
    expect([...origins].sort()).toEqual([
      "http://127.0.0.1:4317",
      "http://[::1]:4317",
      "http://localhost:4317",
    ]);
  });
});

describe("loadConfig", () => {
  it("places the database under the resolved data root", () => {
    const config = loadConfig({ KAKEAI_DATA_DIR: "/tmp/kakeai" }, "darwin", "/Users/me");
    expect(config.dataRoot).toBe("/tmp/kakeai");
    expect(config.databaseUrl).toBe("file:/tmp/kakeai/db/kakeai.db");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(DEFAULT_PORT);
  });

  it("accepts a valid KAKEAI_PORT", () => {
    const config = loadConfig({ KAKEAI_PORT: "5000" }, "darwin", "/Users/me");
    expect(config.port).toBe(5000);
    expect(config.allowedOrigins.has("http://localhost:5000")).toBe(true);
  });

  it("rejects an invalid KAKEAI_PORT", () => {
    expect(() => loadConfig({ KAKEAI_PORT: "not-a-port" }, "darwin", "/Users/me")).toThrow();
    expect(() => loadConfig({ KAKEAI_PORT: "70000" }, "darwin", "/Users/me")).toThrow();
  });
});
