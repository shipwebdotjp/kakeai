import { describe, expect, it } from "vitest";
import {
  DEFAULT_AIVISSPEECH_BASE_URL,
  DEFAULT_PORT,
  DEFAULT_VOICEVOX_BASE_URL,
  allowedOriginsForPort,
  loadConfig,
  parseVoiceBaseUrl,
} from "./config.ts";

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

  it("defaults the adapter base urls to loopback", () => {
    const config = loadConfig({ KAKEAI_DATA_DIR: "/tmp/kakeai" }, "darwin", "/Users/me");
    expect(config.voiceBaseUrls.voicevox).toBe(DEFAULT_VOICEVOX_BASE_URL);
    expect(config.voiceBaseUrls.aivisspeech).toBe(DEFAULT_AIVISSPEECH_BASE_URL);
  });

  it("overrides each adapter base url from its environment variable", () => {
    const config = loadConfig(
      {
        KAKEAI_DATA_DIR: "/tmp/kakeai",
        KAKEAI_VOICEVOX_BASE_URL: "http://127.0.0.1:60000",
        KAKEAI_AIVISSPEECH_BASE_URL: "http://127.0.0.1:60001",
      },
      "darwin",
      "/Users/me",
    );
    expect(config.voiceBaseUrls.voicevox).toBe("http://127.0.0.1:60000");
    expect(config.voiceBaseUrls.aivisspeech).toBe("http://127.0.0.1:60001");
  });
});

describe("parseVoiceBaseUrl", () => {
  it("accepts loopback http urls and normalizes to an origin", () => {
    expect(parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", undefined, DEFAULT_VOICEVOX_BASE_URL)).toBe(
      DEFAULT_VOICEVOX_BASE_URL,
    );
    expect(
      parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", "http://localhost:50021/", DEFAULT_VOICEVOX_BASE_URL),
    ).toBe("http://localhost:50021");
    expect(
      parseVoiceBaseUrl("KAKEAI_AIVISSPEECH_BASE_URL", "http://[::1]:10101", DEFAULT_AIVISSPEECH_BASE_URL),
    ).toBe("http://[::1]:10101");
    expect(
      parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", "http://127.0.0.5:50021", DEFAULT_VOICEVOX_BASE_URL),
    ).toBe("http://127.0.0.5:50021");
  });

  it("rejects non-loopback, credentialed, and prefixed urls", () => {
    expect(() =>
      parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", "http://192.168.0.1:50021", DEFAULT_VOICEVOX_BASE_URL),
    ).toThrow();
    expect(() =>
      parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", "https://127.0.0.1:50021", DEFAULT_VOICEVOX_BASE_URL),
    ).toThrow();
    expect(() =>
      parseVoiceBaseUrl(
        "KAKEAI_VOICEVOX_BASE_URL",
        "http://user:pass@127.0.0.1:50021",
        DEFAULT_VOICEVOX_BASE_URL,
      ),
    ).toThrow();
    expect(() =>
      parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", "http://127.0.0.1:50021/api", DEFAULT_VOICEVOX_BASE_URL),
    ).toThrow();
    expect(() =>
      parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", "http://127.0.0.1:50021?a=1", DEFAULT_VOICEVOX_BASE_URL),
    ).toThrow();
    expect(() =>
      parseVoiceBaseUrl("KAKEAI_VOICEVOX_BASE_URL", "not-a-url", DEFAULT_VOICEVOX_BASE_URL),
    ).toThrow();
  });
});
