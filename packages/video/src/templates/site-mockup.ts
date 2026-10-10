import { DEFAULT_ANIMATION_POLICY, siteMockupInputSchema } from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type { AnimationItem, RenderedCue, RenderContext } from "../render-context";

function identityBlock(options: {
  name: string | undefined;
  handle: string | undefined;
  url: string | undefined;
}): string {
  const parts: string[] = [];
  if (options.name !== undefined && options.name.length > 0) {
    parts.push(`<span class="kakeai-mockup-name">${escapeHtmlText(options.name)}</span>`);
  }
  if (options.handle !== undefined && options.handle.length > 0) {
    parts.push(`<span class="kakeai-mockup-handle">${escapeHtmlText(options.handle)}</span>`);
  }
  if (options.url !== undefined && options.url.length > 0) {
    parts.push(`<span class="kakeai-mockup-url">${escapeHtmlText(options.url)}</span>`);
  }
  return parts.length === 0 ? "" : `<div class="kakeai-mockup-ident">${parts.join("")}</div>`;
}

export function renderSiteMockup(input: unknown, context: RenderContext): RenderedCue {
  const parsed = siteMockupInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "scene.site-mockup の入力が不正です。" },
    ]);
  }
  const { variant, screen, theme, name, handle, url, caption, logo, animation } = parsed.data;
  const screenRendered = context.renderNested(
    screen,
    context.scope.child("screen"),
    [...context.path, "screen"],
  );
  const logoRendered =
    logo === undefined
      ? null
      : context.renderNested(logo, context.scope.child("logo"), [...context.path, "logo"]);
  const screenId = context.scope.id("screen");
  const themeClass = theme === "dark" ? "kakeai-mockup-theme-dark" : "kakeai-mockup-theme-light";
  const hasIdentity =
    (name !== undefined && name.length > 0) ||
    (handle !== undefined && handle.length > 0) ||
    (url !== undefined && url.length > 0);
  const header =
    logoRendered === null && !hasIdentity
      ? ""
      : `<div class="kakeai-mockup-header">${logoRendered?.html ?? ""}${identityBlock({ name, handle, url })}</div>`;
  const captionHtml =
    caption !== undefined && caption.length > 0
      ? `<div class="kakeai-mockup-caption">${escapeHtmlText(caption)}</div>`
      : "";

  const policy = DEFAULT_ANIMATION_POLICY;
  const animationItems: AnimationItem[] =
    animation !== undefined &&
    policy.presets.includes(animation.preset) &&
    animation.preset !== "none" &&
    animation.durationMs > 0
      ? [
          {
            targetId: screenId,
            preset: animation.preset,
            startMs: 0,
            durationMs: Math.min(animation.durationMs, policy.maxDurationMs),
          },
        ]
      : [];

  return {
    html: `<div class="kakeai-mockup kakeai-mockup-${variant} ${themeClass}"><div class="kakeai-mockup-chrome">${header}<div id="${screenId}" class="kakeai-mockup-screen">${screenRendered.html}</div>${captionHtml}</div></div>`,
    assetIds: [...screenRendered.assetIds, ...(logoRendered?.assetIds ?? [])],
    animation: [...screenRendered.animation, ...animationItems],
  };
}
