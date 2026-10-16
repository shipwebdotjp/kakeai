import type { ContentDocument } from "./document";
import { getVisualTemplate } from "../templates";

export interface DocumentLineReference {
  sceneId: string;
  lineId: string;
  path: (string | number)[];
}

export function collectLineReferences(document: ContentDocument): DocumentLineReference[] {
  const references: DocumentLineReference[] = [];

  document.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      const definition = getVisualTemplate(cue.template.id, cue.template.version);
      if (definition?.collectLineRefs === undefined) {
        return;
      }
      const basePath = ["scenes", sceneIndex, "visualCues", cueIndex, "input"];
      for (const reference of definition.collectLineRefs(cue.input, basePath)) {
        references.push({
          sceneId: scene.id,
          lineId: reference.lineId,
          path: reference.path,
        });
      }
    });
  });

  return references;
}
