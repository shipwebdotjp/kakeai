export { COMPOSITION_ENGINE, COMPILER_VERSION, HYPERFRAMES_PLAYER_VERSION, OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH, THUMBNAIL_OUTPUT_HEIGHT, THUMBNAIL_OUTPUT_WIDTH } from "./meta";
export { CompositionCompileError } from "./compile-error";
export type { AssetResolver, FaceSetResolver, ResolvedAsset, ResolvedAssetKind } from "./resolver";
export { resolveTimeline, resolveCueWindow, narrationGapBeforeMs, COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_CODE, COMPOSITION_CROSSFADE_WINDOW_INSUFFICIENT_MESSAGE, collectCompositionWindowIssues, collectCueTransitionIssues, collectOffsetRangeWarnings, collectSceneTransitionIssues, collectTimelineIssues, compositionClipReachesSceneEnd, compositionCrossfadeExceedsChild, compositionTransitionOverflowMessage, sceneTransitionOf } from "./timeline";
export type { ResolvedSceneTransition } from "./timeline";
export type {
  CueWindow,
  LinePlacement,
  ResolvedTimeline,
  ScenePlacement,
  TimelineIssue,
} from "./timeline";
export { escapeHtmlAttribute, escapeHtmlText } from "./escape";
export { buildSrt, formatSrtTimestamp } from "./subtitles";
export { compileDocument, toSecondsText } from "./compiler";
export type { CompileDocumentOptions, CompiledComposition } from "./compiler";
export { neutralVisualSkin } from "./skins/neutral";
export { handmadePaperSkin } from "./skins/handmade-paper";
export {
  getResolvedVisualSkin,
  listResolvedVisualSkins,
  resolveVisualSkin,
  visualSkinRendererRegistry,
} from "./skins/registry";
export type {
  ResolvedVisualSkin,
  SkinRenderedCue,
  VisualSkinTemplateRenderer,
} from "./skins/types";
export { compileThumbnail } from "./thumbnails/compile";
export type { CompileThumbnailOptions, CompiledThumbnail } from "./thumbnails/compile";
export type { CompositionVersionResolver, CompositionVersionResolved } from "./composition-resolver";
export {
  THEME_FONT_STACKS,
  accentForegroundHex,
  accentSoftHex,
  contrastRatio,
  hexToRgb,
  mixHex,
  overlayToRgba,
  relativeLuminance,
  resolveFontFamilyCss,
  resolveSceneAccentHex,
  resolveVisualTheme,
  rgbToHex,
  sceneAccentStyle,
  themeRootStyle,
} from "./theme";
export type { FontFaceNames } from "./theme";
