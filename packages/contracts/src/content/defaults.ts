import { CONTENT_SCHEMA_VERSION, TEMPLATE_ID, TEMPLATE_VERSION, type ContentDocument } from "./document";
import { SUPPORTED_LOCALES } from "./primitives";
import type { PointScene, SceneAccent } from "./scene";
import type { VisualCue } from "./visual";
import { DEFAULT_VISUAL_THEME_REF, type VisualThemeRef } from "./theme";
import { textBlockV1, type TextRole } from "../templates";

export const DEFAULT_SCENE_IDS = {
  intro: "scene-intro",
  point1: "scene-point-1",
  outro: "scene-outro",
} as const;

export const DEFAULT_SCENE_ACCENT: SceneAccent = { kind: "theme", token: "primary" };

export const DEFAULT_VISUAL_THEME: VisualThemeRef = { ...DEFAULT_VISUAL_THEME_REF };

export function defaultPointLabel(ordinal: number): string {
  return `要点 ${ordinal}`;
}

export const DEFAULT_SCENE_LABELS = {
  intro: "導入",
  point1: defaultPointLabel(1),
  outro: "結び",
} as const;

export const INTRO_FIXED_DURATION_MS = 4000;
export const OUTRO_FIXED_DURATION_MS = 4000;
export const SCENE_PADDING_MS = 500;
export const SILENT_CAPTION_DURATION_MS = 2500;

function textCue(
  sceneId: string,
  suffix: string,
  role: TextRole,
  order: number,
): VisualCue {
  return {
    id: `visual-${sceneId}-text-${suffix}`,
    template: { id: textBlockV1.id, version: textBlockV1.version },
    range: { kind: "scene" },
    layer: "overlay",
    order,
    transition: {
      enter: { preset: "fade", durationMs: 350 },
      exit: { preset: "none", durationMs: 0 },
    },
    input: { text: "", role },
  };
}

export function pointSceneTextCues(sceneId: string): VisualCue[] {
  return [textCue(sceneId, "heading", "heading", 0), textCue(sceneId, "body", "body", 1)];
}

export function createPointScene(sceneId: string, label: string): PointScene {
  return {
    id: sceneId,
    kind: "point",
    label,
    accent: { ...DEFAULT_SCENE_ACCENT },
    timing: { mode: "auto" },
    lines: [],
    visualCues: pointSceneTextCues(sceneId),
  };
}

export function createInitialContentDocument(): ContentDocument {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    visualTheme: { ...DEFAULT_VISUAL_THEME },
    locale: SUPPORTED_LOCALES[0],
    template: { id: TEMPLATE_ID, version: TEMPLATE_VERSION },
    speakers: [],
    characters: [],
    audioTakes: [],
    scenes: [
      {
        id: DEFAULT_SCENE_IDS.intro,
        kind: "intro",
        label: DEFAULT_SCENE_LABELS.intro,
        accent: { ...DEFAULT_SCENE_ACCENT },
        timing: { mode: "fixed", durationMs: INTRO_FIXED_DURATION_MS },
        lines: [],
        visualCues: [
          textCue(DEFAULT_SCENE_IDS.intro, "title", "title", 0),
          textCue(DEFAULT_SCENE_IDS.intro, "subtitle", "subtitle", 1),
        ],
      },
      {
        id: DEFAULT_SCENE_IDS.point1,
        kind: "point",
        label: DEFAULT_SCENE_LABELS.point1,
        accent: { ...DEFAULT_SCENE_ACCENT },
        timing: { mode: "auto" },
        lines: [],
        visualCues: pointSceneTextCues(DEFAULT_SCENE_IDS.point1),
      },
      {
        id: DEFAULT_SCENE_IDS.outro,
        kind: "outro",
        label: DEFAULT_SCENE_LABELS.outro,
        accent: { ...DEFAULT_SCENE_ACCENT },
        timing: { mode: "fixed", durationMs: OUTRO_FIXED_DURATION_MS },
        lines: [],
        visualCues: [textCue(DEFAULT_SCENE_IDS.outro, "closing", "closing", 0)],
      },
    ],
    audioCues: [],
  };
}
