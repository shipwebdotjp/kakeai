import { acquireBrowser, buildChromeArgs } from "@hyperframes/engine";
import { getHyperframeRuntimeScript } from "@hyperframes/core/runtime-script";
import { previewHostUrl } from "../http/security.ts";

export interface PreviewFrameRequest {
  /** Compiled composition HTML (the same HTML the Web UI preview receives). */
  html: string;
  width: number;
  height: number;
  /** Timeline position to capture. */
  timeMs: number;
  /** Loopback origin of the running app, e.g. `http://127.0.0.1:4317`. */
  origin: string;
}

export interface PreviewRasterizer {
  renderFrame(request: PreviewFrameRequest): Promise<Buffer>;
}

const PAGE_TIMEOUT_MS = 15_000;
const RUNTIME_READY_TIMEOUT_MS = 5_000;
/** Overall cap for goto + setContent + ready + seek + screenshot. */
const RENDER_FRAME_TIMEOUT_MS = 30_000;
/** Bounds cleanup so one wedged page or browser cannot stall the shared queue. */
const CLEANUP_TIMEOUT_MS = 5_000;

/**
 * The verified HyperFrames runtime is the same script the Web UI player injects.
 * It understands `window.__timelines`, expands nested compositions, and seeks
 * `<video>` elements while the timeline is seeked.
 */
const RUNTIME_SCRIPT = getHyperframeRuntimeScript();
const RUNTIME_MARKER = "data-kakeai-preview-runtime";

/**
 * The runtime must run before the composition's own scripts, because those
 * scripts assign into `window.__timelines`. The Web UI player injects it before
 * the composition scripts for the same reason.
 */
export function injectPreviewRuntime(html: string): string {
  if (html.includes(RUNTIME_MARKER)) {
    return html;
  }
  const script = `<script ${RUNTIME_MARKER}>${RUNTIME_SCRIPT}</script>`;
  // Keep <meta charset> inside the first 1024 bytes; the runtime is ~500KB.
  const charset = /<meta\b[^>]*\bcharset\b[^>]*>/i.exec(html);
  if (charset !== null) {
    const end = charset.index + charset[0].length;
    return `${html.slice(0, end)}${script}${html.slice(end)}`;
  }
  if (/<head\b[^>]*>/i.test(html)) {
    return html.replace(/<head\b[^>]*>/i, (tag) => `${tag}${script}`);
  }
  if (/<html\b[^>]*>/i.test(html)) {
    return html.replace(/<html\b[^>]*>/i, (tag) => `${tag}${script}`);
  }
  return `${script}${html}`;
}

const WAIT_FOR_READY_SCRIPT = `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const deadline = Date.now() + ${RUNTIME_READY_TIMEOUT_MS};
  while (Date.now() < deadline) {
    const player = window.__player;
    if (player && typeof player.getDuration === "function" && player.getDuration() > 0) {
      break;
    }
    await sleep(50);
  }
  const player = window.__player;
  if (!player || typeof player.getDuration !== "function" || player.getDuration() <= 0) {
    return false;
  }

  await document.fonts.ready.catch(() => {});

  await Promise.all([...document.images].map((img) => {
    if (img.complete) return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", resolve, { once: true });
    });
  }));

  await Promise.all([...document.querySelectorAll("video")].map((video) => {
    if (video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve) => {
      video.addEventListener("loadeddata", resolve, { once: true });
      video.addEventListener("error", resolve, { once: true });
      setTimeout(resolve, 3000);
    });
  }));

  const hosts = [...document.querySelectorAll("[data-composition-src]")];
  await Promise.all(hosts.map(async (host) => {
    const childDeadline = Date.now() + 3000;
    while (
      Date.now() < childDeadline &&
      host.children.length === 0 &&
      !host.hasAttribute("data-hf-inner")
    ) {
      await sleep(50);
    }
  }));

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`;

function seekScript(timeMs: number): string {
  const seconds = Math.max(0, timeMs) / 1000;
  return `
(async () => {
  const player = window.__player;
  if (!player || typeof player.seek !== "function") {
    return false;
  }
  player.seek(${JSON.stringify(seconds)});

  await new Promise((resolve) => setTimeout(resolve, 30));
  await Promise.all([...document.querySelectorAll("video")]
    .filter((video) => video.seeking)
    .map((video) => new Promise((resolve) => {
      video.addEventListener("seeked", resolve, { once: true });
      setTimeout(resolve, 1500);
    })));

  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 30));
  return true;
})()
`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  });
}

interface ClosablePage {
  close(): Promise<void>;
  isClosed(): boolean;
}

async function closePageSafely(page: ClosablePage): Promise<void> {
  if (page.isClosed()) {
    return;
  }
  await withTimeout(
    page.close(),
    CLEANUP_TIMEOUT_MS,
    "プレビューのページ解放がタイムアウトしました。",
  ).catch(() => undefined);
}

/**
 * Serializes preview rasterization. A single page at 1920x1080 is cheap, but a
 * burst from several agent connections must not spawn several browsers' worth
 * of pages and CPU at once.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeOrigin(origin: string): string {
  return new URL(origin).origin;
}

export function createBrowserPreviewRasterizer(): PreviewRasterizer {
  return {
    renderFrame(request: PreviewFrameRequest): Promise<Buffer> {
      return serialize(() => renderFrame(request));
    },
  };
}

async function renderFrame(request: PreviewFrameRequest): Promise<Buffer> {
  const origin = normalizeOrigin(request.origin);
  const lease = await acquireBrowser(
    buildChromeArgs({
      width: request.width,
      height: request.height,
      captureMode: "screenshot",
    }),
    { forceScreenshot: true },
  );
  let page: Awaited<ReturnType<typeof lease.browser.newPage>> | undefined;
  try {
    page = await lease.browser.newPage();
    const currentPage = page;
    const pageErrors: string[] = [];
    currentPage.on("pageerror", (error: unknown) => {
      pageErrors.push(error instanceof Error ? error.message : String(error));
    });
    await currentPage.setViewport({
      width: request.width,
      height: request.height,
      deviceScaleFactor: 1,
    });

    // The compiled HTML references the app's absolute /api/v1 asset and
    // composition URLs. Deny everything else so a composition cannot make the
    // headless browser fetch arbitrary origins.
    await currentPage.setRequestInterception(true);
    currentPage.on("request", (intercepted) => {
      const url = intercepted.url();
      const allowed =
        url.startsWith(`${origin}/`) ||
        url.startsWith("data:") ||
        url.startsWith("blob:") ||
        url === "about:blank";
      if (allowed) {
        intercepted.continue().catch(() => undefined);
      } else {
        intercepted.abort().catch(() => undefined);
      }
    });

    const work = (async () => {
      // Navigate once so the document has the app origin and receives the
      // same-origin media session cookie. The host endpoint must be text/html;
      // setContent on a JSON document would not execute the composition scripts.
      await currentPage.goto(previewHostUrl(origin), {
        waitUntil: "domcontentloaded",
        timeout: RUNTIME_READY_TIMEOUT_MS,
      });
      await currentPage.setContent(injectPreviewRuntime(request.html), {
        waitUntil: "load",
        timeout: PAGE_TIMEOUT_MS,
      });

      const ready = await currentPage.evaluate(WAIT_FOR_READY_SCRIPT);
      if (ready !== true) {
        const detail =
          pageErrors.length === 0
            ? ""
            : ` (${pageErrors.slice(0, 3).join(" / ")})`;
        throw new Error(`プレビューの準備ができませんでした。${detail}`);
      }

      const seeked = await currentPage.evaluate(seekScript(request.timeMs));
      if (seeked !== true) {
        throw new Error("プレビューの再生位置を解決できませんでした。");
      }

      const png = await currentPage.screenshot({ type: "png" });
      return Buffer.from(png);
    })();

    try {
      return await withTimeout(
        work,
        RENDER_FRAME_TIMEOUT_MS,
        "プレビューのPNG生成がタイムアウトしました。",
      );
    } finally {
      // Closing the page rejects pending CDP calls even when a wedged renderer
      // never settles `work`; do not await it, or the queue could hang forever.
      await closePageSafely(currentPage);
      void work.catch(() => undefined);
    }
  } finally {
    if (page !== undefined) {
      await closePageSafely(page);
    }
    await withTimeout(
      lease.release(),
      CLEANUP_TIMEOUT_MS,
      "プレビューのブラウザ解放がタイムアウトしました。",
    ).catch(() => undefined);
  }
}

let shared: PreviewRasterizer | undefined;

/**
 * The engine's browser pool owns the Chromium process; each frame leases a
 * browser and `release()` returns it to the pool. This module owns no
 * long-lived child process of its own.
 */
export function getSharedPreviewRasterizer(): PreviewRasterizer {
  shared ??= createBrowserPreviewRasterizer();
  return shared;
}
