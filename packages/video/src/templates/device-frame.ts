import { DEFAULT_ANIMATION_POLICY, deviceFrameInputSchema } from "@kakeai/contracts";
import type { z } from "zod";
import { CompositionCompileError } from "../compile-error";
import type { AnimationItem, RenderedCue, RenderContext } from "../render-context";
import { laptopBaseHtml, statusBarHtml } from "./device-chrome";

type DeviceFrameInput = z.infer<typeof deviceFrameInputSchema>;

const DEVICE_PLACEMENT_CLASS: Record<DeviceFrameInput["placement"] & string, string> = {
  left: " kakeai-deviceframe-place-left",
  center: "",
  right: " kakeai-deviceframe-place-right",
};

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
  const { screen, frame, scale, placement, backgroundColor, animation, statusBar, keyboard } =
    parsed.data as DeviceFrameInput;
  const deviceScale = scale ?? 1;
  const devicePlacement = placement ?? "center";
  const screenRendered = context.renderNested(
    screen,
    context.scope.child("screen"),
    [...context.path, "screen"],
  );
  const screenId = context.scope.id("screen");
  const background = backgroundColor ?? context.theme.surfaceMuted;
  const showStatus = frame === "phone" && statusBar !== false;
  const showKeyboard = frame === "laptop" && keyboard !== false;
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
  const screenHtml = `<div id="${screenId}" class="kakeai-deviceframe-screen${showKeyboard ? "" : " kakeai-deviceframe-scalable"}">${screenRendered.html}${statusHtml}</div>`;
  const content = showKeyboard
    ? `<div class="kakeai-deviceframe-body kakeai-deviceframe-scalable">${screenHtml}${laptopBaseHtml()}</div>`
    : screenHtml;
  const placementClass = DEVICE_PLACEMENT_CLASS[devicePlacement] ?? "";
  const frameClass = `kakeai-deviceframe kakeai-deviceframe-${frame}${showKeyboard ? " kakeai-deviceframe-keyboard" : ""}${placementClass}`;
  const styleParts = [`background:${background}`];
  if (deviceScale !== 1) {
    styleParts.push(
      `--kakeai-device-scale:${deviceScale}`,
      `--kakeai-device-origin:${devicePlacement} center`,
    );
  }
  return {
    html: `<div class="${frameClass}" style="${styleParts.join(";")}">${content}</div>`,
    assetIds: screenRendered.assetIds,
    animation: [...screenRendered.animation, ...animationItems],
    nestedCompositionWindows: screenRendered.nestedCompositionWindows,
  };
}
