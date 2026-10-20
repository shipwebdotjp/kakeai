import { describe, expect, it } from "vitest";
import { createInitialContentDocument } from "@kakeai/contracts";
import { deserializeContent, serializeContent } from "./content-json.ts";

function staleJson(): string {
  const doc = createInitialContentDocument() as unknown as Record<string, unknown>;
  doc.schemaVersion = 8;
  return JSON.stringify(doc);
}

describe("deserializeContent", () => {
  it("rejects a stored document with a non-current schemaVersion", () => {
    expect(() => deserializeContent(staleJson())).toThrow();
  });

  it("round-trips the current schema", () => {
    const content = deserializeContent(serializeContent(createInitialContentDocument()));
    expect(content.schemaVersion).toBe(1);
  });
});
