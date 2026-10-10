import { CONTENT_SCHEMA_VERSION, TEMPLATE_ID, TEMPLATE_VERSION, type ContentDocument } from "./document";
import { SUPPORTED_LOCALES } from "./primitives";
import type { PointScene } from "./scene";
import type { VisualCue } from "./visual";
import { textBlockV1, type TextRole } from "../templates";

export const DEFAULT_SCENE_IDS = {
  intro: "scene-intro",
  point1: "scene-point-1",
  point2: "scene-point-2",
  point3: "scene-point-3",
  outro: "scene-outro",
} as const;

export const DEFAULT_ACCENT_COLORS = {
  intro: "#2563EB",
  point1: "#2563EB",
  point2: "#16A34A",
  point3: "#DC2626",
  outro: "#2563EB",
} as const;

export const INTRO_FIXED_DURATION_MS = 4000;
export const OUTRO_FIXED_DURATION_MS = 4000;
export const SCENE_PADDING_MS = 500;
export const SILENT_CAPTION_DURATION_MS = 2500;

export const DEFAULT_POINT_ACCENT_COLOR = DEFAULT_ACCENT_COLORS.point1;

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

export function createPointScene(sceneId: string): PointScene {
  return {
    id: sceneId,
    kind: "point",
    accentColor: DEFAULT_POINT_ACCENT_COLOR,
    timing: { mode: "auto" },
    lines: [],
    visualCues: pointSceneTextCues(sceneId),
  };
}

export function createInitialContentDocument(): ContentDocument {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    locale: SUPPORTED_LOCALES[0],
    template: { id: TEMPLATE_ID, version: TEMPLATE_VERSION },
    speakers: [],
    characters: [],
    audioTakes: [],
    scenes: [
      {
        id: DEFAULT_SCENE_IDS.intro,
        kind: "intro",
        accentColor: DEFAULT_ACCENT_COLORS.intro,
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
        accentColor: DEFAULT_ACCENT_COLORS.point1,
        timing: { mode: "auto" },
        lines: [],
        visualCues: pointSceneTextCues(DEFAULT_SCENE_IDS.point1),
      },
      {
        id: DEFAULT_SCENE_IDS.point2,
        kind: "point",
        accentColor: DEFAULT_ACCENT_COLORS.point2,
        timing: { mode: "auto" },
        lines: [],
        visualCues: pointSceneTextCues(DEFAULT_SCENE_IDS.point2),
      },
      {
        id: DEFAULT_SCENE_IDS.point3,
        kind: "point",
        accentColor: DEFAULT_ACCENT_COLORS.point3,
        timing: { mode: "auto" },
        lines: [],
        visualCues: pointSceneTextCues(DEFAULT_SCENE_IDS.point3),
      },
      {
        id: DEFAULT_SCENE_IDS.outro,
        kind: "outro",
        accentColor: DEFAULT_ACCENT_COLORS.outro,
        timing: { mode: "fixed", durationMs: OUTRO_FIXED_DURATION_MS },
        lines: [],
        visualCues: [textCue(DEFAULT_SCENE_IDS.outro, "closing", "closing", 0)],
      },
    ],
    audioCues: [],
  };
}
