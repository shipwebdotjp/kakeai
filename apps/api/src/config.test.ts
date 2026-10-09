import { describe, expect, it } from "vitest";
import {
  DEFAULT_AIVISSPEECH_BASE_URL,
  DEFAULT_PORT,
  DEFAULT_VOICEVOX_BASE_URL,
  allowedOriginsForPort,
  loadConfig,
  parseAivisspeechBaseUrl,
  parseVoicevoxBaseUrl,
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

describe("parseVoicevoxBaseUrl", () => {
  it("accepts loopback http urls and normalizes to an origin", () => {
    expect(parseVoicevoxBaseUrl(undefined)).toBe(DEFAULT_VOICEVOX_BASE_URL);
    expect(parseVoicevoxBaseUrl("http://localhost:50021/")).toBe("http://localhost:50021");
    expect(parseVoicevoxBaseUrl("http://[::1]:50021")).toBe("http://[::1]:50021");
    expect(parseVoicevoxBaseUrl("http://127.0.0.5:50021")).toBe("http://127.0.0.5:50021");
  });

  it("rejects non-loopback, credentialed, and prefixed urls", () => {
    expect(() => parseVoicevoxBaseUrl("http://192.168.0.1:50021")).toThrow();
    expect(() => parseVoicevoxBaseUrl("https://127.0.0.1:50021")).toThrow();
    expect(() => parseVoicevoxBaseUrl("http://user:pass@127.0.0.1:50021")).toThrow();
    expect(() => parseVoicevoxBaseUrl("http://127.0.0.1:50021/api")).toThrow();
    expect(() => parseVoicevoxBaseUrl("http://127.0.0.1:50021?a=1")).toThrow();
    expect(() => parseVoicevoxBaseUrl("not-a-url")).toThrow();
  });
});

describe("parseAivisspeechBaseUrl", () => {
  it("accepts loopback http urls and normalizes to an origin", () => {
    expect(parseAivisspeechBaseUrl(undefined)).toBe(DEFAULT_AIVISSPEECH_BASE_URL);
    expect(parseAivisspeechBaseUrl("http://localhost:10101/")).toBe("http://localhost:10101");
    expect(parseAivisspeechBaseUrl("http://[::1]:10101")).toBe("http://[::1]:10101");
  });

  it("rejects non-loopback, credentialed, and prefixed urls", () => {
    expect(() => parseAivisspeechBaseUrl("http://192.168.0.1:10101")).toThrow();
    expect(() => parseAivisspeechBaseUrl("https://127.0.0.1:10101")).toThrow();
    expect(() => parseAivisspeechBaseUrl("http://user:pass@127.0.0.1:10101")).toThrow();
    expect(() => parseAivisspeechBaseUrl("http://127.0.0.1:10101/api")).toThrow();
    expect(() => parseAivisspeechBaseUrl("http://127.0.0.1:10101?a=1")).toThrow();
    expect(() => parseAivisspeechBaseUrl("not-a-url")).toThrow();
  });
});
