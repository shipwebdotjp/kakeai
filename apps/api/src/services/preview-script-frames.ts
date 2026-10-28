import type {
  AgentPreviewScriptFrameInput,
  AgentPreviewScriptFrameOutput,
  ScriptVersionPreview,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { resourceNotFound, validationError } from "../http/validation.ts";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import {
  compilePreview,
  getScriptVersionPreview,
} from "./script-versions.ts";
import type { CompiledPreview } from "./script-versions/preview.ts";
import { requireEdition } from "./script-versions/common.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { rasterizePreviewFrame } from "./preview-frame-raster.ts";

/**
 * Rasterizes a saved ScriptVersion or an unsaved draft ContentDocument at `timeMs`
 * without creating a render Job, a new ScriptVersion, or an Artifact. The HTML comes
 * from the same preview compiler as the Web UI (`compilePreview` / `getScriptVersionPreview`).
 */
export async function getScriptVersionFrame(
  prisma: PrismaClient,
  directories: DataDirectories,
  rasterizer: PreviewRasterizer,
  origin: string,
  input: AgentPreviewScriptFrameInput,
): Promise<AgentPreviewScriptFrameOutput> {
  let preview: ScriptVersionPreview | CompiledPreview;
  let scriptVersionId: string | null = null;

  if ("scriptVersionId" in input) {
    preview = await getScriptVersionPreview(
      prisma,
      directories,
      input.scriptVersionId,
    );
    scriptVersionId = input.scriptVersionId;
  } else {
    if (input.languageEditionId !== undefined) {
      const edition = await requireEdition(prisma, input.languageEditionId);
      if (input.content.locale !== edition.locale) {
        throw validationError([
          {
            path: ["content", "locale"],
            code: "invalid_value",
            message: `言語版のロケール(${edition.locale})と一致しません。`,
          },
        ]);
      }
    }
    preview = await compilePreview(prisma, directories, input.content, {
      strictTakeDurations: true,
    });
  }

  const durationMs = preview.timeline.totalDurationMs;
  if (input.timeMs > durationMs) {
    throw validationError([
      {
        path: ["timeMs"],
        code: "invalid_value",
        message: "timeMs は台本の解決済み尺の範囲内にしてください。",
      },
    ]);
  }

  const { png, width, height } = await rasterizePreviewFrame(
    rasterizer,
    preview.compositionHtml,
    input.timeMs,
    origin,
  );
  return {
    scriptVersionId,
    requestedTimeMs: input.timeMs,
    durationMs,
    width,
    height,
    mimeType: "image/png",
    imageBase64: png.toString("base64"),
  };
}
