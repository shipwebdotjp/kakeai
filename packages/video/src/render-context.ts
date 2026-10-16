import type {
  ContentDocument,
  FigureAction,
  FigureEase,
  NestedVisual,
  OnsetPreset,
  VisualThemeDefinition,
} from "@kakeai/contracts";
import type { AssetResolver, FaceSetResolver } from "./resolver";
import type { CompositionVersionResolved, CompositionVersionResolver } from "./composition-resolver";
import type { RenderScope } from "./scope";

export type RenderAnimationAction = FigureAction | OnsetPreset;

export interface AnimationItem {
  targetId: string;
  action: RenderAnimationAction;
  axis?: "x" | "y";
  ease?: FigureEase;
  startMs: number;
  durationMs: number;
}

export interface ExpressionTarget {
  presetId: string;
  elementId: string;
  eyeBlinkId?: string;
  eyeBaseId?: string;
  mouthSpeakingId?: string;
  mouthBaseId?: string;
}

export interface LineInterval {
  lineId: string;
  startMs: number;
  endMs: number;
}

export interface StateInterval {
  targetId: string;
  intervals: { startMs: number; endMs: number }[];
  on: Record<string, string | number>;
  off?: Record<string, string | number>;
}

export interface RenderedCue {
  html: string;
  assetIds: string[];
  animation: AnimationItem[];
  motionTargetId?: string;
  expressionTargets?: ExpressionTarget[];
  nestedCompositionWindows?: NestedCompositionWindow[];
  stateIntervals?: StateInterval[];
}

export interface NestedCompositionWindow {
  targetId: string;
  durationMs: number;
}

export interface CueTiming {
  startMs: number;
  spanMs: number;
}

export interface RenderContext {
  document: ContentDocument;
  theme: VisualThemeDefinition;
  assetResolver: AssetResolver;
  faceSetResolver?: FaceSetResolver;
  compositionResolver?: CompositionVersionResolver;
  collectComposition?: (resolved: CompositionVersionResolved) => void;
  scope: RenderScope;
  path: (string | number)[];
  cueTiming?: CueTiming;
  lineIntervals?: LineInterval[];
  renderNested: (node: NestedVisual, scope: RenderScope, path: (string | number)[]) => RenderedCue;
}
