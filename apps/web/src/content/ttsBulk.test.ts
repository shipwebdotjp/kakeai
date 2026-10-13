import { describe, expect, it } from "vitest";
import { createInitialContentDocument } from "@kakeai/contracts";
import {
  bulkTtsCandidateLineIds,
  createEmptyLine,
  generatedTakePolicy,
  mergeTake,
  type LineFormValue,
} from "./form";

function makeLine(partial: Partial<LineFormValue> = {}): LineFormValue {
  return { ...createEmptyLine("scene-1"), ...partial };
}

describe("mergeTake", () => {
  it("appends a generated take and selects it when none is selected", () => {
    const merged = mergeTake(makeLine(), { assetId: "asset-1", durationMs: 1200, source: "tts" }, "ifEmpty");
    expect(merged.takes).toHaveLength(1);
    expect(merged.takes[0]).toMatchObject({ assetId: "asset-1", durationMs: 1200, source: "tts" });
    expect(merged.selectedAudioTakeId).toBe(merged.takes[0]!.id);
  });

  it("updates an existing take with the same asset and source instead of duplicating", () => {
    const first = mergeTake(makeLine(), { assetId: "asset-1", durationMs: 1000, source: "tts" }, "always");
    const second = mergeTake(first, { assetId: "asset-1", durationMs: 1500, source: "tts" }, "always");
    expect(second.takes).toHaveLength(1);
    expect(second.takes[0]!.durationMs).toBe(1500);
  });

  it("keeps the user's selection when select is ifEmpty", () => {
    const selected = mergeTake(makeLine(), { assetId: "asset-manual", durationMs: 900, source: "manual" }, "always");
    const merged = mergeTake(selected, { assetId: "asset-tts", durationMs: 1100, source: "tts" }, "ifEmpty");
    expect(merged.takes).toHaveLength(2);
    expect(merged.selectedAudioTakeId).toBe(selected.selectedAudioTakeId);
  });

  it("overwrites the selection when select is always", () => {
    const selected = mergeTake(makeLine(), { assetId: "asset-manual", durationMs: 900, source: "manual" }, "always");
    const merged = mergeTake(selected, { assetId: "asset-tts", durationMs: 1100, source: "tts" }, "always");
    expect(merged.selectedAudioTakeId).toBe(merged.takes[1]!.id);
  });
});

describe("generatedTakePolicy", () => {
  it("selects and autoplays for individual generation only", () => {
    expect(generatedTakePolicy("individual")).toEqual({ select: "always", autoplay: true });
    expect(generatedTakePolicy("bulk")).toEqual({ select: "ifEmpty", autoplay: false });
  });
});

describe("bulkTtsCandidateLineIds", () => {
  it("returns only point-scene lines without a selected take", () => {
    const content = createInitialContentDocument();
    content.scenes[0]!.lines = [
      { id: "intro-line", speakerId: null, captionText: "", speechText: "x", selectedAudioTakeId: null, expressionId: null },
    ];
    const point = content.scenes[1]!;
    point.lines = [
      { id: "p-open", speakerId: null, captionText: "", speechText: "x", selectedAudioTakeId: null, expressionId: null },
      { id: "p-selected", speakerId: null, captionText: "", speechText: "y", selectedAudioTakeId: "take-1", expressionId: null },
    ];
    content.scenes[2]!.lines = [
      { id: "outro-line", speakerId: null, captionText: "", speechText: "z", selectedAudioTakeId: null, expressionId: null },
    ];
    expect(bulkTtsCandidateLineIds(content)).toEqual(["p-open"]);
  });
});
