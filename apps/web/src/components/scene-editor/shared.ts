import { type SceneFormValue } from "../../content/form";

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

export function sceneHasStandings(scene: SceneFormValue): boolean {
  return scene.standings.some(hasConfiguredStanding);
}

export const SCENE_TRANSITION_LABELS: Record<string, string> = {
  cut: "カット",
  fade: "フェード",
  crossfade: "クロスフェード",
};
