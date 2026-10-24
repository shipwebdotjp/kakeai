import { getThumbnailTemplate } from "@kakeai/contracts";

/** Builds the editable input shape for a template before any asset is chosen. */
export function defaultThumbnailInput(
  templateId: string,
  version: number,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const definition = getThumbnailTemplate(templateId, version);
  for (const field of definition?.inputFields ?? []) {
    if (field.kind === "select" && field.optional !== true) {
      const first = field.options[0];
      if (first !== undefined) {
        input[field.key] = first.value;
      }
    } else if (
      field.kind === "text" ||
      (field.kind === "richText" && field.optional !== true)
    ) {
      input[field.key] = "";
    } else if (field.kind === "boolean") {
      input[field.key] = false;
    }
  }
  return input;
}
