import type { ContentDocument } from "@kakeai/contracts";
import type { ScriptAssetInfo, ScriptContext } from "./context.ts";

export interface TestContextOptions {
  voiceProfiles?: Record<string, ContentDocument["locale"]>;
  selectableThemes?: Record<string, readonly number[]>;
}

export function createTestContext(
  assets: Record<string, ScriptAssetInfo> = {},
  options: TestContextOptions = {},
): ScriptContext {
  let sceneCount = 0;
  let lineCount = 0;
  let cueCount = 0;
  let audioCount = 0;
  let characterCount = 0;
  let appearanceCount = 0;
  let speakerCount = 0;
  const voiceProfiles =
    options.voiceProfiles === undefined
      ? undefined
      : {
          get: (voiceProfileId: string) => {
            const locale = options.voiceProfiles?.[voiceProfileId];
            return locale === undefined ? null : { id: voiceProfileId, locale };
          },
        };
  const themes =
    options.selectableThemes === undefined
      ? undefined
      : {
          isSelectable: (themeId: string, version: number) =>
            (options.selectableThemes?.[themeId] ?? []).includes(version),
        };
  return {
    assets: { get: (assetId) => assets[assetId] ?? null },
    voiceProfiles,
    themes,
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
      character: (existing) => {
        let id = `character-new-${(characterCount += 1)}`;
        while (existing.has(id)) {
          id = `character-new-${(characterCount += 1)}`;
        }
        return id;
      },
      appearance: (existing) => {
        let id = `appearance-new-${(appearanceCount += 1)}`;
        while (existing.has(id)) {
          id = `appearance-new-${(appearanceCount += 1)}`;
        }
        return id;
      },
      speaker: (existing) => {
        let id = `speaker-new-${(speakerCount += 1)}`;
        while (existing.has(id)) {
          id = `speaker-new-${(speakerCount += 1)}`;
        }
        return id;
      },
    },
  };
}
