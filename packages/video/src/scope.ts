export interface RenderScope {
  id(suffix: string): string;
  child(key: string): RenderScope;
}

const FNV_PRIME = 0x01000193;

export function fnv1a32(value: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function digestId(value: string): string {
  const high = fnv1a32(value, 0x811c9dc5).toString(16).padStart(8, "0");
  const low = fnv1a32(value, 0x01000193).toString(16).padStart(8, "0");
  return `${high}${low}`;
}

function sanitize(part: string): string {
  return part.replace(/[^A-Za-z0-9_-]/g, "_");
}

function makeScope(prefix: string): RenderScope {
  return {
    id: (suffix) => `${prefix}-${sanitize(suffix)}`,
    child: (key) => makeScope(`${prefix}-${sanitize(key)}`),
  };
}

export function cueScope(cueId: string): RenderScope {
  return makeScope(`kakeai-${digestId(cueId)}`);
}
