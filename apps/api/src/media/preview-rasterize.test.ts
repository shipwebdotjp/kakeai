import { describe, expect, it } from "vitest";
import { injectPreviewRuntime } from "./preview-rasterize.ts";

describe("preview runtime injection", () => {
  it("runs the runtime after the charset meta and before composition scripts", () => {
    const html =
      "<!doctype html><html><head><meta charset=\"UTF-8\"><script>window.__timelines={};</script></head><body></body></html>";
    const injected = injectPreviewRuntime(html);
    const charsetAt = injected.indexOf('<meta charset="UTF-8">');
    const runtimeAt = injected.indexOf("HyperFrames");
    const compositionAt = injected.indexOf("window.__timelines={};");

    expect(charsetAt).toBeGreaterThanOrEqual(0);
    expect(runtimeAt).toBeGreaterThan(charsetAt);
    expect(compositionAt).toBeGreaterThan(runtimeAt);
  });

  it("does not inject when the HTML already carries the preview runtime", () => {
    const html =
      '<!doctype html><html><head><meta charset="UTF-8"></head><body><script data-kakeai-preview-runtime>runtime</script></body></html>';
    expect(injectPreviewRuntime(html)).toBe(html);
  });

  it("prepends the runtime when the HTML has no head", () => {
    const injected = injectPreviewRuntime("<div>composition</div>");
    expect(injected.startsWith("<script data-kakeai-preview-runtime>")).toBe(true);
    expect(injected).toContain("<div>composition</div>");
  });
});
