import { createTextWidthCounter } from "@kakeai/contracts";
import {
  createCaptionWrapCore,
  type CaptionWrapCore,
} from "./caption-wrap";

/**
 * Marker on the `<script>` element that installs the browser-side caption
 * wrapping. Tests use it to assert the compiler emitted the runtime, and the
 * preview waits on `data-kakeai-caption-wrap-ready` on the root element.
 */
export const CAPTION_WRAP_SCRIPT_MARKER = "data-kakeai-caption-wrap-script";

/**
 * Installs the caption wrapping in the rendered document.
 *
 * This function is serialized with `toString()` into the composition HTML, so
 * it must stay self-contained: no imports, no module-level constants, and only
 * `globalThis` plus the `core` argument.
 */
function installCaptionWrap(core: CaptionWrapCore): void {
  const globalAny = globalThis as unknown as {
    document?: any;
    __kakeaiCaptionWrapInstalled?: boolean;
    __kakeaiCaptionWrapReady?: Promise<void>;
  };
  const documentAny = globalAny.document;
  if (
    documentAny === undefined ||
    globalAny.__kakeaiCaptionWrapInstalled === true
  ) {
    return;
  }
  globalAny.__kakeaiCaptionWrapInstalled = true;

  // `any` keeps this function serializable without dragging DOM lib types
  // into the Node package; only the members used below are touched.
  const FONT_PROPERTIES = [
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "font-variant",
    "font-feature-settings",
    "font-variation-settings",
    "font-kerning",
    "letter-spacing",
    "word-spacing",
    "text-transform",
    "text-rendering",
    "line-height",
    "direction",
    "writing-mode",
  ];

  function applyLines(element: any, lines: readonly string[]): void {
    while (element.firstChild !== null) {
      element.removeChild(element.firstChild);
    }
    lines.forEach((line, index) => {
      if (index > 0) {
        element.appendChild(documentAny.createElement("br"));
      }
      element.appendChild(documentAny.createTextNode(line));
    });
  }

  function createMeasurer(element: any): {
    measure: (lines: readonly string[]) => number[];
    destroy: () => void;
  } {
    const container = documentAny.createElement("div");
    container.className = "kakeai-caption-measure";
    container.setAttribute("data-kakeai-caption-measure", "1");
    container.setAttribute("aria-hidden", "true");
    const style = container.style;
    style.position = "absolute";
    style.left = "-100000px";
    style.top = "0";
    style.display = "block";
    style.visibility = "hidden";
    style.pointerEvents = "none";
    style.whiteSpace = "pre";
    style.margin = "0";
    style.padding = "0";
    style.border = "0";
    style.background = "none";
    const view = documentAny.defaultView;
    const computed = view === null ? null : view.getComputedStyle(element);
    if (computed !== null) {
      for (const property of FONT_PROPERTIES) {
        const value = computed.getPropertyValue(property);
        if (value.length > 0) {
          style.setProperty(property, value);
        }
      }
    }
    documentAny.body.appendChild(container);

    let nodes: any[] = [];
    function measure(lines: readonly string[]): number[] {
      for (const node of nodes) {
        node.remove();
      }
      nodes = lines.map((line) => {
        const span = documentAny.createElement("span");
        span.textContent = line;
        container.appendChild(span);
        return span;
      });
      // Read after every span is in the document so one layout serves all.
      return nodes.map((node) => node.getBoundingClientRect().width as number);
    }

    return {
      measure,
      destroy() {
        container.remove();
      },
    };
  }

  function wrapAll(): void {
    const elements = documentAny.querySelectorAll(
      "[data-kakeai-caption-wrap]",
    );
    for (const element of Array.from(elements) as any[]) {
      if (element.getAttribute("data-kakeai-caption-wrap-done") === "1") {
        continue;
      }
      const units = Number(
        element.getAttribute("data-kakeai-caption-wrap-units"),
      );
      const maxLines = Number(
        element.getAttribute("data-kakeai-caption-wrap-lines"),
      );
      const maxWidthPx = Number(
        element.getAttribute("data-kakeai-caption-wrap-width"),
      );
      if (!(units > 0) || !(maxLines >= 1) || !(maxWidthPx > 0)) {
        continue;
      }
      const text = element.textContent ?? "";
      if (text.length === 0) {
        element.setAttribute("data-kakeai-caption-wrap-done", "1");
        continue;
      }
      const measurer = createMeasurer(element);
      try {
        const result = core.plan(text, {
          limits: { wrapUnitsPerLine: units, maxLines },
          maxWidthPx,
          measure: measurer.measure,
        });
        applyLines(element, result.lines);
      } catch {
        // One caption's failure must not leave the rest unwrapped.
        element.setAttribute("data-kakeai-caption-wrap-failed", "1");
      } finally {
        measurer.destroy();
      }
      element.setAttribute("data-kakeai-caption-wrap-done", "1");
    }
  }

  const ready = (async () => {
    try {
      const fonts = documentAny.fonts;
      if (fonts !== undefined && fonts.ready !== undefined) {
        // A font request that never settles must not block the timeline.
        const fontTimeout = new Promise((resolve) => {
          setTimeout(resolve, 8000);
        });
        await Promise.race([fonts.ready, fontTimeout]);
      }
    } catch {
      // A font failure must not leave the caption unwrapped.
    }
    try {
      wrapAll();
    } finally {
      const root = documentAny.getElementById("kakeai-root");
      if (root !== null) {
        root.setAttribute("data-kakeai-caption-wrap-ready", "1");
      }
    }
  })();
  globalAny.__kakeaiCaptionWrapReady = ready;
}

/**
 * Self-contained browser script that wraps baked-in captions after fonts are
 * ready. It reads the original text from the DOM (never interpolates user text
 * into script source) and replaces only child nodes with text and `<br>`.
 */
let cachedSource: string | undefined;

export function getCaptionWrapRuntimeSource(): string {
  if (cachedSource !== undefined) {
    return cachedSource;
  }
  const body = [
    "const widthCounter=(" + createTextWidthCounter.toString() + ")();",
    "const core=(" +
      createCaptionWrapCore.toString() +
      ")(widthCounter.textWidthUnits);",
    "(" + installCaptionWrap.toString() + ")(core);",
  ].join("\n");
  // Transpilers with `keepNames` (tsx/esbuild) wrap nested functions with a
  // module-scope `__name` helper. `toString()` loses that scope, so declare a
  // local no-op shim for every helper the serialized source still calls.
  const helperNames = new Set<string>();
  for (const match of body.matchAll(/\b(__[A-Za-z0-9_]+)\s*\(/g)) {
    const name = match[1];
    if (name !== undefined && /^__name\d*$/.test(name)) {
      helperNames.add(name);
    }
  }
  const shims = [...helperNames].map(
    (name) =>
      `const ${name}=(target,value)=>{try{Object.defineProperty(target,"name",{value,configurable:true})}catch{}return target};`,
  );
  cachedSource = ["(function(){", ...shims, body, "})();"]
    .join("\n")
    .replace(/<\/script/gi, "<\\/script");
  return cachedSource;
}
