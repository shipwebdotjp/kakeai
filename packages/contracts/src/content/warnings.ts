import type { Warning } from "../error";
import type { ContentDocument } from "./document";

export interface TextConstraint {
  maxLines: number;
  charsPerLine: number;
}

export const TEXT_CONSTRAINTS = {
  title: { maxLines: 2, charsPerLine: 18 },
  subtitle: { maxLines: 2, charsPerLine: 24 },
  heading: { maxLines: 2, charsPerLine: 16 },
  body: { maxLines: 6, charsPerLine: 28 },
  closing: { maxLines: 2, charsPerLine: 20 },
  captionText: { maxLines: 2, charsPerLine: 20 },
} as const satisfies Record<string, TextConstraint>;

function estimateLineCount(text: string, charsPerLine: number): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split("\n").reduce((total, line) => {
    const characters = [...line].length;
    return total + Math.max(1, Math.ceil(characters / charsPerLine));
  }, 0);
}

function overflowWarning(
  path: (string | number)[],
  label: string,
  text: string,
  constraint: TextConstraint,
): Warning | undefined {
  const lines = estimateLineCount(text, constraint.charsPerLine);
  if (lines <= constraint.maxLines) {
    return undefined;
  }
  return {
    path,
    code: "text_overflow",
    message: `${label}がテンプレートの目安（最大${constraint.maxLines}行）を超えています。プレビューで確認してください。`,
  };
}

export function computeContentWarnings(document: ContentDocument): Warning[] {
  const warnings: Warning[] = [];
  document.scenes.forEach((scene, sceneIndex) => {
    if (scene.kind === "intro") {
      const title = overflowWarning(
        ["scenes", sceneIndex, "slots", "title"],
        "タイトル",
        scene.slots.title,
        TEXT_CONSTRAINTS.title,
      );
      if (title) {
        warnings.push(title);
      }
      const subtitle = overflowWarning(
        ["scenes", sceneIndex, "slots", "subtitle"],
        "サブタイトル",
        scene.slots.subtitle,
        TEXT_CONSTRAINTS.subtitle,
      );
      if (subtitle) {
        warnings.push(subtitle);
      }
    } else if (scene.kind === "point") {
      const heading = overflowWarning(
        ["scenes", sceneIndex, "slots", "heading"],
        "見出し",
        scene.slots.heading,
        TEXT_CONSTRAINTS.heading,
      );
      if (heading) {
        warnings.push(heading);
      }
      const body = overflowWarning(
        ["scenes", sceneIndex, "slots", "body"],
        "本文",
        scene.slots.body,
        TEXT_CONSTRAINTS.body,
      );
      if (body) {
        warnings.push(body);
      }
    } else if (scene.kind === "outro") {
      const closing = overflowWarning(
        ["scenes", sceneIndex, "slots", "closing"],
        "結びの文言",
        scene.slots.closing,
        TEXT_CONSTRAINTS.closing,
      );
      if (closing) {
        warnings.push(closing);
      }
    }

    scene.lines.forEach((line, lineIndex) => {
      const caption = overflowWarning(
        ["scenes", sceneIndex, "lines", lineIndex, "captionText"],
        "字幕",
        line.captionText,
        TEXT_CONSTRAINTS.captionText,
      );
      if (caption) {
        warnings.push(caption);
      }
    });
  });
  return warnings;
}
