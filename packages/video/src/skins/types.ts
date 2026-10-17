import type { VisualSkinRef, VisualThemeDefinition } from "@kakeai/contracts";
import type { CompositionVersionResolved } from "../composition-resolver";
import type { RenderedCue, RenderContext } from "../render-context";

export type SkinRenderedCue = RenderedCue & { compositionVersion?: CompositionVersionResolved };

export type VisualSkinTemplateRenderer = (
  input: unknown,
  context: RenderContext,
) => SkinRenderedCue;

export interface ResolvedVisualSkin {
  ref: VisualSkinRef;
  templateRenderers: ReadonlyMap<string, VisualSkinTemplateRenderer>;
  sceneBackground: (accentHex: string, theme: VisualThemeDefinition) => string;
}
