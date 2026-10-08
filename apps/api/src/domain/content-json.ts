import { contentDocumentSchema, type ContentDocument } from "@kakeai/contracts";

export function serializeContent(content: ContentDocument): string {
  return JSON.stringify(contentDocumentSchema.parse(content));
}

export function deserializeContent(contentJson: string): ContentDocument {
  return contentDocumentSchema.parse(JSON.parse(contentJson));
}
