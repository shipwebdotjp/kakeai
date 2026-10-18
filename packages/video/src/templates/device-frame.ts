import { DEFAULT_ANIMATION_POLICY, deviceFrameInputSchema } from "@kakeai/contracts";
import type { z } from "zod";
import { CompositionCompileError } from "../compile-error";
import type { AnimationItem, RenderedCue, RenderContext } from "../render-context";
import { laptopBaseHtml, statusBarHtml } from "./device-chrome";

type DeviceFrameInput = z.infer<typeof deviceFrameInputSchema>;

export function renderDeviceFrame(
  input: unknown,
  context: RenderContext,
  schema: z.ZodTypeAny = deviceFrameInputSchema,
): RenderedCue {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "scene.device-frame の入力が不正です。" },
    ]);
  }
  const { screen, frame, backgroundColor, animation, statusBar, keyboard } =
    parsed.data as DeviceFrameInput;
  const screenRendered = context.renderNested(
    screen,
    context.scope.child("screen"),
    [...context.path, "screen"],
  );
  const screenId = context.scope.id("screen");
  const background = backgroundColor ?? context.theme.surfaceMuted;
  const showStatus = frame === "phone" && statusBar === true;
  const showKeyboard = frame === "laptop" && keyboard === true;
  const statusHtml = showStatus ? statusBarHtml("kakeai-deviceframe-status") : "";
  const policy = DEFAULT_ANIMATION_POLICY;
  const animationItems: AnimationItem[] =
    animation !== undefined &&
    policy.presets.includes(animation.preset) &&
    animation.preset !== "none" &&
    animation.durationMs > 0
      ? [
          {
            targetId: screenId,
            action: animation.preset,
            startMs: 0,
            durationMs: Math.min(animation.durationMs, policy.maxDurationMs),
          },
        ]
      : [];
  const screenHtml = `<div id="${screenId}" class="kakeai-deviceframe-screen">${screenRendered.html}${statusHtml}</div>`;
  const content = showKeyboard
    ? `<div class="kakeai-deviceframe-body">${screenHtml}${laptopBaseHtml()}</div>`
    : screenHtml;
  const frameClass = `kakeai-deviceframe kakeai-deviceframe-${frame}${showKeyboard ? " kakeai-deviceframe-keyboard" : ""}`;
  return {
    html: `<div class="${frameClass}" style="background:${background}">${content}</div>`,
    assetIds: screenRendered.assetIds,
    animation: [...screenRendered.animation, ...animationItems],
    nestedCompositionWindows: screenRendered.nestedCompositionWindows,
  };
}
