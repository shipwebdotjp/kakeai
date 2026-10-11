import { describe, expect, it } from "vitest";
import { parseContentDocument } from "./document";
import { migrateContentDocument } from "./migrate";
import { validContentDocument } from "../testing/fixtures";

function v4Document(): Record<string, unknown> {
  const doc = validContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 4;
  doc.scenes = (doc.scenes as Record<string, unknown>[]).map((scene) => {
    const copy = { ...scene };
    delete copy.label;
    return copy;
  });
  return doc;
}

describe("migrateContentDocument", () => {
  it("adds default labels to a v4 document", () => {
    const migrated = parseContentDocument(migrateContentDocument(v4Document()));
    expect(migrated.schemaVersion).toBe(5);
    expect(migrated.scenes.map((scene) => scene.label)).toEqual([
      "導入",
      "要点 1",
      "要点 2",
      "要点 3",
      "結び",
    ]);
  });

  it("keeps an existing label", () => {
    const input = v4Document();
    (input.scenes as Record<string, unknown>[])[1]!.label = "独自名";
    const migrated = parseContentDocument(migrateContentDocument(input));
    expect(migrated.scenes[1]!.label).toBe("独自名");
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
