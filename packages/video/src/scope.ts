export interface RenderScope {
  id(suffix: string): string;
  child(key: string): RenderScope;
}

function encodeId(value: string): string {
  let out = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    out += codePoint.toString(16).padStart(6, "0");
  }
  return out;
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
  return makeScope(`kakeai-${encodeId(cueId)}`);
}
