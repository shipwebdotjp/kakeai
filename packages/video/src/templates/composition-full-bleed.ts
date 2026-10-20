import {
  canvasProfileOf,
  compositionFullBleedInputSchema,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import type { CompositionVersionResolved, CompositionVersionResolver } from "../composition-resolver";
import { escapeHtmlAttribute } from "../escape";
import type { RenderContext } from "../render-context";

export function renderCompositionFullBleed(
  input: unknown,
  context: RenderContext,
  compositionResolver?: CompositionVersionResolver,
): { html: string; assetIds: string[]; animation: []; compositionVersion: CompositionVersionResolved } {
  const parsed = compositionFullBleedInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "input"],
        code: "invalid_input",
        message: "compositionVersionId を指定してください",
      },
    ]);
  }
  if (!compositionResolver) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "input"],
        code: "missing_composition_resolver",
        message: "CompositionVersionResolver が設定されていません",
      },
    ]);
  }
  let resolved: CompositionVersionResolved;
  try {
    resolved = compositionResolver(parsed.data.compositionVersionId);
  } catch (err) {
    throw new CompositionCompileError([
      {
        path: [...context.path, "input", "compositionVersionId"],
        code: "unknown_composition_version",
        message: `CompositionVersion を解釈できません: ${(err as Error).message}`,
      },
    ]);
  }

  const hostId = context.scope.id("comp-host");
  const src = resolved.previewUrl ?? resolved.entrypoint;
  if (canvasProfileOf(resolved.manifest) !== "landscape") {
    throw new CompositionCompileError([
      {
        path: [...context.path, "input", "compositionVersionId"],
        code: "invalid_composition_profile",
        message:
          "composition.full-bleed@1 には横長(landscape)のCompositionVersionだけを指定できます。縦型はscene.device-frame@1の画面に配置してください。",
      },
    ]);
  }
  const width = resolved.manifest.width;
  const height = resolved.manifest.height;
  return {
    html: `<div id="${hostId}" class="kakeai-fullbleed" data-composition-id="${escapeHtmlAttribute(resolved.runtimeCompositionId)}" data-composition-src="${escapeHtmlAttribute(src)}" data-width="${width}" data-height="${height}"></div>`,
    assetIds: [],
    animation: [],
    compositionVersion: resolved,
  };
}
