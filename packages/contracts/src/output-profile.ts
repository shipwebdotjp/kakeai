import type { WorkOutputProfile } from "./dto";

/**
 * Layout numbers shared by the compiler and content warnings. The compiler's
 * `CanvasMetrics` derives its canvas, content width, type scale, and caption
 * line count from this table, so a warning threshold and the rendered layout
 * cannot drift apart.
 *
 * Warning limits are expressed in the same units as
 * `packages/contracts/src/content/warnings.ts` (full-width characters and
 * item counts). Each value is the point where the layout no longer fits at
 * the profile's content width; the compiler's type scale is already applied.
 */
export interface OutputProfileLayout {
  width: number;
  height: number;
  /** Width available to text after the profile's side padding. */
  contentWidth: number;
  /** Multiplier for theme text role sizes. Captions are not scaled. */
  typeScale: number;
  captionMaxLines: number;
  /** 警告を出さずに収まる1行あたりの最大文字数（全角換算）。 */
  captionCharsPerLine: number;
  /**
   * 焼き込み字幕を1行に保つ上限の文字数（全角換算）。これを超えた段落は、
   * 表示可能幅に収まるなら2行へ自動改行する。`captionCharsPerLine` は警告用の
   * 最大収容目安であり、自動折り返しのしきい値ではない。
   */
  captionWrapCharsPerLine: number;
  chartCategoryLimit: number;
  chartSeriesLimit: number;
  tableColumnLimit: number;
  tableRowLimit: number;
  tableCellCharLimit: number;
}

export const OUTPUT_PROFILE_LAYOUT: Record<WorkOutputProfile, OutputProfileLayout> = {
  landscape: {
    width: 1920,
    height: 1080,
    contentWidth: 1600,
    typeScale: 1,
    captionMaxLines: 2,
    captionCharsPerLine: 38,
    captionWrapCharsPerLine: 28,
    chartCategoryLimit: 6,
    chartSeriesLimit: 3,
    tableColumnLimit: 6,
    tableRowLimit: 10,
    tableCellCharLimit: 14,
  },
  portrait: {
    width: 1080,
    height: 1920,
    contentWidth: 936,
    typeScale: 0.75,
    captionMaxLines: 3,
    // Captions keep their font size and only lose width: 936px / 40px.
    captionCharsPerLine: 22,
    // The physical line width is already 22 full-width characters, so the
    // wrap threshold matches the warning capacity.
    captionWrapCharsPerLine: 22,
    // 936px plot with ~213px per category (the landscape guideline density).
    chartCategoryLimit: 4,
    chartSeriesLimit: 3,
    // 936px table with ~250px per column (the landscape guideline density).
    tableColumnLimit: 3,
    tableRowLimit: 8,
    tableCellCharLimit: 11,
  },
};

export function outputProfileLayout(profile: WorkOutputProfile | undefined): OutputProfileLayout {
  return profile === "portrait"
    ? OUTPUT_PROFILE_LAYOUT.portrait
    : OUTPUT_PROFILE_LAYOUT.landscape;
}

/**
 * Characters per line for a text constraint at the profile's content width.
 * Landscape returns the base value unchanged. Portrait gains room from the
 * smaller type scale but loses more from the narrower canvas:
 * (936 / 1600) / 0.75 = 0.78.
 */
export function charsPerLineFor(
  baseCharsPerLine: number,
  layout: OutputProfileLayout,
): number {
  const ratio =
    (layout.contentWidth / OUTPUT_PROFILE_LAYOUT.landscape.contentWidth) /
    layout.typeScale;
  return Math.max(1, Math.floor(baseCharsPerLine * ratio));
}
