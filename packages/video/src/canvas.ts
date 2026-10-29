import type { VisualThemeDefinition, WorkOutputProfile } from "@kakeai/contracts";
import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./meta";

/**
 * Canvas-derived layout values shared by the compiler, caption layer, and
 * templates. Landscape values are the existing 1920x1080 layout and must not
 * change; portrait is the 9:16 re-layout described in
 * `docs/short-video/spec.md`.
 */
export interface CanvasMetrics {
  profile: WorkOutputProfile;
  width: number;
  height: number;
  /** Width available to text and templates after side padding. */
  contentWidth: number;
  safeTop: number;
  safeBottom: number;
  safeRight: number;
  /** Multiplier for theme text role sizes. Captions are never scaled. */
  typeScale: number;
  captionBottomOffset: number;
  captionMaxLines: number;
  /** Padding of `text.block@1` and table wrappers. */
  textPadding: { x: number; y: number };
  cardPadding: { x: number; y: number };
  /** Horizontal padding of stat/quote wrappers. */
  wideSidePadding: number;
  /** Padding of the flow-diagram wrapper. */
  flowPadding: { x: number; y: number };
}

export const LANDSCAPE_CANVAS: CanvasMetrics = {
  profile: "landscape",
  width: OUTPUT_WIDTH,
  height: OUTPUT_HEIGHT,
  contentWidth: 1600,
  safeTop: 0,
  safeBottom: 0,
  safeRight: 0,
  typeScale: 1,
  captionBottomOffset: 72,
  captionMaxLines: 2,
  textPadding: { x: 140, y: 120 },
  cardPadding: { x: 160, y: 90 },
  wideSidePadding: 200,
  flowPadding: { x: 100, y: 70 },
};

const PORTRAIT_BASE: Omit<CanvasMetrics, "profile"> = {
  width: 1080,
  height: 1920,
  contentWidth: 936,
  safeTop: 120,
  safeBottom: 320,
  safeRight: 120,
  typeScale: 0.75,
  captionBottomOffset: 340,
  captionMaxLines: 3,
  textPadding: { x: 72, y: 120 },
  cardPadding: { x: 72, y: 96 },
  wideSidePadding: 72,
  flowPadding: { x: 56, y: 48 },
};

export const PORTRAIT_CANVAS: CanvasMetrics = {
  profile: "portrait",
  ...PORTRAIT_BASE,
};

export function canvasMetricsFor(profile: WorkOutputProfile | undefined): CanvasMetrics {
  return profile === "portrait" ? PORTRAIT_CANVAS : LANDSCAPE_CANVAS;
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
    `--kakeai-text-pad-x:${canvas.textPadding.x}px`,
    `--kakeai-text-pad-y:${canvas.textPadding.y}px`,
    `--kakeai-card-pad-x:${canvas.cardPadding.x}px`,
    `--kakeai-card-pad-y:${canvas.cardPadding.y}px`,
    `--kakeai-safe-top:${canvas.safeTop}px`,
    `--kakeai-safe-bottom:${canvas.safeBottom}px`,
    `--kakeai-safe-right:${canvas.safeRight}px`,
    `--kakeai-wide-side-padding:${canvas.wideSidePadding}px`,
    `--kakeai-flow-pad-x:${canvas.flowPadding.x}px`,
    `--kakeai-flow-pad-y:${canvas.flowPadding.y}px`,
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
