import { describe, expect, it } from "vitest";
import { healthResponseSchema } from "@kakeai/contracts";
import { DEFAULT_LIMITS } from "../config.ts";
import { buildHealthResponse } from "./health.ts";

describe("buildHealthResponse", () => {
  it("matches the health contract", () => {
    const response = buildHealthResponse(DEFAULT_LIMITS, "notReady");
    expect(healthResponseSchema.safeParse(response).success).toBe(true);
    expect(response.apiVersion).toBe("v1");
    expect(response.worker.status).toBe("notReady");
    expect(response.storage.status).toBe("ok");
    expect(response.storage.warningThresholdBytes).toBe(80 * 1024 ** 3);
    expect(response.capabilities.locales).toEqual(["ja-JP"]);
    expect(response.capabilities.jobKinds).toEqual(["asset_ingest", "render", "tts"]);
    expect(response.capabilities.assetKinds).toEqual(["image", "video", "audio"]);
    expect(response.capabilities.voiceAdapters).toEqual(["voicevox"]);
  });

  it("reports a warning storage status", () => {
    expect(buildHealthResponse(DEFAULT_LIMITS, "ready", "warning").storage.status).toBe("warning");
  });
});
