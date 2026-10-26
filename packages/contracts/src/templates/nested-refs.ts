import {
  MAX_NESTED_VISUAL_DEPTH,
  nestedCompositionVisualSchema,
  nestedTemplateVisualSchema,
  type NestedVisual,
} from "../content/nested";
import type { AssetReference } from "../content/asset-reference";
import { MEDIA_KINDS } from "./common";
import { lookupVisualTemplate } from "./lookup";

export function collectNestedAssetRefs(
  node: NestedVisual,
  path: (string | number)[],
  depth = 0,
): AssetReference[] {
  if (depth >= MAX_NESTED_VISUAL_DEPTH) {
    return [];
  }
  if (node.kind === "media") {
    return [{ assetId: node.assetId, allowedKinds: MEDIA_KINDS, path: [...path, "assetId"] }];
  }
  if (node.kind === "composition") {
    return [];
  }
  const definition = lookupVisualTemplate(node.template.id, node.template.version);
  if (!definition) {
    return [];
  }
  return definition.collectAssetRefs(node.input, [...path, "input"], depth + 1);
}

const MAX_COMPOSITION_REF_WALK_DEPTH = 64;

export function collectNestedCompositionVersionIds(
  value: unknown,
  depth = 0,
): string[] {
  if (depth > MAX_COMPOSITION_REF_WALK_DEPTH) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectNestedCompositionVersionIds(entry, depth + 1));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const composition = nestedCompositionVisualSchema.safeParse(value);
  if (composition.success) {
    return [composition.data.compositionVersionId];
  }
  const template = nestedTemplateVisualSchema.safeParse(value);
  if (template.success) {
    const definition = lookupVisualTemplate(
      template.data.template.id,
      template.data.template.version,
    );
    if (definition === undefined) {
      return [];
    }
    const parsed = definition.inputSchema.safeParse(template.data.input);
    if (!parsed.success) {
      return [];
    }
    return collectNestedCompositionVersionIds(parsed.data, depth + 1);
  }
  return Object.values(value).flatMap((entry) =>
    collectNestedCompositionVersionIds(entry, depth + 1),
  );
}
