import type { ScriptAssetInfo, ScriptContext } from "./context.ts";

export function createTestContext(
  assets: Record<string, ScriptAssetInfo> = {},
): ScriptContext {
  let sceneCount = 0;
  let lineCount = 0;
  let cueCount = 0;
  let audioCount = 0;
  return {
    assets: { get: (assetId) => assets[assetId] ?? null },
    ids: {
      scene: (existing) => {
        let id = `scene-new-${(sceneCount += 1)}`;
        while (existing.has(id)) {
          id = `scene-new-${(sceneCount += 1)}`;
        }
        return id;
      },
      line: (sceneId, existing) => {
        let id = `line-${sceneId}-${(lineCount += 1)}`;
        while (existing.has(id)) {
          id = `line-${sceneId}-${(lineCount += 1)}`;
        }
        return id;
      },
      cue: (sceneId, suffix, existing) => {
        let id = `visual-${sceneId}-${suffix}-${(cueCount += 1)}`;
        while (existing.has(id)) {
          id = `visual-${sceneId}-${suffix}-${(cueCount += 1)}`;
        }
        return id;
      },
      audioCue: (existing) => {
        let id = `audio-new-${(audioCount += 1)}`;
        while (existing.has(id)) {
          id = `audio-new-${(audioCount += 1)}`;
        }
        return id;
      },
      audioTake: (lineId) => `take-${lineId}-new`,
    },
  };
}
