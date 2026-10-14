export { COMPOSITION_ENGINE, COMPILER_VERSION, HYPERFRAMES_PLAYER_VERSION, OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./meta";
export { CompositionCompileError } from "./compile-error";
export type { AssetResolver, FaceSetResolver, ResolvedAsset, ResolvedAssetKind } from "./resolver";
export { resolveTimeline, resolveCueWindow, collectCueTransitionIssues, collectSceneTransitionIssues, collectTimelineIssues, sceneTransitionOf } from "./timeline";
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
  resolveSceneAccentHex,
  resolveVisualTheme,
  rgbToHex,
  sceneAccentStyle,
  themeRootStyle,
} from "./theme";
