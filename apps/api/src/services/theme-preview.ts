import {
  COMPOSITION_ENGINE,
  COMPILER_VERSION,
  HYPERFRAMES_PLAYER_VERSION,
  compileDocument,
  CompositionCompileError,
  mixHex,
  resolveTimeline,
  resolveCueWindow,
  OUTPUT_FPS,
  type CompiledComposition,
} from "@kakeai/video";
import {
  CONTENT_SCHEMA_VERSION,
  draftPreviewSchema,
  type ContentDocument,
  type DraftPreview,
  type PreviewCueTiming,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { ApiError } from "../http/errors.ts";

export const THEME_PREVIEW_MEDIA_ASSET_ID = "theme-preview-media";

function previewMediaDataUrl(themeDefinition: VisualThemeDefinition): string {
  const base = themeDefinition.canvas.base;
  const ink = themeDefinition.canvas.ink;
  const deep = mixHex(base, ink, 0.28);
  const mid = mixHex(base, ink, 0.16);
  const soft = mixHex(base, ink, 0.07);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${soft}"/><rect x="40" y="40" width="250" height="150" rx="14" fill="${mid}"/><circle cx="472" cy="128" r="72" fill="${deep}"/><rect x="40" y="228" width="560" height="84" rx="16" fill="${base}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

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
        id: "scene-sample-media",
        kind: "point",
        label: "画像カード",
        timing: { mode: "fixed", durationMs: 4000 },
        accent: { kind: "theme", token: "primary" },
        lines: [],
        visualCues: [
          {
            id: "vc-media-card",
            template: { id: "media.card", version: 1 },
            range: { kind: "scene" },
            layer: "card",
            order: 0,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              assetId: THEME_PREVIEW_MEDIA_ASSET_ID,
              heading: "画像カードの見出し",
              caption: "スキンによる写真の見せ方を確認します。",
            },
          },
        ],
      },
      {
        id: "scene-sample-points",
        kind: "point",
        label: "要点リスト",
        timing: { mode: "fixed", durationMs: 4000 },
        accent: { kind: "theme", token: "secondary" },
        lines: [],
        visualCues: [
          {
            id: "vc-list-callout",
            template: { id: "list.callout", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 0,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              title: "3つの要点",
              items: [
                { text: "ひとつめの要点" },
                { text: "ふたつめの要点" },
                { text: "みっつめの要点" },
              ],
            },
          },
        ],
      },
      {
        id: "scene-sample-quote",
        kind: "point",
        label: "引用",
        timing: { mode: "fixed", durationMs: 4000 },
        accent: { kind: "theme", token: "tertiary" },
        lines: [],
        visualCues: [
          {
            id: "vc-quote",
            template: { id: "quote", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 0,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              quote: "引用カードの見え方を確認します。",
              author: "出典元の名前",
              source: "文献名",
            },
          },
        ],
      },
      {
        id: "scene-sample-fallback",
        kind: "point",
        label: "テンプレート標準",
        timing: { mode: "fixed", durationMs: 4000 },
        accent: { kind: "theme", token: "primary" },
        lines: [],
        visualCues: [
          {
            id: "vc-table",
            template: { id: "table.simple", version: 1 },
            range: { kind: "scene" },
            layer: "overlay",
            order: 0,
            transition: {
              enter: { preset: "fade", durationMs: 350 },
              exit: { preset: "none", durationMs: 0 },
            },
            input: {
              caption: "Skin未対応テンプレートは標準描画",
              data: {
                columns: [
                  { key: "item", label: "項目", type: "text" },
                  { key: "value", label: "値", type: "number" },
                ],
                rows: [
                  { item: "サンプル1", value: 120 },
                  { item: "サンプル2", value: 80 },
                ],
              },
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

export function compileThemeRepresentativePreview(
  definition: VisualThemeDefinition,
  fontDiagnostics: readonly string[] = [],
): DraftPreview {
  const sampleDoc = createRepresentativeSampleDocument(definition);
  let compiled: CompiledComposition;
  let timeline;

  try {
    const mediaUrl = previewMediaDataUrl(definition);
    compiled = compileDocument({
      document: sampleDoc,
      resolvedTheme: definition,
      assetResolver: (assetId) => {
        if (assetId === THEME_PREVIEW_MEDIA_ASSET_ID) {
          return { url: mediaUrl, kind: "image", durationMs: null };
        }
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
    fontDiagnostics: fontDiagnostics.filter((entry): entry is string => typeof entry === "string"),
  };

  const parsed = draftPreviewSchema.safeParse(result);
  if (!parsed.success) {
    throw new ApiError(500, "INTERNAL_ERROR", "代表プレビューを生成できませんでした。");
  }

  return parsed.data;
}
