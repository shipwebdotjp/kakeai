import {
  textBlockV1,
  type ContentDocument,
  type ScriptOperation,
} from "@kakeai/contracts";
import type { DocumentFormValues } from "../form";
import {
  applyStructuralOperations,
  type StructuralAsset,
  type StructuralEditResult,
} from "./common";

const NEW_SCENE_KEY = "new-point-scene";

const DEFAULT_TEXT_CUES = [
  { role: "heading", order: 0 },
  { role: "body", order: 1 },
] as const;

/**
 * Adds a point scene and the empty heading/body text cues the Web editor shows
 * by default. The operation core creates an empty scene; the editor composes
 * the default cues explicitly so Agent Access never receives them.
 */
export function addPointSceneStructural(
  base: ContentDocument,
  values: DocumentFormValues,
  index: number,
  assets: readonly StructuralAsset[] = [],
): StructuralEditResult {
  const operations: ScriptOperation[] = [
    { op: "scene.add", kind: "point", key: NEW_SCENE_KEY, index },
    ...DEFAULT_TEXT_CUES.map(
      (cue): ScriptOperation => ({
        op: "cue.add",
        sceneId: { key: NEW_SCENE_KEY },
        template: { id: textBlockV1.id, version: textBlockV1.version },
        range: { kind: "scene" },
        layer: "overlay",
        order: cue.order,
        input: { text: "", role: cue.role },
      }),
    ),
  ];
  return applyStructuralOperations(base, values, operations, assets);
}
