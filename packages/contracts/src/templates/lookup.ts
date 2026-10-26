import type { VisualTemplateDefinition } from "./shared";

/**
 * Registry of VisualTemplate definitions. `registry.ts` calls
 * `setVisualTemplateRegistry` once, after building the map. The nested-ref
 * collectors are only called at runtime, after that initialization; a lookup
 * before initialization is a wiring bug, so it fails loudly instead of
 * silently dropping references.
 */
let registry: ReadonlyMap<string, VisualTemplateDefinition> | undefined;

export function templateRegistryKey(id: string, version: number): string {
  return `${id}@${version}`;
}

export function setVisualTemplateRegistry(
  map: ReadonlyMap<string, VisualTemplateDefinition>,
): void {
  registry = map;
}

export function lookupVisualTemplate(
  id: string,
  version: number,
): VisualTemplateDefinition | undefined {
  if (registry === undefined) {
    throw new Error(
      "Visual template registry is not initialized; evaluate ./registry before resolving templates",
    );
  }
  return registry.get(templateRegistryKey(id, version));
}
