import { describe, expect, it } from "vitest";
import { characterAppearanceSchema } from "./content/character";
import { bulkTtsJobsResultSchema } from "./dto";
import { createBulkTtsJobsRequestSchema } from "./requests";

const queuedTtsJob = {
  id: "job-1",
  kind: "tts",
  status: "queued",
  workId: "wrk-1",
  assetId: null,
  languageEditionId: "led-1",
  scriptVersionId: "scr-1",
  progressPercent: 0,
  createdAt: "2026-10-08T03:20:00.000Z",
  startedAt: null,
  finishedAt: null,
  error: null,
  ttsResult: null,
  artifacts: [],
};

describe("bulkTtsJobsResultSchema", () => {
  it("accepts queued jobs and per-segment exclusions", () => {
    const result = {
      jobs: [{ narrationSegmentId: "line-1", job: queuedTtsJob }],
      excluded: [
        {
          narrationSegmentId: "line-2",
          code: "TTS_INPUT_INVALID",
          message: "読み上げテキストが空です。",
        },
        {
          narrationSegmentId: "line-3",
          code: "TTS_ENGINE_UNAVAILABLE",
          message: "音声エンジンに接続できません。",
        },
      ],
    };
    expect(bulkTtsJobsResultSchema.safeParse(result).success).toBe(true);
  });

  it("rejects an unknown exclusion code", () => {
    const result = {
      jobs: [],
      excluded: [{ narrationSegmentId: "line-2", code: "NOT_A_CODE", message: "x" }],
    };
    expect(bulkTtsJobsResultSchema.safeParse(result).success).toBe(false);
  });
});

describe("createBulkTtsJobsRequestSchema", () => {
  it("accepts an empty body and rejects unknown keys", () => {
    expect(createBulkTtsJobsRequestSchema.safeParse({}).success).toBe(true);
    expect(createBulkTtsJobsRequestSchema.safeParse({ speechText: "x" }).success).toBe(false);
  });
});

describe("characterAppearanceSchema", () => {
  it("defaults an omitted faceSetId to null", () => {
    const parsed = characterAppearanceSchema.safeParse({
      id: "appearance-1",
      assetId: "asset-1",
      expression: "smile",
      pose: "front",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.faceSetId).toBeNull();
    }
  });
});
