import type {
  ContentDocument,
  FigureAction,
  FigureEase,
  NestedVisual,
  VisualThemeDefinition,
} from "@kakeai/contracts";
import type { AssetResolver, FaceSetResolver } from "./resolver";
import type { RenderScope } from "./scope";

export interface AnimationItem {
  targetId: string;
  action: FigureAction;
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

export interface RenderedCue {
  html: string;
  assetIds: string[];
  animation: AnimationItem[];
  motionTargetId?: string;
  expressionTargets?: ExpressionTarget[];
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
  scope: RenderScope;
  path: (string | number)[];
  cueTiming?: CueTiming;
  renderNested: (node: NestedVisual, scope: RenderScope, path: (string | number)[]) => RenderedCue;
}
