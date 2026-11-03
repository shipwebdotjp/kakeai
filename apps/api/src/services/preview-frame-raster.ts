import { OUTPUT_HEIGHT, OUTPUT_WIDTH, outputProfileForDimensions } from "@kakeai/video";
import type { PreviewRasterizer } from "../media/preview-rasterize.ts";
import { parsePngDimensions } from "../media/png.ts";

export interface RasterizedPreviewFrame {
  png: Buffer;
  width: number;
  height: number;
}

/**
 * Reads the canvas the compiler declared on the composition root. A missing
 * declaration falls back to the landscape output so older compiled HTML keeps
 * rasterizing as before.
 */
function canvasOf(html: string): { width: number; height: number } {
  const rootTag = /<div[^>]*\bid="kakeai-root"[^>]*>/iu.exec(html)?.[0] ?? "";
  const width = Number(/\bdata-width\s*=\s*["'](\d+)["']/iu.exec(rootTag)?.[1]);
  const height = Number(/\bdata-height\s*=\s*["'](\d+)["']/iu.exec(rootTag)?.[1]);
  if (outputProfileForDimensions(width, height) === null) {
    return { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT };
  }
  return { width, height };
}

/**
 * Rasterizes a compiled preview HTML at one time. Script-version and Theme
 * previews share the rasterizer flags and the PNG dimension parsing; the
 * canvas comes from the compiled HTML, so a portrait Work rasterizes at
 * 1080x1920 without a separate argument.
 */
export async function rasterizePreviewFrame(
  rasterizer: PreviewRasterizer,
  html: string,
  timeMs: number,
  origin: string,
): Promise<RasterizedPreviewFrame> {
  const canvas = canvasOf(html);
  const png = await rasterizer.renderFrame({
    html,
    width: canvas.width,
    height: canvas.height,
    timeMs,
    origin,
  });
  return { png, ...parsePngDimensions(png) };
}
