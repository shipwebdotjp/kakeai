import { contentDocumentSchema, parseContentDocument, type ContentDocument } from "@kakeai/contracts";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortKeysDeep(entry)]));
  }
  return value;
}

export function serializeContent(content: ContentDocument): string {
  return JSON.stringify(sortKeysDeep(contentDocumentSchema.parse(content)));
}

export function deserializeContent(contentJson: string): ContentDocument {
  return parseContentDocument(JSON.parse(contentJson));
}
