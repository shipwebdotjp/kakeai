import { CONTENT_SCHEMA_VERSION, TEMPLATE_ID, TEMPLATE_VERSION, type ContentDocument } from "./document";
import { SUPPORTED_LOCALES } from "./primitives";

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
        slots: { title: "", subtitle: "" },
        lines: [],
        visualCues: [],
      },
      {
        id: DEFAULT_SCENE_IDS.point1,
        kind: "point",
        accentColor: DEFAULT_ACCENT_COLORS.point1,
        timing: { mode: "auto" },
        slots: { heading: "", body: "" },
        lines: [],
        visualCues: [],
      },
      {
        id: DEFAULT_SCENE_IDS.point2,
        kind: "point",
        accentColor: DEFAULT_ACCENT_COLORS.point2,
        timing: { mode: "auto" },
        slots: { heading: "", body: "" },
        lines: [],
        visualCues: [],
      },
      {
        id: DEFAULT_SCENE_IDS.point3,
        kind: "point",
        accentColor: DEFAULT_ACCENT_COLORS.point3,
        timing: { mode: "auto" },
        slots: { heading: "", body: "" },
        lines: [],
        visualCues: [],
      },
      {
        id: DEFAULT_SCENE_IDS.outro,
        kind: "outro",
        accentColor: DEFAULT_ACCENT_COLORS.outro,
        timing: { mode: "fixed", durationMs: OUTRO_FIXED_DURATION_MS },
        slots: { closing: "" },
        lines: [],
        visualCues: [],
      },
    ],
    audioCues: [],
  };
}
