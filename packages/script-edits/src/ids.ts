import type { ScriptIdGenerator } from "./context.ts";
import { idGenerationFailed } from "./errors.ts";

const HEX = "0123456789abcdef";

function idTail(id: string): string {
  const parts = id.split("-");
  return parts[parts.length - 1] ?? "x";
}

export function createIdGenerator(random: () => number = Math.random): ScriptIdGenerator {
  const token = (length: number): string => {
    let value = "";
    for (let index = 0; index < length; index += 1) {
      value += HEX[Math.floor(random() * HEX.length)] ?? "0";
    }
    return value;
  };

  const unique = (prefix: (token: string) => string, existing: ReadonlySet<string>): string => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = prefix(token(6));
      if (!existing.has(id)) {
        return id;
      }
    }
    throw idGenerationFailed();
  };

  return {
    scene: (existing) => unique((value) => `scene-${value}`, existing),
    line: (sceneId, existing) =>
      unique((value) => `line-${idTail(sceneId)}-${value}`, existing),
    cue: (sceneId, suffix, existing) =>
      unique((value) => `visual-${sceneId}-${suffix}-${value}`, existing),
    audioTake: (lineId, existing) =>
      unique((value) => `take-${lineId}-${value}`, existing),
  };
}
