export { COMPOSITION_ENGINE, COMPILER_VERSION, HYPERFRAMES_PLAYER_VERSION, OUTPUT_FPS, OUTPUT_HEIGHT, OUTPUT_WIDTH } from "./meta";
export { CompositionCompileError } from "./compile-error";
export type { AssetResolver, ResolvedAsset, ResolvedAssetKind } from "./resolver";
export { resolveTimeline } from "./timeline";
export type {
  LinePlacement,
  ResolvedTimeline,
  ScenePlacement,
  TimelineIssue,
} from "./timeline";
export { compileDocument, toSecondsText } from "./compiler";
export type { CompileDocumentOptions, CompiledComposition } from "./compiler";
