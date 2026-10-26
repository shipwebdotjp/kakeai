import {
  isLatestVisualThemeDefinition,
  type ContentDocument,
} from "@kakeai/contracts";
import type { ScriptContext } from "./context.ts";
import { targetNotFound } from "./errors.ts";
import type { SceneEditResult } from "./scene.ts";

export function setVisualTheme(
  document: ContentDocument,
  id: string,
  version: number,
  context: ScriptContext,
): SceneEditResult {
  const selectable =
    isLatestVisualThemeDefinition(id, version) ||
    (context.themes?.isSelectable(id, version) ?? false);
  if (!selectable) {
    throw targetNotFound(
      ["id"],
      `選択できないVisualThemeです: ${id}@${version}`,
    );
  }
  return {
    document: { ...document, visualTheme: { id, version } },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: `${id}@${version}`,
  };
}

export function setCaption(
  document: ContentDocument,
  showSpeakerName: boolean,
): SceneEditResult {
  return {
    document: { ...document, caption: { showSpeakerName } },
    sceneIds: [],
    lineIds: [],
    cueIds: [],
    primaryId: "caption",
  };
}
