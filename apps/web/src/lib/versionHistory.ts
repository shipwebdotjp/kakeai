import type { ScriptVersionAuthor, VisualThemeRef } from "@kakeai/contracts";
import type { SceneKind } from "../content/labels";

export const AGENT_ID_DISPLAY_MAX_LENGTH = 24;

export interface VersionOutlineLine {
  id: string;
  captionText: string;
  speechText: string;
}

export interface VersionOutlineScene {
  id: string;
  kind: SceneKind;
  label: string;
  lineCount: number;
  lines: VersionOutlineLine[];
}

export interface VersionOutline {
  locale: string;
  template: { id: string; version: number };
  visualTheme: VisualThemeRef;
  sceneCount: number;
  lineCount: number;
  audioTakeCount: number;
  visualCueCount: number;
  audioCueCount: number;
  scenes: VersionOutlineScene[];
}

/**
 * The subset of a ContentDocument needed to outline a saved Script Version.
 * ContentDocument is structurally assignable to it.
 */
export interface VersionOutlineSource {
  locale: string;
  template: { id: string; version: number };
  visualTheme: VisualThemeRef;
  scenes: readonly {
    id: string;
    kind: VersionOutlineScene["kind"];
    label: string;
    lines: readonly { id: string; captionText: string; speechText: string }[];
    visualCues: readonly unknown[];
  }[];
  audioTakes: readonly unknown[];
  audioCues: readonly unknown[];
}

export function isAgentAuthored(author: ScriptVersionAuthor): boolean {
  return author === "agent";
}

/** Shortens a long agent identifier for dense lists. The full value stays available via title text. */
export function abbreviateAgentId(
  agentId: string,
  maxLength: number = AGENT_ID_DISPLAY_MAX_LENGTH,
): string {
  const trimmed = agentId.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength))}…`;
}

/** Caption wins when both caption and speech text are present. */
export function lineDisplayText(line: { captionText: string; speechText: string }): string {
  if (line.captionText.length > 0) {
    return line.captionText;
  }
  if (line.speechText.length > 0) {
    return line.speechText;
  }
  return "（セリフなし）";
}

export function buildVersionOutline(content: VersionOutlineSource): VersionOutline {
  const scenes = content.scenes.map((scene) => ({
    id: scene.id,
    kind: scene.kind,
    label: scene.label,
    lineCount: scene.lines.length,
    lines: scene.lines.map((line) => ({
      id: line.id,
      captionText: line.captionText.trim(),
      speechText: line.speechText.trim(),
    })),
  }));

  return {
    locale: content.locale,
    template: { id: content.template.id, version: content.template.version },
    visualTheme: content.visualTheme,
    sceneCount: scenes.length,
    lineCount: scenes.reduce((total, scene) => total + scene.lineCount, 0),
    audioTakeCount: content.audioTakes.length,
    visualCueCount: content.scenes.reduce((total, scene) => total + scene.visualCues.length, 0),
    audioCueCount: content.audioCues.length,
    scenes,
  };
}
