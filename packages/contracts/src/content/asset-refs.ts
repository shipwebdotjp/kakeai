import type { ContentDocument } from "./document";
import { assetBearingTemplateKeys, getVisualTemplate } from "../templates";

export type AssetKindName = "image" | "video" | "audio";

export interface AssetReference {
  assetId: string;
  allowedKinds: readonly AssetKindName[];
  path: (string | number)[];
}

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
      if (!assetBearingTemplateKeys.has(`${cue.template.id}@${cue.template.version}`)) {
        return;
      }
      const definition = getVisualTemplate(cue.template.id, cue.template.version);
      if (!definition) {
        return;
      }
      const parsed = definition.inputSchema.safeParse(cue.input);
      if (!parsed.success) {
        return;
      }
      const assetId = (parsed.data as { assetId?: unknown }).assetId;
      if (typeof assetId !== "string") {
        return;
      }
      references.push({
        assetId,
        allowedKinds: ["image", "video"],
        path: ["scenes", sceneIndex, "visualCues", cueIndex, "input", "assetId"],
      });
    });
  });

  return references;
}
