import type { AnimationPreset, ContentDocument, NestedVisual } from "@kakeai/contracts";
import type { AssetResolver } from "./resolver";
import type { RenderScope } from "./scope";

export interface AnimationItem {
  targetId: string;
  preset: AnimationPreset;
  startMs: number;
  durationMs: number;
}

export interface RenderedCue {
  html: string;
  assetIds: string[];
  animation: AnimationItem[];
  motionTargetId?: string;
}

export interface RenderContext {
  document: ContentDocument;
  assetResolver: AssetResolver;
  scope: RenderScope;
  path: (string | number)[];
  renderNested: (node: NestedVisual, scope: RenderScope, path: (string | number)[]) => RenderedCue;
}
