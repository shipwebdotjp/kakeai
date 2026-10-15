import { acquireBrowser, buildChromeArgs } from "@hyperframes/engine";

export interface Rasterizer {
  renderPng(html: string, width: number, height: number): Promise<Buffer>;
}

const RENDER_TIMEOUT_MS = 15_000;

const WAIT_FOR_IMAGES_SCRIPT =
  "Promise.all([...document.images].map((img) => (img.complete && img.naturalWidth > 0) ? Promise.resolve() : new Promise((resolve) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); })))";

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error("サムネイルのPNG生成がタイムアウトしました。"));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

export function createBrowserRasterizer(): Rasterizer {
  return {
    async renderPng(html: string, width: number, height: number): Promise<Buffer> {
      const lease = await acquireBrowser(buildChromeArgs({ width, height, captureMode: "screenshot" }), {
        forceScreenshot: true,
      });
      try {
        const page = await lease.browser.newPage();
        const work = (async () => {
          await page.setViewport({ width, height, deviceScaleFactor: 1 });
          await page.setContent(html, { waitUntil: "load", timeout: RENDER_TIMEOUT_MS });
          await withTimeout(page.evaluate(WAIT_FOR_IMAGES_SCRIPT), RENDER_TIMEOUT_MS);
          const buffer = await page.screenshot({ type: "png" });
          return Buffer.from(buffer);
        })();
        try {
          return await withTimeout(work, RENDER_TIMEOUT_MS);
        } finally {
          await work.catch(() => undefined);
          await page.close().catch(() => {});
        }
      } finally {
        await lease.release();
      }
    },
  };
}

let shared: Rasterizer | undefined;

export function getSharedRasterizer(): Rasterizer {
  shared ??= createBrowserRasterizer();
  return shared;
}
