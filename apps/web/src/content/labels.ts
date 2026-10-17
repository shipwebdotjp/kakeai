import type { TextRole } from "@kakeai/contracts";

export type SceneKind = "intro" | "point" | "outro" | "insert";

export const SCENE_LABELS: Record<SceneKind, string> = {
  intro: "導入",
  point: "要点",
  outro: "結び",
  insert: "動画",
};

export const TEXT_ROLE_LABELS: Record<TextRole, string> = {
  title: "タイトル",
  subtitle: "サブタイトル",
  heading: "見出し",
  body: "本文",
  closing: "結び",
  label: "ラベル",
};
