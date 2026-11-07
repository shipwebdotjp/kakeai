import {
  liveCharacterSheetSchema,
  livePackageShowSchema,
  type LiveCharacterSheet,
  type LivePackageShow,
} from "@kakeai/contracts";
import { packageUrl } from "./elements";

export interface StagePackageData {
  show: LivePackageShow | null;
  characters: LiveCharacterSheet | null;
}

async function fetchJson(path: string): Promise<unknown | null> {
  try {
    const response = await fetch(path, { cache: "force-cache" });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Loads and validates the package metadata the stage needs to draw itself. */
export async function loadStagePackageData(): Promise<StagePackageData> {
  const [rawShow, rawCharacters] = await Promise.all([
    fetchJson("/package/show.json"),
    fetchJson("/package/characters.json"),
  ]);
  const show = livePackageShowSchema.safeParse(rawShow);
  const characters = liveCharacterSheetSchema.safeParse(rawCharacters);
  return {
    show: show.success ? show.data : null,
    characters: characters.success ? characters.data : null,
  };
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => resolve(), { once: true });
    image.src = url;
  });
}

/** Preloads appearance and face-layer images; failures keep the placeholder. */
export async function preloadCharacterImages(sheet: LiveCharacterSheet): Promise<void> {
  const urls = new Set<string>();
  for (const character of sheet.characters) {
    for (const appearance of character.appearances) {
      urls.add(appearance.image);
    }
  }
  for (const faceSet of sheet.faceSets) {
    for (const layer of faceSet.layers) {
      urls.add(layer.file);
      if (layer.blinkFile !== undefined) {
        urls.add(layer.blinkFile);
      }
      if (layer.speakingFile !== undefined) {
        urls.add(layer.speakingFile);
      }
    }
  }
  await Promise.all([...urls].map((path) => loadImage(packageUrl(path))));
}

/** Resolves after the theme fonts are ready, or after a short fallback wait. */
export async function preloadFonts(timeoutMs = 3000): Promise<void> {
  if (document.fonts === undefined) {
    return;
  }
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // A font failure must not block stage_ready; the theme has fallbacks.
  }
}
