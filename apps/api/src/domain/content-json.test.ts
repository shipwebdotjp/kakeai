import { describe, expect, it } from "vitest";
import { createInitialContentDocument } from "@kakeai/contracts";
import { deserializeContent, serializeContent } from "./content-json.ts";

function v4Json(): string {
  const doc = createInitialContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 4;
  doc.scenes = (doc.scenes as Record<string, unknown>[]).map((scene) => {
    const copy = { ...scene };
    delete copy.label;
    return copy;
  });
  return JSON.stringify(doc);
}

describe("deserializeContent", () => {
  it("migrates a stored v4 document to the current schema", () => {
    const content = deserializeContent(v4Json());
    expect(content.schemaVersion).toBe(5);
    expect(content.scenes.map((scene) => scene.label)).toEqual(["導入", "要点 1", "結び"]);
  });

  it("round-trips the current schema", () => {
    const content = deserializeContent(serializeContent(createInitialContentDocument()));
    expect(content.schemaVersion).toBe(5);
  });
});
