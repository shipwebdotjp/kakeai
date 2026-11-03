import {
  UNITS_PER_FULLWIDTH_CHAR,
  outputProfileLayout,
  type TextInsetPreset,
  type VisualThemeDefinition,
  type WorkOutputProfile,
} from "@kakeai/contracts";

/**
 * Canvas-derived layout values shared by the compiler, caption layer, and
 * templates. Landscape values are the existing 1920x1080 layout and must not
 * change; portrait is the 9:16 re-layout described in
 * `docs/short-video/spec.md`.
 */
export interface TextInset {
  x: number;
  y: number;
}

export interface TextBlockPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface CanvasMetrics {
  profile: WorkOutputProfile;
  width: number;
  height: number;
  /** Width available to text and templates after side padding. */
  contentWidth: number;
  safeTop: number;
  safeBottom: number;
  safeRight: number;
  safeLeft: number;
  /** Multiplier for theme text role sizes. Captions are never scaled. */
  typeScale: number;
  captionBottomOffset: number;
  captionMaxLines: number;
  /** 字幕を1行に保つ上限の幅（半角単位）。全角28/22文字相当。 */
  captionWrapUnitsPerLine: number;
  /**
   * Edge insets of `text.block@1` before safe areas apply. `wide` keeps the
   * pre-inset spacing of each profile.
   */
  textInsets: Record<TextInsetPreset, TextInset>;
  /** Preset used when a `text.block@1` cue does not set `inset`. */
  defaultTextInset: TextInsetPreset;
  /** Vertical padding of the callout, stat, and quote wrappers. */
  blockPaddingY: number;
  cardPadding: { x: number; y: number };
  /** Horizontal padding of stat/quote wrappers. */
  wideSidePadding: number;
  /** Padding of the flow-diagram wrapper. */
  flowPadding: { x: number; y: number };
  /** Height of the browser/app screen inside `scene.site-mockup@1`. */
  mockupScreenHeight: number;
}

const LANDSCAPE_LAYOUT = outputProfileLayout("landscape");
const PORTRAIT_LAYOUT = outputProfileLayout("portrait");

export const LANDSCAPE_CANVAS: CanvasMetrics = {
  profile: "landscape",
  width: LANDSCAPE_LAYOUT.width,
  height: LANDSCAPE_LAYOUT.height,
  contentWidth: LANDSCAPE_LAYOUT.contentWidth,
  safeTop: 0,
  safeBottom: 0,
  safeRight: 0,
  safeLeft: 0,
  typeScale: LANDSCAPE_LAYOUT.typeScale,
  captionBottomOffset: 72,
  captionMaxLines: LANDSCAPE_LAYOUT.captionMaxLines,
  captionWrapUnitsPerLine:
    LANDSCAPE_LAYOUT.captionWrapCharsPerLine * UNITS_PER_FULLWIDTH_CHAR,
  textInsets: {
    tight: { x: 32, y: 32 },
    normal: { x: 80, y: 80 },
    wide: { x: 140, y: 120 },
  },
  defaultTextInset: "tight",
  blockPaddingY: 120,
  cardPadding: { x: 160, y: 90 },
  wideSidePadding: 200,
  flowPadding: { x: 100, y: 70 },
  mockupScreenHeight: 600,
};

export const PORTRAIT_CANVAS: CanvasMetrics = {
  profile: "portrait",
  width: PORTRAIT_LAYOUT.width,
  height: PORTRAIT_LAYOUT.height,
  contentWidth: PORTRAIT_LAYOUT.contentWidth,
  safeTop: 120,
  safeBottom: 320,
  safeRight: 120,
  safeLeft: 0,
  typeScale: PORTRAIT_LAYOUT.typeScale,
  captionBottomOffset: 340,
  captionMaxLines: PORTRAIT_LAYOUT.captionMaxLines,
  captionWrapUnitsPerLine:
    PORTRAIT_LAYOUT.captionWrapCharsPerLine * UNITS_PER_FULLWIDTH_CHAR,
  textInsets: {
    tight: { x: 32, y: 32 },
    normal: { x: 80, y: 80 },
    wide: { x: 72, y: 120 },
  },
  defaultTextInset: "wide",
  blockPaddingY: 120,
  cardPadding: { x: 72, y: 96 },
  wideSidePadding: 72,
  flowPadding: { x: 56, y: 48 },
  // 16:9 at 440px is 782px wide, inside the 828px mockup content box.
  mockupScreenHeight: 440,
};

export function canvasMetricsFor(profile: WorkOutputProfile | undefined): CanvasMetrics {
  return profile === "portrait" ? PORTRAIT_CANVAS : LANDSCAPE_CANVAS;
}

/**
 * Effective `text.block@1` padding. A cue's inset preset is the baseline;
 * platform safe areas win when they are larger, so text never moves under
 * Shorts UI by accident.
 */
export function textBlockPadding(
  canvas: CanvasMetrics,
  inset: TextInsetPreset | undefined,
): TextBlockPadding {
  const base = canvas.textInsets[inset ?? canvas.defaultTextInset];
  return {
    top: Math.max(base.y, canvas.safeTop),
    right: Math.max(base.x, canvas.safeRight),
    bottom: Math.max(base.y, canvas.safeBottom),
    left: Math.max(base.x, canvas.safeLeft),
  };
}

/**
 * Inverse of `canvasMetricsFor` for readers that only have recorded dimensions
 * (render snapshots). Returns null for a size the compiler cannot produce.
 */
export function outputProfileForDimensions(
  width: number,
  height: number,
): WorkOutputProfile | null {
  if (width === LANDSCAPE_CANVAS.width && height === LANDSCAPE_CANVAS.height) {
    return "landscape";
  }
  if (width === PORTRAIT_CANVAS.width && height === PORTRAIT_CANVAS.height) {
    return "portrait";
  }
  return null;
}

/**
 * Root CSS custom properties consumed by the shared stylesheet. The fallbacks
 * in the stylesheet equal the landscape values, so a missing root style keeps
 * the previous 16:9 layout.
 */
export function canvasRootStyle(canvas: CanvasMetrics): string {
  return [
    `--kakeai-type-scale:${canvas.typeScale}`,
    `--kakeai-content-width:${canvas.contentWidth}px`,
    `--kakeai-block-pad-y:${canvas.blockPaddingY}px`,
    `--kakeai-card-pad-x:${canvas.cardPadding.x}px`,
    `--kakeai-card-pad-y:${canvas.cardPadding.y}px`,
    `--kakeai-wide-side-padding:${canvas.wideSidePadding}px`,
    `--kakeai-flow-pad-x:${canvas.flowPadding.x}px`,
    `--kakeai-flow-pad-y:${canvas.flowPadding.y}px`,
    `--kakeai-mockup-screen-h:${canvas.mockupScreenHeight}px`,
  ].join(";");
}

/**
 * Portrait re-lays out text instead of shrinking the 16:9 composition, so the
 * theme's type sizes are scaled once for the whole document. Captions keep
 * their size because they are the most readability-critical layer.
 */
export function scaleThemeForCanvas(
  theme: VisualThemeDefinition,
  canvas: CanvasMetrics,
): VisualThemeDefinition {
  if (canvas.typeScale === 1) {
    return theme;
  }
  const scale = (size: number): number => Math.max(8, Math.round(size * canvas.typeScale));
  const roles = Object.fromEntries(
    Object.entries(theme.textRoles).map(([role, token]) => [
      role,
      role === "caption" ? token : { ...token, fontSize: scale(token.fontSize) },
    ]),
  );
  return {
    ...theme,
    textRoles: roles as VisualThemeDefinition["textRoles"],
  };
}
