import type {
  AgentPreviewThemeInput,
  AgentPreviewThemeOutput,
} from "@kakeai/contracts";
import { validationError } from "../http/validation.ts";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import { compileThemeRepresentativePreview } from "./theme-preview.ts";
import { rasterizePreviewFrame } from "./preview-frame-raster.ts";

/**
 * Rasterizes the representative Theme sample at `timeMs` without touching the
 * DB, creating a Theme Draft/Revision, a Job, or an Artifact. The HTML comes
 * from the same compiler as the Web UI theme preview.
 */
export async function getThemePreviewFrame(
  rasterizer: PreviewRasterizer,
  origin: string,
  input: AgentPreviewThemeInput,
): Promise<AgentPreviewThemeOutput> {
  const preview = compileThemeRepresentativePreview(
    input.definition,
    [],
    input.locale,
  );
  const durationMs = preview.timeline.totalDurationMs;
  if (input.timeMs > durationMs) {
    throw validationError([
      {
        path: ["timeMs"],
        code: "invalid_value",
        message: "timeMs は代表サンプルの解決済み尺の範囲内にしてください。",
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
    themeId: input.definition.id,
    version: input.definition.version,
    locale: input.locale,
    requestedTimeMs: input.timeMs,
    durationMs,
    width,
    height,
    mimeType: "image/png",
    imageBase64: png.toString("base64"),
  };
}
