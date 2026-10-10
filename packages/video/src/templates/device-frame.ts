import { deviceFrameInputSchema } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import type { RenderedCue, RenderContext } from "../render-context";

export function renderDeviceFrame(input: unknown, context: RenderContext): RenderedCue {
  const parsed = deviceFrameInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "scene.device-frame の入力が不正です。" },
    ]);
  }
  const { screen, frame, backgroundColor } = parsed.data;
  const screenRendered = context.renderNested(
    screen,
    context.scope.child("screen"),
    [...context.path, "screen"],
  );
  const background = backgroundColor ?? "#f1f5f9";
  return {
    html: `<div class="kakeai-deviceframe kakeai-deviceframe-${frame}" style="background:${background}"><div class="kakeai-deviceframe-screen">${screenRendered.html}</div></div>`,
    assetIds: screenRendered.assetIds,
    animation: screenRendered.animation,
  };
}
