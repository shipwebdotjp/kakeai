import {
  COMPOSITION_ENGINE,
  COMPILER_VERSION,
  HYPERFRAMES_PLAYER_VERSION,
  compileDocument,
  CompositionCompileError,
  resolveTimeline,
  resolveCueWindow,
  OUTPUT_FPS,
  type CompiledComposition,
} from "@kakeai/video";
import {
  CONTENT_SCHEMA_VERSION,
  SOFT_EDITORIAL_THEME_ID,
  SOFT_EDITORIAL_THEME_VERSION,
  draftPreviewSchema,
  type ContentDocument,
  type DraftPreview,
  type PreviewCueTiming,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { ApiError } from "../http/errors.ts";

export function createRepresentativeSampleDocument(themeDefinition: VisualThemeDefinition): ContentDocument {
  const themeRef = { id: themeDefinition.id, version: themeDefinition.version };

  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    locale: "ja-JP",
    visualTheme: themeRef,
    template: { id: "explanation-scenes", version: 1 },
    speakers: [],
    characters: [],
    audioTakes: [],
    audioCues: [],
    scenes: [
      {
        id: "scene-sample-intro",
        kind: "intro",
        label: "導入",
        timing: { mode: "fixed", durationMs: 4000 },
        accent: { kind: "theme", token: "primary" },
        lines: [],
        visualCues: [
          {
            id: "vc-title",
            template: { id: "text.block", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 0,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              text: "テーマプレビュー",
              role: "title",
              verticalAlign: "top",
            },
          },
          {
            id: "vc-subtitle",
            template: { id: "text.block", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 1,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              text: "代表サンプルの配色とフォントスタイル確認",
              role: "subtitle",
              verticalAlign: "middle",
            },
          },
        ],
      },
      {
        id: "scene-sample-point",
        kind: "point",
        label: "要点",
        timing: { mode: "auto" },
        accent: { kind: "theme", token: "secondary" },
        lines: [
          {
            id: "line-sample-1",
            speakerId: null,
            captionText: "字幕スタイルの表示サンプルです。",
            speechText: "じまくすたいるのひょうじさんぷるです。",
            selectedAudioTakeId: null,
            expressionId: null,
          },
        ],
        visualCues: [
          {
            id: "vc-heading",
            template: { id: "text.block", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 0,
            transition: {
              enter: { preset: "slide-up", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              text: "主要な見出しスタイル",
              role: "heading",
              verticalAlign: "top",
            },
          },
          {
            id: "vc-body",
            template: { id: "text.block", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 1,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              text: "本文テキストの行間や色の見え方を確認します。\nフォントや装飾が即座に反映されます。",
              role: "body",
              verticalAlign: "middle",
            },
          },
          {
            id: "vc-label",
            template: { id: "text.block", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 2,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              text: "LABEL",
              role: "label",
              verticalAlign: "bottom",
              anchor: "left",
            },
          },
        ],
      },
      {
        id: "scene-sample-outro",
        kind: "outro",
        label: "結び",
        timing: { mode: "fixed", durationMs: 3000 },
        accent: { kind: "theme", token: "tertiary" },
        lines: [],
        visualCues: [
          {
            id: "vc-closing",
            template: { id: "text.block", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 0,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              text: "ご視聴ありがとうございました",
              role: "closing",
              verticalAlign: "middle",
            },
          },
        ],
      },
    ],
  };
}

export function compileThemeRepresentativePreview(definition: VisualThemeDefinition): DraftPreview {
  const sampleDoc = createRepresentativeSampleDocument(definition);
  let compiled: CompiledComposition;
  let timeline;

  try {
    compiled = compileDocument({
      document: sampleDoc,
      resolvedTheme: definition,
      assetResolver: (assetId) => {
        throw new CompositionCompileError([
          { path: ["assets", assetId], code: "unresolvable_asset", message: "素材なし" },
        ]);
      },
    });

    const resolvedTimeline = resolveTimeline(sampleDoc);
    timeline = {
      totalDurationMs: resolvedTimeline.totalDurationMs,
      fps: OUTPUT_FPS,
      scenes: resolvedTimeline.scenes.map((placement) => {
        const scene = sampleDoc.scenes[placement.sceneIndex];
        const cues = scene?.visualCues.map((cue, cueIdx) => {
          const w = resolveCueWindow(placement, cue, ["scenes", placement.sceneIndex, "visualCues", cueIdx]);
          return w ? { cueId: cue.id, startMs: placement.startMs + w.startMs } : null;
        }).filter((item): item is PreviewCueTiming => item !== null) ?? [];

        return {
          sceneId: placement.sceneId,
          startMs: placement.startMs,
          durationMs: placement.durationMs,
          lines: placement.lines.map((line) => ({
            lineId: line.lineId,
            startMs: line.startMs,
            durationMs: line.durationMs,
          })),
          cues,
        };
      }),
    };
  } catch (error) {
    if (error instanceof CompositionCompileError) {
      throw new ApiError(422, "PREVIEW_INPUT_INVALID", undefined, { issues: error.issues });
    }
    throw error;
  }

  const result = {
    source: { kind: "draft" as const },
    compositionHtml: compiled.html,
    assets: [],
    compositions: [],
    renderer: {
      engine: COMPOSITION_ENGINE,
      compilerVersion: COMPILER_VERSION,
      playerVersion: HYPERFRAMES_PLAYER_VERSION,
    },
    timeline,
  };

  const parsed = draftPreviewSchema.safeParse(result);
  if (!parsed.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "代表プレビューを生成できませんでした。");
  }

  return parsed.data;
}
