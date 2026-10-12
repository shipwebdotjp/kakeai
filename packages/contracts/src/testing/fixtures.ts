import type { ContentDocument } from "../content/document";
import { CONTENT_SCHEMA_VERSION, TEMPLATE_ID, TEMPLATE_VERSION } from "../content/document";
import { SUPPORTED_LOCALES } from "../content/primitives";
import { DEFAULT_VISUAL_THEME_REF } from "../content/theme";
import type { VisualCue } from "../content/visual";
import { textBlockV1, type TextRole } from "../templates";

function textCue(id: string, role: TextRole, text: string, order: number): VisualCue {
  return {
    id,
    template: { id: textBlockV1.id, version: textBlockV1.version },
    range: { kind: "scene" },
    layer: "overlay",
    order,
    transition: {
      enter: { preset: "fade", durationMs: 350 },
      exit: { preset: "none", durationMs: 0 },
    },
    input: { text, role },
  };
}

export function validContentDocument(): ContentDocument {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    visualTheme: { ...DEFAULT_VISUAL_THEME_REF },
    locale: SUPPORTED_LOCALES[0],
    template: { id: TEMPLATE_ID, version: TEMPLATE_VERSION },
    speakers: [{ id: "speaker-narrator", name: "ナレーター", characterId: null, voiceProfileId: null }],
    characters: [],
    audioTakes: [
      {
        id: "take-line-p1-1",
        narrationSegmentId: "line-p1-1",
        source: "manual",
        assetId: "asset-audio-1",
        durationMs: 3000,
      },
    ],
    scenes: [
      {
        id: "scene-intro",
        kind: "intro",
        label: "導入",
        accent: { kind: "theme", token: "primary" },
        timing: { mode: "fixed", durationMs: 4000 },
        lines: [],
        visualCues: [
          {
            id: "vc-intro-bg",
            template: { id: "media.full-bleed", version: 1 },
            range: { kind: "scene" },
            layer: "background",
            order: 0,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: { assetId: "asset-bg", fit: "cover" },
          },
          textCue("vc-intro-title", "title", "タイトル", 0),
          textCue("vc-intro-subtitle", "subtitle", "サブタイトル", 1),
        ],
      },
      {
        id: "scene-point-1",
        kind: "point",
        label: "要点 1",
        accent: { kind: "theme", token: "primary" },
        timing: { mode: "auto" },
        lines: [
          {
            id: "line-p1-1",
            speakerId: "speaker-narrator",
            captionText: "最初の要点です。",
            speechText: "さいしょのようてんです。",
            selectedAudioTakeId: "take-line-p1-1",
          },
        ],
        visualCues: [
          textCue("vc-p1-heading", "heading", "見出し1", 0),
          textCue("vc-p1-body", "body", "本文1", 1),
        ],
      },
      {
        id: "scene-point-2",
        kind: "point",
        label: "要点 2",
        accent: { kind: "theme", token: "secondary" },
        timing: { mode: "auto" },
        lines: [],
        visualCues: [
          textCue("vc-p2-heading", "heading", "見出し2", 0),
          textCue("vc-p2-body", "body", "本文2", 1),
        ],
      },
      {
        id: "scene-point-3",
        kind: "point",
        label: "要点 3",
        accent: { kind: "theme", token: "tertiary" },
        timing: { mode: "auto" },
        lines: [],
        visualCues: [
          textCue("vc-p3-heading", "heading", "見出し3", 0),
          textCue("vc-p3-body", "body", "本文3", 1),
        ],
      },
      {
        id: "scene-outro",
        kind: "outro",
        label: "結び",
        accent: { kind: "theme", token: "primary" },
        timing: { mode: "fixed", durationMs: 4000 },
        lines: [],
        visualCues: [textCue("vc-outro-closing", "closing", "結びの文言", 0)],
      },
    ],
    audioCues: [
      {
        id: "bgm-main",
        role: "bgm",
        assetId: "asset-bgm",
        range: { kind: "work" },
        gainDb: -18,
        loop: true,
      },
    ],
  };
}
