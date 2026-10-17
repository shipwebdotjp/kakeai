import { describe, expect, it } from "vitest";
import { contentDocumentSchema } from "./document";
import { createInsertScene } from "./defaults";
import { validContentDocument } from "../testing/fixtures";

const transition = {
  enter: { preset: "fade", durationMs: 350 },
  exit: { preset: "none", durationMs: 0 },
} as const;

describe("contentDocumentSchema", () => {
  it("accepts a valid document", () => {
    const result = contentDocumentSchema.safeParse(validContentDocument());
    expect(result.success).toBe(true);
  });

  it("accepts a scene audio cue with the program role", () => {
    const doc = validContentDocument();
    doc.audioCues.push({
      id: "cue-program",
      role: "program",
      assetId: "asset-audio-program",
      range: { kind: "scene", sceneId: doc.scenes[1]!.id },
      gainDb: 0,
      loop: false,
    });
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an unknown audio cue role", () => {
    const doc = validContentDocument();
    (doc.audioCues[0] as { role: string }).role = "voice";
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("treats an omitted or zero narration gapBeforeMs as valid", () => {
    const doc = validContentDocument();
    const line = doc.scenes[1]!.lines[0]!;
    expect("gapBeforeMs" in line).toBe(false);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);

    line.gapBeforeMs = 0;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a negative narration gapBeforeMs", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.lines[0]!.gapBeforeMs = -1;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects a non-integer narration gapBeforeMs", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.lines[0]!.gapBeforeMs = 12.5;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("requires voiceProfileId on speakers", () => {
    const doc = validContentDocument();
    delete (doc.speakers[0] as { voiceProfileId?: unknown }).voiceProfileId;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects duplicate voice locales on a character", () => {
    const doc = validContentDocument();
    doc.characters = [
      {
        id: "character-rin",
        name: "リン",
        voices: [
          { locale: "ja-JP", voiceProfileId: "vp_1" },
          { locale: "ja-JP", voiceProfileId: "vp_2" },
        ],
        appearances: [],
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects a speaker voice that differs from the character locale voice", () => {
    const doc = validContentDocument();
    doc.characters = [
      {
        id: "character-rin",
        name: "リン",
        voices: [{ locale: "ja-JP", voiceProfileId: "vp_1" }],
        appearances: [],
      },
    ];
    const baseSpeakers = [...doc.speakers];
    doc.speakers = [
      ...baseSpeakers,
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: "vp_2" },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
    doc.speakers = [
      ...baseSpeakers,
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: "vp_1" },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a non-current schemaVersion", () => {
    const doc = { ...validContentDocument(), schemaVersion: 2 };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("requires a non-blank label on every scene", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.label = "   ";
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
    delete (doc.scenes[0] as { label?: unknown }).label;
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

  it("accepts a character.standing@1 cue that references an existing appearance", () => {
    const doc = validContentDocument();
    doc.characters.push({
      id: "character-rin",
      name: "リン",
      voices: [],
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
      ],
    });
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-standing-left",
        template: { id: "character.standing", version: 1 },
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

  it("rejects a character.standing@1 cue that references a missing appearance", () => {
    const doc = validContentDocument();
    doc.characters.push({
      id: "character-rin",
      name: "リン",
      voices: [],
      appearances: [
        { id: "appearance-smile", assetId: "asset-rin", expression: "smile", pose: "front", faceSetId: null },
      ],
    });
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-standing-left",
        template: { id: "character.standing", version: 1 },
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

  it("rejects retired template versions", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-old",
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
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("allows composition.full-bleed@1 on scene, lines and offset ranges in the background layer", () => {
    const base = validContentDocument();
    const lineIds = base.scenes[1]!.lines.map((line) => line.id);
    const ranges = [
      { kind: "scene" },
      { kind: "lines", startLineId: lineIds[0], endLineId: lineIds[lineIds.length - 1] },
      { kind: "offset", startMs: 0, endMs: 1000 },
    ] as const;
    for (const range of ranges) {
      const doc = validContentDocument();
      doc.scenes[1]!.visualCues = [
        {
          id: "vc-composition-bg",
          template: { id: "composition.full-bleed", version: 1 },
          range,
          layer: "background",
          order: 0,
          transition,
          input: { compositionVersionId: "cmpver_001" },
        },
      ];
      expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
    }
  });

  it("accepts an effect trigger that references a line in the same scene", () => {
    const doc = validContentDocument();
    const lineId = doc.scenes[1]!.lines[0]!.id;
    doc.scenes[1]!.visualCues.push({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 5,
      transition,
      input: {
        data: {
          columns: [{ key: "a", label: "A", type: "text" }],
          rows: [{ a: "x" }],
        },
        effects: [
          {
            target: { kind: "row", index: 0 },
            trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      },
    });
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an effect trigger that references a line in another scene", () => {
    const doc = validContentDocument();
    const lineId = doc.scenes[1]!.lines[0]!.id;
    doc.scenes[2]!.visualCues.push({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 5,
      transition,
      input: {
        data: {
          columns: [{ key: "a", label: "A", type: "text" }],
          rows: [{ a: "x" }],
        },
        effects: [
          {
            target: { kind: "row", index: 0 },
            trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      },
    });
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an effect trigger that references a missing line", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.visualCues.push({
      id: "vc-table",
      template: { id: "table.simple", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 5,
      transition,
      input: {
        data: {
          columns: [{ key: "a", label: "A", type: "text" }],
          rows: [{ a: "x" }],
        },
        effects: [
          {
            target: { kind: "row", index: 0 },
            trigger: { kind: "lines", startLineId: "line-missing", endLineId: "line-missing" },
            effect: { kind: "emphasize", style: "frame", tone: "primary" },
          },
        ],
      },
    });
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects composition.full-bleed@1 outside the background layer", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-composition-card",
        template: { id: "composition.full-bleed", version: 1 },
        range: { kind: "scene" },
        layer: "card",
        order: 0,
        transition,
        input: { compositionVersionId: "cmpver_001" },
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("allows the same CompositionVersion on multiple background cues", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.visualCues = [
      {
        id: "vc-composition-a",
        template: { id: "composition.full-bleed", version: 1 },
        range: { kind: "scene" },
        layer: "background",
        order: 0,
        transition,
        input: { compositionVersionId: "cmpver_001" },
      },
      {
        id: "vc-composition-b",
        template: { id: "composition.full-bleed", version: 1 },
        range: { kind: "scene" },
        layer: "background",
        order: 1,
        transition,
        input: { compositionVersionId: "cmpver_001" },
      },
    ];
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("accepts an expressionId on a line that has a speaker", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.lines[0]!.expressionId = "happy";
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an expressionId on a line without a speaker", () => {
    const doc = validContentDocument();
    doc.scenes[1]!.lines[0]!.speakerId = null;
    doc.scenes[1]!.lines[0]!.expressionId = "happy";
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]).toMatchObject({
        path: ["scenes", 1, "lines", 0, "expressionId"],
      });
    }
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
        expressionId: null,
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
        expressionId: null,
      },
    ];
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("rejects a lowercase custom accent color", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.accent = { kind: "custom", color: "#2563eb" };
    const result = contentDocumentSchema.safeParse(doc);
    expect(result.success).toBe(false);
  });

  it("accepts theme and custom scene accents", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.accent = { kind: "theme", token: "secondary" };
    doc.scenes[1]!.accent = { kind: "custom", color: "#123ABC" };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an unknown accent token", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.accent = { kind: "theme", token: "quaternary" } as never;
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("validates visual theme ref shape and accepts arbitrary ref shape", () => {
    const doc = validContentDocument();
    doc.visualTheme = { id: "", version: 1 };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);

    const doc2 = validContentDocument();
    doc2.visualTheme = { id: "unknown-theme", version: 1 };
    expect(contentDocumentSchema.safeParse(doc2).success).toBe(true);
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
    const extra = { ...doc.scenes[1]!, id: "scene-point-9", lines: [], visualCues: [] };
    doc.scenes.splice(3, 0, extra);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an outro before the end", () => {
    const doc = validContentDocument();
    doc.scenes.reverse();
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("accepts an insert scene between point scenes", () => {
    const doc = validContentDocument();
    doc.scenes.splice(
      2,
      0,
      createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true),
    );
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects an insert scene with auto timing", () => {
    const doc = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true);
    (insert as { timing: unknown }).timing = { mode: "auto" };
    doc.scenes.splice(2, 0, insert);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an insert scene that carries lines", () => {
    const doc = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true);
    insert.lines.push({
      id: "line-insert-1",
      speakerId: null,
      captionText: "x",
      speechText: "x",
      selectedAudioTakeId: null,
      expressionId: null,
    });
    doc.scenes.splice(2, 0, insert);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an insert scene whose main cue is not media.full-bleed", () => {
    const doc = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true);
    insert.visualCues = [
      {
        id: insert.mainVisualCueId,
        template: { id: "text.block", version: 1 },
        range: { kind: "scene" },
        layer: "overlay",
        order: 0,
        transition,
        input: { text: "x", role: "heading" },
      },
    ];
    doc.scenes.splice(2, 0, insert);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an insert scene whose main cue is not a scene-range background cue", () => {
    const doc = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true);
    insert.visualCues[0]!.range = { kind: "offset", startMs: 0, endMs: 1000 };
    doc.scenes.splice(2, 0, insert);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("accepts an insert scene whose main cue loops or is trimmed", () => {
    const doc = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true);
    insert.visualCues[0]!.input = {
      assetId: "asset-video-1",
      fit: "cover",
      loop: true,
      trimStartMs: 1000,
      trimEndMs: 4000,
    };
    doc.scenes.splice(2, 0, insert);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it("rejects a full-bleed cue whose trim start is not before trim end", () => {
    const doc = validContentDocument();
    doc.scenes[0]!.visualCues[0]!.input = {
      assetId: "asset-bg",
      fit: "cover",
      trimStartMs: 4000,
      trimEndMs: 1000,
    };
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an insert scene with extra visual cues", () => {
    const doc = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true);
    insert.visualCues.push({
      id: "vc-insert-extra",
      template: { id: "text.block", version: 1 },
      range: { kind: "scene" },
      layer: "overlay",
      order: 1,
      transition,
      input: { text: "x", role: "heading" },
    });
    doc.scenes.splice(2, 0, insert);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });

  it("rejects an insert scene whose mainVisualCueId is missing", () => {
    const doc = validContentDocument();
    const insert = createInsertScene("scene-insert-1", "動画 1", "asset-video-1", 5000, true);
    insert.mainVisualCueId = "vc-missing";
    doc.scenes.splice(2, 0, insert);
    expect(contentDocumentSchema.safeParse(doc).success).toBe(false);
  });
});
