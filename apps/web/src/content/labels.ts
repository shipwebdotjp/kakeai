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

/**
 * Message dropdown labels for chat effects. Reads the serialized `messages`
 * field without assuming the rest of the form shape.
 */
export function messageTargetLabels(
  values: Record<string, string>,
): string[] | undefined {
  const raw = values.messages;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed.map((entry, index) => {
      const body =
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { body?: unknown }).body === "string"
          ? (entry as { body: string }).body
          : "";
      const first = body.split("\n")[0]!.trim();
      if (first.length === 0) {
        return `メッセージ ${index + 1}`;
      }
      return first.length > 24 ? `${first.slice(0, 24)}…` : first;
    });
  } catch {
    return undefined;
  }
}

/**
 * Turn dropdown labels for terminal effects. Reads the serialized `turns`
 * field without assuming the rest of the form shape.
 */
export function terminalTurnTargetLabels(
  values: Record<string, string>,
): string[] | undefined {
  const raw = values.turns;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return undefined;
    }
    return parsed.map((entry, index) => {
      const input =
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { input?: unknown }).input === "string"
          ? (entry as { input: string }).input
          : "";
      const first = input.split("\n")[0]!.trim();
      if (first.length === 0) {
        return `ターン ${index + 1}`;
      }
      return first.length > 24 ? `${first.slice(0, 24)}…` : first;
    });
  } catch {
    return undefined;
  }
}

export const TEXT_ROLE_LABELS: Record<TextRole, string> = {
  title: "タイトル",
  subtitle: "サブタイトル",
  heading: "見出し",
  body: "本文",
  closing: "結び",
  label: "ラベル",
};
