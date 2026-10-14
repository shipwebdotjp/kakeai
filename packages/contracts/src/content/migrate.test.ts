import { describe, expect, it } from "vitest";
import { parseContentDocument } from "./document";
import { migrateContentDocument } from "./migrate";
import { validContentDocument } from "../testing/fixtures";

function v4Document(): Record<string, unknown> {
  const doc = validContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 4;
  delete doc.visualTheme;
  doc.scenes = (doc.scenes as Record<string, unknown>[]).map((scene) => {
    const copy = { ...scene };
    delete copy.label;
    copy.accentColor = "#2563EB";
    delete copy.accent;
    return copy;
  });
  return doc;
}

function v5Document(): Record<string, unknown> {
  const doc = validContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 5;
  delete doc.visualTheme;
  const colors = ["#2563EB", "#16A34A", "#DC2626", "#2563EB", "#123ABC"];
  doc.scenes = (doc.scenes as Record<string, unknown>[]).map((scene, index) => {
    const copy = { ...scene };
    copy.accentColor = colors[index % colors.length];
    delete copy.accent;
    return copy;
  });
  return doc;
}

function v6Document(): Record<string, unknown> {
  const doc = validContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 6;
  doc.characters = [
    {
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-rin", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    },
  ];
  doc.scenes = (doc.scenes as Record<string, unknown>[]).map((scene) => {
    const copy = { ...scene };
    copy.lines = ((copy.lines as Record<string, unknown>[] | undefined) ?? []).map((line) => {
      const lineCopy = { ...line };
      delete lineCopy.expressionId;
      return lineCopy;
    });
    return copy;
  });
  return doc;
}

function v7Document(): Record<string, unknown> {
  const doc = validContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 7;
  doc.characters = [
    {
      id: "character-rin",
      name: "リン",
      appearances: [
        { id: "appearance-rin", assetId: "asset-rin", expression: "smile", pose: "front" },
      ],
    },
  ];
  doc.speakers = [
    ...(doc.speakers as Record<string, unknown>[]),
    { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: "vp_1" },
  ];
  return doc;
}

describe("migrateContentDocument", () => {
  it("migrates a v4 document to v8 with labels, theme and unified accents", () => {
    const migrated = parseContentDocument(migrateContentDocument(v4Document()));
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.visualTheme).toEqual({ id: "soft-editorial", version: 1 });
    expect(migrated.scenes.map((scene) => scene.label)).toEqual([
      "導入",
      "要点 1",
      "要点 2",
      "要点 3",
      "結び",
    ]);
    expect(migrated.scenes.map((scene) => scene.accent)).toEqual(
      migrated.scenes.map(() => ({ kind: "theme", token: "primary" })),
    );
  });

  it("migrates a v5 document to v8 and unifies scene accents to theme.primary", () => {
    const migrated = parseContentDocument(migrateContentDocument(v5Document()));
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.visualTheme).toEqual({ id: "soft-editorial", version: 1 });
    expect(migrated.scenes.map((scene) => scene.label)).toEqual([
      "導入",
      "要点 1",
      "要点 2",
      "要点 3",
      "結び",
    ]);
    for (const scene of migrated.scenes) {
      expect(scene.accent).toEqual({ kind: "theme", token: "primary" });
      expect(scene).not.toHaveProperty("accentColor");
    }
  });

  it("keeps explicit text cue styles through v5 to v6 migration", () => {
    const input = v5Document();
    const scenes = input.scenes as Record<string, unknown>[];
    (scenes[1]!.visualCues as Record<string, unknown>[])[0]!["input"] = {
      text: "見出し",
      role: "heading",
      font: "serif",
      fontSize: 80,
      color: "#FF0000",
      decoration: { bold: true, italic: true, outline: false, shadow: false },
    };
    const migrated = parseContentDocument(migrateContentDocument(input));
    const cue = migrated.scenes[1]!.visualCues[0]!;
    expect(cue.input).toEqual({
      text: "見出し",
      role: "heading",
      font: "serif",
      fontSize: 80,
      color: "#FF0000",
      decoration: { bold: true, italic: true, outline: false, shadow: false },
    });
  });

  it("keeps an existing label", () => {
    const input = v4Document();
    (input.scenes as Record<string, unknown>[])[1]!.label = "独自名";
    const migrated = parseContentDocument(migrateContentDocument(input));
    expect(migrated.scenes[1]!.label).toBe("独自名");
  });

  it("migrates a v6 document to v8 with null faceSetId and expressionId", () => {
    const migrated = parseContentDocument(migrateContentDocument(v6Document()));
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.characters[0]!.appearances[0]!.faceSetId).toBeNull();
    for (const scene of migrated.scenes) {
      for (const line of scene.lines) {
        expect(line.expressionId).toBeNull();
      }
    }
  });

  it("migrates a v7 document to v8 with speaker voices on characters", () => {
    const migrated = parseContentDocument(migrateContentDocument(v7Document()));
    expect(migrated.schemaVersion).toBe(8);
    expect(migrated.characters[0]!.voices).toEqual([
      { locale: "ja-JP", voiceProfileId: "vp_1" },
    ]);
  });

  it("migrates a v7 character without a voiced speaker to empty voices", () => {
    const input = v7Document();
    input.speakers = [
      ...((input.speakers as Record<string, unknown>[]).filter(
        (speaker) => speaker.id !== "speaker-rin",
      )),
      { id: "speaker-rin", name: "リン", characterId: "character-rin", voiceProfileId: null },
    ];
    const migrated = parseContentDocument(migrateContentDocument(input));
    expect(migrated.characters[0]!.voices).toEqual([]);
  });

  it("returns the input unchanged for the current version", () => {
    const current = validContentDocument();
    expect(migrateContentDocument(current)).toBe(current);
  });

  it("does not rescue an unsupported schema version", () => {
    const doc = { ...validContentDocument(), schemaVersion: 3 };
    expect(() => parseContentDocument(migrateContentDocument(doc))).toThrow();
  });
});
