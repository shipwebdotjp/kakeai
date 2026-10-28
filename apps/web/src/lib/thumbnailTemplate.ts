import { getThumbnailTemplate, listThumbnailTemplateCatalog } from "@kakeai/contracts";

/** Immutable catalogue shared by the thumbnail page and candidate form. */
export const THUMBNAIL_TEMPLATE_CATALOG = listThumbnailTemplateCatalog();

/** Builds the editable input shape for a template before any asset is chosen. */
export function defaultThumbnailInput(
  templateId: string,
  version: number,
): Record<string, unknown> {
  const definition = getThumbnailTemplate(templateId, version);
  const input: Record<string, unknown> = { ...(definition?.uiDefaults ?? {}) };
  for (const field of definition?.inputFields ?? []) {
    if (field.kind === "select" && field.optional !== true) {
      const first = field.options[0];
      if (first !== undefined && input[field.key] === undefined) {
        input[field.key] = first.value;
      }
    } else if (
      field.kind === "text" ||
      (field.kind === "richText" && field.optional !== true)
    ) {
      if (input[field.key] === undefined) {
        input[field.key] = "";
      }
    } else if (field.kind === "boolean" && input[field.key] === undefined) {
      input[field.key] = false;
    }
  }
  return input;
}

/**
 * Existing candidates may predate optional inputs. Fill missing values from the
 * template's UI defaults without overwriting saved values.
 */
export function thumbnailInputWithDefaults(
  templateId: string,
  version: number,
  input: unknown,
): Record<string, unknown> {
  const saved =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  return { ...defaultThumbnailInput(templateId, version), ...saved };
}
