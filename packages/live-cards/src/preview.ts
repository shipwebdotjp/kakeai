import { createLiveCardRenderer } from "./renderer";
import type { LiveCardRenderer, LiveCardRendererOptions } from "./types";

export interface LiveCardPreviewOptions
  extends Omit<LiveCardRendererOptions, "animate"> {
  /**
   * Editor previews render every snapshot completed by default. Enable only
   * for an explicit animation preview.
   */
  animate?: boolean;
}

/**
 * Editor-facing helper. It uses exactly the same renderer core as the stage,
 * but starts settled and suppresses animation unless explicitly enabled.
 */
export function createLiveCardPreview(
  host: HTMLElement,
  options: LiveCardPreviewOptions = {},
): LiveCardRenderer {
  const renderer = createLiveCardRenderer(host, {
    ...options,
    animate: options.animate ?? false,
  });
  renderer.markSettled();
  return renderer;
}
