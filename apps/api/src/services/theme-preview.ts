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
  DEFAULT_PREVIEW_LOCALE,
  asSupportedLocale,
  draftPreviewSchema,
  type ContentDocument,
  type DraftPreview,
  type PreviewCueTiming,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { ApiError } from "../http/errors.ts";

export const THEME_PREVIEW_MEDIA_ASSET_ID = "theme-preview-media";

/**
 * Simplified/Traditional Chinese sample copy. The glyph pairs are chosen so
 * the script difference is visible at a glance (门/門, 确/確, 图/圖). English
 * uses its own copy so the preview locale and the rendered strings agree.
 */
const ZH_SAMPLE_TEXT = {
  "zh-Hans": {
    speakerName: "示例说话者",
    title: "主题预览",
    subtitle: "代表示例的配色与字体样式确认",
    heading: "主要标题样式",
    body: "确认正文文本的行距与颜色显示。\n字体与装饰会即时反映。",
    label: "标签",
    mediaHeading: "图片卡片的标题",
    mediaCaption: "确认皮肤对照片的展示方式。",
    listTitle: "三个要点",
    listItems: ["第一个要点", "第二个要点", "第三个要点"],
    quote: "确认引用卡片的显示效果。",
    quoteAuthor: "出处名称",
    quoteSource: "文献名",
    closing: "感谢观看",
    captionText: "字幕样式的显示示例。",
    tableCaption: "外观主题未对应的模板以标准方式呈现",
    tableItems: ["示例1", "示例2"],
    tableColumns: ["项目", "数值"],
  },
  "zh-Hant": {
    speakerName: "範例說話者",
    title: "主題預覽",
    subtitle: "代表範例的配色與字體樣式確認",
    heading: "主要標題樣式",
    body: "確認本文文字的行距與顏色顯示。\n字體與裝飾會即時反映。",
    label: "標籤",
    mediaHeading: "圖片卡片的標題",
    mediaCaption: "確認外觀主題對照片的呈現方式。",
    listTitle: "三個要點",
    listItems: ["第一個要點", "第二個要點", "第三個要點"],
    quote: "確認引用卡片的顯示效果。",
    quoteAuthor: "出處名稱",
    quoteSource: "文獻名",
    closing: "感謝觀看",
    captionText: "字幕樣式的顯示範例。",
    tableCaption: "外觀主題未對應的範本以標準方式呈現",
    tableItems: ["範例1", "範例2"],
    tableColumns: ["項目", "數值"],
  },
} as const;

const EN_SAMPLE_TEXT = {
  speakerName: "Sample speaker",
  title: "Theme preview",
  subtitle: "Checking palette and font styles on the sample",
  heading: "Primary heading style",
  body: "Check the line height and color of body text.\nFonts and decorations update instantly.",
  label: "LABEL",
  mediaHeading: "Image card heading",
  mediaCaption: "Check how the skin presents photos.",
  listTitle: "Three key points",
  listItems: ["First key point", "Second key point", "Third key point"],
  quote: "Check how the quote card looks.",
  quoteAuthor: "Source name",
  quoteSource: "Document title",
  closing: "Thank you for watching",
  captionText: "Caption style sample.",
  tableCaption: "Templates without a skin fall back to the standard rendering",
  tableItems: ["Sample 1", "Sample 2"],
  tableColumns: ["Item", "Value"],
} as const;

const JA_SAMPLE_TEXT = {
  speakerName: "サンプル話者",
  title: "テーマプレビュー",
  subtitle: "代表サンプルの配色とフォントスタイル確認",
  heading: "主要な見出しスタイル",
  body: "本文テキストの行間や色の見え方を確認します。\nフォントや装飾が即座に反映されます。",
  label: "LABEL",
  mediaHeading: "画像カードの見出し",
  mediaCaption: "スキンによる写真の見せ方を確認します。",
  listTitle: "3つの要点",
  listItems: ["ひとつめの要点", "ふたつめの要点", "みっつめの要点"],
  quote: "引用カードの見え方を確認します。",
  quoteAuthor: "出典元の名前",
  quoteSource: "文献名",
  closing: "ご視聴ありがとうございました",
  captionText: "字幕スタイルの表示サンプルです。",
  tableCaption: "Skin未対応テンプレートは標準描画",
  tableItems: ["サンプル1", "サンプル2"],
  tableColumns: ["項目", "値"],
} as const;

const SAMPLE_TEXT_BY_LOCALE = {
  ...ZH_SAMPLE_TEXT,
  "en-US": EN_SAMPLE_TEXT,
} as const;

function sampleText(locale: string) {
  return SAMPLE_TEXT_BY_LOCALE[locale as keyof typeof SAMPLE_TEXT_BY_LOCALE] ?? JA_SAMPLE_TEXT;
}

function previewMediaDataUrl(themeDefinition: VisualThemeDefinition): string {
  const base = themeDefinition.canvas.base;
  const ink = themeDefinition.canvas.ink;
  const deep = mixHex(base, ink, 0.28);
  const mid = mixHex(base, ink, 0.16);
  const soft = mixHex(base, ink, 0.07);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${soft}"/><rect x="40" y="40" width="250" height="150" rx="14" fill="${mid}"/><circle cx="472" cy="128" r="72" fill="${deep}"/><rect x="40" y="228" width="560" height="84" rx="16" fill="${base}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function createRepresentativeSampleDocument(
  themeDefinition: VisualThemeDefinition,
  locale: string = DEFAULT_PREVIEW_LOCALE,
): ContentDocument {
  const themeRef = { id: themeDefinition.id, version: themeDefinition.version };
  const normalizedLocale = asSupportedLocale(locale) ?? DEFAULT_PREVIEW_LOCALE;
  const text = sampleText(normalizedLocale);

  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    locale: normalizedLocale,
    visualTheme: themeRef,
    template: { id: "explanation-scenes", version: 1 },
    caption: { showSpeakerName: true },
    speakers: [{ id: "speaker-sample", name: text.speakerName, characterId: null, voiceProfileId: null }],
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
              text: text.title,
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
              text: text.subtitle,
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
            speakerId: "speaker-sample",
            captionText: text.captionText,
            speechText: text.captionText,
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
              text: text.heading,
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
              text: text.body,
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
              text: text.label,
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
              heading: text.mediaHeading,
              caption: text.mediaCaption,
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
              title: text.listTitle,
              items: text.listItems.map((item) => ({ text: item })),
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
              quote: text.quote,
              author: text.quoteAuthor,
              source: text.quoteSource,
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
              caption: text.tableCaption,
              data: {
                columns: [
                  { key: "item", label: text.tableColumns[0], type: "text" },
                  { key: "value", label: text.tableColumns[1], type: "number" },
                ],
                rows: [
                  { item: text.tableItems[0], value: 120 },
                  { item: text.tableItems[1], value: 80 },
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
              text: text.closing,
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
  locale: string = DEFAULT_PREVIEW_LOCALE,
): DraftPreview {
  const sampleDoc = createRepresentativeSampleDocument(definition, locale);
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
