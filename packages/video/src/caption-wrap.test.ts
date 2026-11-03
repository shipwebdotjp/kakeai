import { describe, expect, it } from "vitest";
import { captionWrapCore, createCaptionWrapCore, type CaptionWrapLimits } from "./caption-wrap";
import { getCaptionWrapRuntimeSource } from "./caption-wrap-runtime";

const LANDSCAPE: CaptionWrapLimits = { wrapUnitsPerLine: 56, maxLines: 2 };
const PORTRAIT: CaptionWrapLimits = { wrapUnitsPerLine: 44, maxLines: 3 };

/** 1 unit = 20px (a full-width glyph is 40px). */
function units(text: string): number {
  return captionWrapCore
    .segmentGraphemes(text)
    .reduce((total, cluster) => total + clusterWidth(cluster), 0);
}

function clusterWidth(cluster: string): number {
  const text = cluster;
  // Test-only approximation: full-width CJK and emoji are 2 units, the rest 1.
  return /[\u3000-\u9fff\uff00-\uff60\u{1f000}-\u{1faff}]/u.test(text) ? 2 : 1;
}

function measure(lines: readonly string[]): number[] {
  return lines.map((line) => units(line) * 20);
}

function wrap(text: string, limits: CaptionWrapLimits, maxWidthPx: number) {
  return captionWrapCore.plan(text, {
    limits,
    maxWidthPx,
    measure,
  });
}

describe("captionWrapCore line count", () => {
  it("keeps 28 full-width characters on one landscape line", () => {
    const result = wrap("あ".repeat(28), LANDSCAPE, 1520);
    expect(result).toEqual({ lines: ["あ".repeat(28)], overflow: false });
  });

  it("wraps 29 full-width characters into two balanced landscape lines", () => {
    const result = wrap("あ".repeat(29), LANDSCAPE, 1520);
    expect(result.overflow).toBe(false);
    expect(result.lines).toEqual(["あ".repeat(14), "あ".repeat(15)]);
  });

  it("wraps 38 characters even though they physically fit one line", () => {
    const result = wrap("あ".repeat(38), LANDSCAPE, 1520);
    expect(result.overflow).toBe(false);
    expect(result.lines).toEqual(["あ".repeat(19), "あ".repeat(19)]);
  });

  it("wraps 23 full-width characters into two portrait lines", () => {
    const result = wrap("あ".repeat(23), PORTRAIT, 880);
    expect(result.overflow).toBe(false);
    expect(result.lines).toEqual(["あ".repeat(11), "あ".repeat(12)]);
  });

  it("uses three portrait lines when two lines cannot fit the width", () => {
    const result = wrap("あ".repeat(60), PORTRAIT, 880);
    expect(result.overflow).toBe(false);
    expect(result.lines).toEqual([
      "あ".repeat(20),
      "あ".repeat(20),
      "あ".repeat(20),
    ]);
  });

  it("does not wrap when the allowed line count cannot fit the width", () => {
    const text = "あ".repeat(100);
    const result = wrap(text, LANDSCAPE, 1520);
    expect(result).toEqual({ lines: [text], overflow: true });
  });

  it("leaves text unbroken when a measurement batch is invalid", () => {
    const text = "あ".repeat(29);
    const result = captionWrapCore.plan(text, {
      limits: LANDSCAPE,
      maxWidthPx: 1520,
      measure: () => [],
    });
    expect(result).toEqual({ lines: [text], overflow: true });
  });
});

describe("captionWrapCore boundaries", () => {
  it("keeps explicit line breaks and wraps each paragraph independently", () => {
    const result = wrap(`あ${"い".repeat(28)}\n短い段落`, LANDSCAPE, 1520);
    expect(result.lines).toEqual([
      `あ${"い".repeat(13)}`,
      "い".repeat(15),
      "短い段落",
    ]);
  });

  it("keeps empty explicit lines", () => {
    expect(wrap("あ\n\nい", LANDSCAPE, 1520).lines).toEqual(["あ", "", "い"]);
  });

  it("does not put a period at the start of a wrapped line", () => {
    const result = wrap(`${"あ".repeat(14)}。${"あ".repeat(14)}`, LANDSCAPE, 1520);
    expect(result.lines).toEqual([`${"あ".repeat(14)}。`, "あ".repeat(14)]);
  });

  it("does not end a wrapped line with an opening bracket", () => {
    const result = wrap(`${"あ".repeat(14)}「${"あ".repeat(14)}`, LANDSCAPE, 1520);
    expect(result.lines).toEqual([
      "あ".repeat(14),
      `「${"あ".repeat(14)}`,
    ]);
  });

  it("does not put a small kana at the start of a wrapped line", () => {
    const result = wrap(`${"あ".repeat(14)}っ${"あ".repeat(14)}`, LANDSCAPE, 1520);
    expect(result.lines).toEqual([`${"あ".repeat(14)}っ`, "あ".repeat(14)]);
  });

  it("does not split a Latin word", () => {
    const boundaries = captionWrapCore.candidateBoundaries(
      captionWrapCore.segmentGraphemes("hello world"),
    );
    // Only the boundary after the space is a candidate.
    expect(boundaries).toEqual([6]);
  });

  it("leaves an over-long word unbroken instead of cutting at an arbitrary position", () => {
    const text = "supercalifragilisticexpialidocious";
    const result = wrap(text, LANDSCAPE, 100);
    expect(result).toEqual({ lines: [text], overflow: true });
  });

  it("does not split a decimal number", () => {
    const boundaries = captionWrapCore.candidateBoundaries(
      captionWrapCore.segmentGraphemes("3.14 meters"),
    );
    expect(boundaries).toEqual([5]);
  });

  it("keeps half-width and full-width mixes measured in units", () => {
    const text = `${"a".repeat(30)}${"あ".repeat(13)}`; // 30 + 26 = 56 units
    expect(wrap(text, LANDSCAPE, 1520).lines).toEqual([text]);
    const longer = `${"a".repeat(30)}${"あ".repeat(14)}`; // 58 units
    expect(wrap(longer, LANDSCAPE, 1520).lines.join("").length).toBe(longer.length);
    expect(wrap(longer, LANDSCAPE, 1520).lines.length).toBe(2);
  });
});

describe("captionWrapCore grapheme safety", () => {
  it("keeps combining sequences and ZWJ emoji in one cluster", () => {
    expect(captionWrapCore.segmentGraphemes("ｶ\u3099")).toEqual(["ｶ\u3099"]);
    expect(captionWrapCore.segmentGraphemes("👨‍👩‍👧‍👦")).toEqual(["👨‍👩‍👧‍👦"]);
  });

  it("never splits a grapheme cluster when wrapping", () => {
    const family = "👨‍👩‍👧‍👦";
    const text = `${"あ".repeat(14)}${family}${"あ".repeat(14)}`;
    const result = wrap(text, LANDSCAPE, 1520);
    expect(result.overflow).toBe(false);
    expect(result.lines.join("")).toBe(text);
    expect(result.lines.some((line) => line.includes(family))).toBe(true);
  });
});

describe("captionWrapCore determinism", () => {
  it("selects the same split regardless of the caller instance", () => {
    const other = createCaptionWrapCore((text) => units(text));
    const text = `${"あ".repeat(14)}。${"あ".repeat(14)}`;
    const first = wrap(text, LANDSCAPE, 1520);
    const second = other.plan(text, {
      limits: LANDSCAPE,
      maxWidthPx: 1520,
      measure,
    });
    expect(second.lines).toEqual(first.lines);
  });
});

describe("caption wrap runtime source", () => {
  it("is self-contained JavaScript without module imports", () => {
    const source = getCaptionWrapRuntimeSource();
    expect(source).not.toContain("import ");
    expect(source).not.toContain("</script");
    expect(() => new Function(source)).not.toThrow();
  });

  it("wraps a caption, inserts only <br>, and marks the document ready", async () => {
    const captionText = "あ".repeat(29);
    const caption = new FakeElement("p", {
      "data-kakeai-caption-wrap": "1",
      "data-kakeai-caption-wrap-units": "56",
      "data-kakeai-caption-wrap-lines": "2",
      "data-kakeai-caption-wrap-width": "1520",
    });
    caption.textContent = captionText;
    const root = new FakeElement("div", {});
    root.id = "kakeai-root";
    const documentAny = createFakeDocument(root, [caption]);

    const globalAny = globalThis as any;
    const previousDocument = globalAny.document;
    const previousInstalled = globalAny.__kakeaiCaptionWrapInstalled;
    const previousReady = globalAny.__kakeaiCaptionWrapReady;
    globalAny.document = documentAny;
    delete globalAny.__kakeaiCaptionWrapInstalled;
    delete globalAny.__kakeaiCaptionWrapReady;
    try {
      new Function(getCaptionWrapRuntimeSource())();
      await globalAny.__kakeaiCaptionWrapReady;
    } finally {
      globalAny.document = previousDocument;
      if (previousInstalled === undefined) {
        delete globalAny.__kakeaiCaptionWrapInstalled;
      } else {
        globalAny.__kakeaiCaptionWrapInstalled = previousInstalled;
      }
      if (previousReady === undefined) {
        delete globalAny.__kakeaiCaptionWrapReady;
      } else {
        globalAny.__kakeaiCaptionWrapReady = previousReady;
      }
    }

    expect(caption.textContent).toBe(captionText);
    expect(caption.children.filter((child) => child.tagName === "br")).toHaveLength(1);
    expect(caption.children[0]?.textContent).toBe("あ".repeat(14));
    expect(caption.children[2]?.textContent).toBe("あ".repeat(15));
    expect(root.getAttribute("data-kakeai-caption-wrap-ready")).toBe("1");
  });
});

class FakeElement {
  tagName: string;
  id = "";
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  style: any = { setProperty: () => undefined };

  constructor(tagName: string, attributes: Record<string, string>) {
    this.tagName = tagName;
    for (const [key, value] of Object.entries(attributes)) {
      this.attributes.set(key, value);
    }
  }

  get textContent(): string {
    if (this.tagName === "#text") {
      return this.textContentValue;
    }
    return this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    if (this.tagName === "#text") {
      this.textContentValue = value;
      return;
    }
    const text = new FakeElement("#text", {});
    text.textContentValue = value;
    this.children = [];
    this.appendChild(text);
  }

  textContentValue = "";

  get firstChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  appendChild(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }

  removeChild(child: FakeElement): void {
    this.children = this.children.filter((entry) => entry !== child);
    child.parent = null;
  }

  remove(): void {
    this.parent?.removeChild(this);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  getBoundingClientRect(): { width: number } {
    return { width: units(this.textContent) * 20 };
  }
}

function createFakeDocument(root: FakeElement, captions: FakeElement[]) {
  const body = new FakeElement("body", {});
  return {
    fonts: { ready: Promise.resolve() },
    body,
    defaultView: {
      getComputedStyle: () => ({ getPropertyValue: () => "" }),
    },
    createElement: (tagName: string) => new FakeElement(tagName, {}),
    createTextNode: (value: string) => {
      const element = new FakeElement("#text", {});
      element.textContentValue = value;
      return element;
    },
    getElementById: (id: string) => (root.id === id ? root : null),
    querySelectorAll: (selector: string) =>
      selector === "[data-kakeai-caption-wrap]" ? captions : [],
  };
}
