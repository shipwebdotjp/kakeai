import { OUTPUT_HEIGHT, OUTPUT_WIDTH } from "@kakeai/video";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import { parsePngDimensions } from "../media/png.ts";

export interface RasterizedPreviewFrame {
  png: Buffer;
  width: number;
  height: number;
}

/**
 * Rasterizes a compiled preview HTML at one time. Script-version and Theme
 * previews share the output size, the rasterizer flags, and the PNG dimension
 * parsing; only the input validation and response metadata differ.
 */
export async function rasterizePreviewFrame(
  rasterizer: PreviewRasterizer,
  html: string,
  timeMs: number,
  origin: string,
): Promise<RasterizedPreviewFrame> {
  const png = await rasterizer.renderFrame({
    html,
    width: OUTPUT_WIDTH,
    height: OUTPUT_HEIGHT,
    timeMs,
    origin,
  });
  return { png, ...parsePngDimensions(png) };
}
