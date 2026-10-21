import { defaultPointLabel, type TextRole } from "@kakeai/contracts";

export type SceneKind = "intro" | "point" | "outro" | "insert";

export const SCENE_LABELS: Record<SceneKind, string> = {
  intro: "導入",
  point: "要点",
  outro: "結び",
  insert: "動画",
};

export interface SceneDisplaySource {
  kind: SceneKind;
  label: string;
}

/**
 * 編集用のScene表示名。ラベルが空なら種別の既定名（要点は通し番号付き）を使う。
 * 左ペインのSceneレールと「追加位置」の選択肢で同じ名前を出すために共有する。
 */
export function sceneDisplayName(
  scene: SceneDisplaySource,
  pointOrdinal: number,
): string {
  const label = scene.label.trim();
  if (label.length > 0) {
    return label;
  }
  if (scene.kind === "point") {
    return defaultPointLabel(pointOrdinal);
  }
  return SCENE_LABELS[scene.kind] ?? scene.kind;
}

export const TEXT_ROLE_LABELS: Record<TextRole, string> = {
  title: "タイトル",
  subtitle: "サブタイトル",
  heading: "見出し",
  body: "本文",
  closing: "結び",
  label: "ラベル",
};
