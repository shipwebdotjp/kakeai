import type { ContentDocument } from "./document";
import { getVisualTemplate } from "../templates";
import { collectVideoPlaybackLineRefs } from "./video-playback";

export interface DocumentLineReference {
  sceneId: string;
  lineId: string;
  path: (string | number)[];
}

export function collectLineReferences(document: ContentDocument): DocumentLineReference[] {
  const references: DocumentLineReference[] = [];
  const seen = new Set<string>();

  const push = (sceneId: string, lineId: string, path: (string | number)[]): void => {
    const key = `${path.join("/")}|${lineId}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    references.push({ sceneId, lineId, path });
  };

  document.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      const basePath = ["scenes", sceneIndex, "visualCues", cueIndex, "input"];
      const definition = getVisualTemplate(cue.template.id, cue.template.version);
      if (definition?.collectLineRefs !== undefined) {
        for (const reference of definition.collectLineRefs(cue.input, basePath)) {
          push(scene.id, reference.lineId, reference.path);
        }
      }
      for (const reference of collectVideoPlaybackLineRefs(cue.input, basePath)) {
        push(scene.id, reference.lineId, reference.path);
      }
    });
  });

  return references;
}
