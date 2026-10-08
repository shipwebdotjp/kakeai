import { describe, expect, it } from "vitest";
import { contentDocumentSchema } from "./document";
import { validContentDocument } from "../testing/fixtures";

describe("contentDocumentSchema", () => {
  it("accepts a valid v1 document", () => {
    const result = contentDocumentSchema.safeParse(validContentDocument());
    expect(result.success).toBe(true);
  });

  it("rejects an unknown template id or version", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-unknown",
        template: { id: "chart.bar", version: 1 },
        range: { kind: "scene" },
        input: { anything: true },
      },
    ];
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects duplicate line ids", () => {
    const doc = validContentDocument();
    doc.scenes[2]!.lines = [
      {
        id: "line-p1-1",
        speakerId: null,
        captionText: "重複",
        speechText: "じゅうふく",
        selectedAudioTakeId: null,
      },
    ];
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects a selected audio take that belongs to another line", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.lines[0]!.selectedAudioTakeId = "take-line-p1-1";
    doc.audioTakes[0]!.narrationSegmentId = "line-p1-1";
    doc.scenes[2]!.lines = [
      {
        id: "line-p2-1",
        speakerId: null,
        captionText: "別の行",
        speechText: "べつのぎょう",
        selectedAudioTakeId: "take-line-p1-1",
      },
    ];
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects a lowercase accent color", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.accentColor = "#2563eb";
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects a wrong scene composition", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.kind = "intro" as never;
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });
});
