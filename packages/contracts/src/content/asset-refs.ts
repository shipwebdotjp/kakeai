import type { ContentDocument } from "./document";
import { getVisualTemplate } from "../templates";
import type { AssetReference } from "./asset-reference";

export function collectAssetReferences(document: ContentDocument): AssetReference[] {
  const references: AssetReference[] = [];

  document.characters.forEach((character, characterIndex) => {
    character.appearances.forEach((appearance, appearanceIndex) => {
      references.push({
        assetId: appearance.assetId,
        allowedKinds: ["image"],
        path: ["characters", characterIndex, "appearances", appearanceIndex, "assetId"],
      });
    });
  });

  document.audioTakes.forEach((take, takeIndex) => {
    references.push({
      assetId: take.assetId,
      allowedKinds: ["audio"],
      path: ["audioTakes", takeIndex, "assetId"],
    });
  });

  document.audioCues.forEach((cue, cueIndex) => {
    references.push({
      assetId: cue.assetId,
      allowedKinds: ["audio"],
      path: ["audioCues", cueIndex, "assetId"],
    });
  });

  document.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      const definition = getVisualTemplate(cue.template.id, cue.template.version);
      if (!definition) {
        return;
      }
      const path = ["scenes", sceneIndex, "visualCues", cueIndex, "input"];
      references.push(...definition.collectAssetRefs(cue.input, path, 0));
    });
  });

  return references;
}
