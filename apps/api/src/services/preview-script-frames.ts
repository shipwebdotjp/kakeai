import type {
  AgentPreviewScriptFrameInput,
  AgentPreviewScriptFrameOutput,
} from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { validationError } from "../http/validation.ts";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import { getScriptVersionPreview } from "./script-versions.ts";
import type { DataDirectories } from "../storage/paths.ts";
import { rasterizePreviewFrame } from "./preview-frame-raster.ts";

/**
 * Rasterizes a saved ScriptVersion at `timeMs` without creating a render Job,
 * a new ScriptVersion, or an Artifact. The HTML comes from the same preview
 * compiler as the Web UI (`getScriptVersionPreview`).
 */
export async function getScriptVersionFrame(
  prisma: PrismaClient,
  directories: DataDirectories,
  rasterizer: PreviewRasterizer,
  origin: string,
  input: AgentPreviewScriptFrameInput,
): Promise<AgentPreviewScriptFrameOutput> {
  const preview = await getScriptVersionPreview(
    prisma,
    directories,
    input.scriptVersionId,
  );
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
    scriptVersionId: preview.scriptVersionId,
    requestedTimeMs: input.timeMs,
    durationMs,
    width,
    height,
    mimeType: "image/png",
    imageBase64: png.toString("base64"),
  };
}
