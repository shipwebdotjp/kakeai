import { describe, expect, it } from "vitest";
import {
  contentDocumentInputSchema,
  contentDocumentSchema,
  contentDocumentV1ToV2Schema,
} from "./document";
import { validContentDocument } from "../testing/fixtures";

describe("contentDocumentSchema", () => {
  it("accepts a valid v2 document", () => {
    const result = contentDocumentSchema.safeParse(validContentDocument());
    expect(result.success).toBe(true);
  });

  it("requires voiceProfileId on speakers", () => {
    const doc = validContentDocument();
    delete (doc.speakers[0] as { voiceProfileId?: unknown }).voiceProfileId;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("upgrades a v1 document to v2 with null voice profiles", () => {
    const v1 = {
      ...validContentDocument(),
      schemaVersion: 1 as const,
      speakers: [{ id: "speaker-narrator", name: "ナレーター", characterId: null }],
    };
    const upgraded = contentDocumentV1ToV2Schema.parse(v1);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.speakers[0]!.voiceProfileId).toBeNull();
    expect(contentDocumentInputSchema.safeParse(v1).success).toBe(true);
  });

  it("accepts a character.standing@2 cue that references an existing appearance", () => {
    const doc = validContentDocument();
    doc.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    });
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-standing-left",
        template: { id: "character.standing", version: 2 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-smile",
          side: "left",
          scale: 1,
        },
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a character.standing@2 cue that references a missing appearance", () => {
    const doc = validContentDocument();
    doc.characters.push({
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    });
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-standing-left",
        template: { id: "character.standing", version: 2 },
        range: { kind: "scene" },
        input: {
          characterId: "character-rin",
          appearanceId: "appearance-missing",
          side: "left",
          scale: 1,
        },
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
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

  it("accepts zero point scenes", () => {
    const doc = validContentDocument();
    doc.scenes = doc.scenes.filter((scene) => scene.kind !== "point");
    doc.audioTakes = [];
    expect(doc.scenes.map((scene) => scene.kind)).toEqual(["intro", "outro"]);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts more than three point scenes", () => {
    const doc = validContentDocument();
    const extra = { ...doc.scenes[1]!, id: "scene-point-9", lines: [] };
    doc.scenes.splice(3, 0, extra);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an outro before the end", () => {
    const doc = validContentDocument();
    doc.scenes.reverse();
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("still reads a legacy five-scene document", () => {
    const doc = validContentDocument();
    doc.template = { id: "explanation-5-scenes", version: 1 };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a legacy document with a changed composition", () => {
    const doc = validContentDocument();
    doc.template = { id: "explanation-5-scenes", version: 1 };
    doc.scenes = doc.scenes.filter((scene) => scene.kind !== "point");
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });
});
