import { describe, expect, it } from "vitest";
import { createInitialContentDocument } from "@kakeai/contracts";
import { deserializeContent, serializeContent } from "./content-json.ts";

function v4Json(): string {
  const doc = createInitialContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 4;
  delete doc.visualTheme;
  doc.scenes = (doc.scenes as Record<string, unknown>[]).map((scene) => {
    const copy = { ...scene };
    delete copy.label;
    copy.accentColor = "#2563EB";
    delete copy.accent;
    return copy;
  });
  return JSON.stringify(doc);
}

function v5Json(): string {
  const doc = createInitialContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 5;
  delete doc.visualTheme;
  doc.scenes = (doc.scenes as Record<string, unknown>[]).map((scene) => {
    const copy = { ...scene };
    copy.accentColor = "#16A34A";
    delete copy.accent;
    return copy;
  });
  return JSON.stringify(doc);
}

describe("deserializeContent", () => {
  it("migrates a stored v4 document to the current schema", () => {
    const content = deserializeContent(v4Json());
    expect(content.schemaVersion).toBe(8);
    expect(content.visualTheme).toEqual({ id: "soft-editorial", version: 1 });
    expect(content.scenes.map((scene) => scene.label)).toEqual(["導入", "要点 1", "結び"]);
    for (const scene of content.scenes) {
      expect(scene.accent).toEqual({ kind: "theme", token: "primary" });
    }
  });

  it("migrates a stored v5 document to the current schema", () => {
    const content = deserializeContent(v5Json());
    expect(content.schemaVersion).toBe(8);
    expect(content.visualTheme).toEqual({ id: "soft-editorial", version: 1 });
    for (const scene of content.scenes) {
      expect(scene.accent).toEqual({ kind: "theme", token: "primary" });
    }
  });

  it("round-trips the current schema", () => {
    const content = deserializeContent(serializeContent(createInitialContentDocument()));
    expect(content.schemaVersion).toBe(8);
  });
});
