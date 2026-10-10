import { describe, expect, it } from "vitest";
import { contentDocumentSchema } from "./document";
import { validContentDocument } from "../testing/fixtures";

const transition = {
  enter: { preset: "fade", durationMs: 350 },
  exit: { preset: "none", durationMs: 0 },
} as const;

describe("contentDocumentSchema", () => {
  it("accepts a valid v3 document", () => {
    const result = contentDocumentSchema.safeParse(validContentDocument());
    expect(result.success).toBe(true);
  });

  it("requires voiceProfileId on speakers", () => {
    const doc = validContentDocument();
    delete (doc.speakers[0] as { voiceProfileId?: unknown }).voiceProfileId;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects a non-v3 schemaVersion", () => {
    const doc = { ...validContentDocument(), schemaVersion: 2 };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("requires layer, order and transition on every cue", () => {
    const doc = validContentDocument();
    delete (doc.scenes[0]!.visualCues[0] as { layer?: unknown }).layer;
    delete (doc.scenes[0]!.visualCues[0] as { order?: unknown }).order;
    delete (doc.scenes[0]!.visualCues[0] as { transition?: unknown }).transition;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects duplicate order within the same layer of a scene", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues.push({
      id: "vc-intro-bg-2",
      template: { id: "media.full-bleed", version: 1 },
      range: { kind: "scene" },
      layer: "background",
      order: 0,
      transition,
      input: { assetId: "asset-bg-2", fit: "cover" },
    });
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects a cue whose layer is not allowed by the template", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues[0]!.layer = "card";
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an unregistered transition preset", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues[0]!.transition.enter = {
      preset: "slide" as never,
      durationMs: 100,
    };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("accepts the expanded transition presets", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues[0]!.transition.enter = { preset: "slide-up", durationMs: 300 };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects preset none with a non-zero duration", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues[0]!.transition.exit = { preset: "none", durationMs: 100 };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
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
        layer: "standing",
        order: 0,
        transition,
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
        layer: "standing",
        order: 0,
        transition,
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
        layer: "overlay",
        order: 0,
        transition,
        input: { anything: true },
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("validates a recursive composite template and its nested media", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-device",
        template: { id: "scene.device-frame", version: 1 },
        range: { kind: "scene" },
        layer: "background",
        order: 0,
        transition,
        input: {
          frame: "laptop",
          screen: { kind: "media", assetId: "asset-screen", fit: "cover" },
        },
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a nested template that does not exist", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-device",
        template: { id: "scene.device-frame", version: 1 },
        range: { kind: "scene" },
        layer: "background",
        order: 0,
        transition,
        input: {
          frame: "phone",
          screen: { kind: "template", template: { id: "missing.template", version: 1 }, input: {} },
        },
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
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
});
