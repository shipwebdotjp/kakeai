import { type SceneFormValue } from "../../content/form";
import type { ScenePickerTarget } from "../ScenePickerModal";

export function isMiddleScene(
  kind: SceneFormValue["kind"] | undefined,
): boolean {
  return kind === "point" || kind === "insert";
}

export function hasConfiguredStanding(standing: {
  characterId: string | null;
  appearanceId: string | null;
}): boolean {
  return standing.characterId !== null && standing.appearanceId !== null;
}

export function pickerTargets(
  scenes: readonly SceneFormValue[],
): ScenePickerTarget[] {
  return scenes
    .filter((scene) => scene.kind !== "insert")
    .map((scene) => ({
      id: scene.id,
      label: scene.label,
      kind: scene.kind,
      lineCount: scene.lines.length,
      cueCount: scene.cues.length,
      standingCount: scene.standings.filter(hasConfiguredStanding).length,
    }));
}

export function sceneHasStandings(scene: SceneFormValue): boolean {
  return scene.standings.some(hasConfiguredStanding);
}

export const SCENE_TRANSITION_LABELS: Record<string, string> = {
  cut: "カット",
  fade: "フェード",
  crossfade: "クロスフェード",
};
