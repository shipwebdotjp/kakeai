import { getVisualTheme, type ContentDocument } from "@kakeai/contracts";
import { invalidOperation } from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";

export function setVisualTheme(
  document: ContentDocument,
  id: string,
  version: number,
): SceneEditResult {
  if (getVisualTheme(id, version) === undefined) {
    throw invalidOperation(["id"], `未対応のVisualThemeです: ${id}@${version}`);
  }
  return {
    document: { ...document, visualTheme: { id, version } },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: `${id}@${version}`,
  };
}
