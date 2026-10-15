import { describe, expect, it } from "vitest";
import {
  EDITOR_LAYOUT_DEFAULT_RATIOS,
  EDITOR_LAYOUT_MAX_PREVIEW_RATIO,
  EDITOR_LAYOUT_MIN_CENTER_PX,
  EDITOR_LAYOUT_MIN_LEFT_PX,
  EDITOR_LAYOUT_MIN_PREVIEW_PX,
  EDITOR_LAYOUT_STORAGE_KEY,
  loadLayoutRatios,
  parseLayoutRatios,
  resetLayoutRatios,
  resolvePaneWidths,
  saveLayoutRatios,
  sanitizeLayoutRatios,
  serializeLayoutRatios,
  shiftLayoutRatio,
  type EditorLayoutRatios,
} from "./editorLayout";

function fakeStorage(initial: Record<string, string> = {}): {
  store: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
} {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

describe("parseLayoutRatios", () => {
  it("returns ratios for a well formed value", () => {
    expect(parseLayoutRatios('{"left":0.25,"preview":0.4}')).toEqual({
      left: 0.25,
      preview: 0.4,
    });
  });

  it("ignores null, empty, and corrupt values", () => {
    expect(parseLayoutRatios(null)).toBeNull();
    expect(parseLayoutRatios(undefined)).toBeNull();
    expect(parseLayoutRatios("")).toBeNull();
    expect(parseLayoutRatios("not json")).toBeNull();
    expect(parseLayoutRatios("[0.2,0.36]")).toBeNull();
  });

  it("ignores out of range and non numeric values", () => {
    expect(parseLayoutRatios('{"left":0,"preview":0.4}')).toBeNull();
    expect(parseLayoutRatios('{"left":-0.2,"preview":0.4}')).toBeNull();
    expect(parseLayoutRatios('{"left":1.2,"preview":0.4}')).toBeNull();
    expect(parseLayoutRatios('{"left":"0.2","preview":0.4}')).toBeNull();
    expect(parseLayoutRatios('{"left":0.7,"preview":0.4}')).toBeNull();
    expect(parseLayoutRatios('{"left":null,"preview":0.4}')).toBeNull();
  });
});

describe("sanitizeLayoutRatios", () => {
  it("keeps valid ratios and falls back for invalid ones", () => {
    const fallback: EditorLayoutRatios = { left: 0.2, preview: 0.36 };
    expect(sanitizeLayoutRatios({ left: 0.25, preview: 0.4 }, fallback)).toEqual({
      left: 0.25,
      preview: 0.4,
    });
    expect(sanitizeLayoutRatios({ left: 0, preview: 0.4 }, fallback)).toEqual(fallback);
    expect(sanitizeLayoutRatios({ left: 0.6, preview: 0.5 }, fallback)).toEqual(fallback);
  });
});

describe("shiftLayoutRatio", () => {
  it("shifts the dragged pane by the pixel delta", () => {
    const next = shiftLayoutRatio({ left: 0.2, preview: 0.36 }, 1000, "left", 50);
    expect(next.left).toBeCloseTo(0.25);
    expect(next.preview).toBeCloseTo(0.36);
    const previewNext = shiftLayoutRatio({ left: 0.2, preview: 0.36 }, 1000, "preview", 100);
    expect(previewNext.preview).toBeCloseTo(0.26);
  });

  it("keeps the previous ratios when the shift would overflow", () => {
    const current: EditorLayoutRatios = { left: 0.2, preview: 0.36 };
    expect(shiftLayoutRatio(current, 1000, "left", 1000)).toEqual(current);
    expect(shiftLayoutRatio(current, 0, "left", 50)).toEqual(current);
  });
});

describe("resolvePaneWidths", () => {
  it("applies the default ratios within the pane constraints", () => {
    const widths = resolvePaneWidths(1400, EDITOR_LAYOUT_DEFAULT_RATIOS);
    expect(widths.left).toBeCloseTo(280);
    expect(widths.preview).toBeCloseTo(504);
    expect(widths.center).toBeCloseTo(616);
  });

  it("allows the preview pane beyond the previous fixed upper bound", () => {
    const widths = resolvePaneWidths(1600, { left: 0.15, preview: 0.5 });
    expect(widths.preview).toBeCloseTo(800);
    expect(widths.center).toBeGreaterThanOrEqual(EDITOR_LAYOUT_MIN_CENTER_PX);
  });

  it("clamps too narrow saved values on restore", () => {
    const widths = resolvePaneWidths(1400, { left: 0.01, preview: 0.1 });
    expect(widths.left).toBeGreaterThanOrEqual(EDITOR_LAYOUT_MIN_LEFT_PX);
    expect(widths.preview).toBeGreaterThanOrEqual(EDITOR_LAYOUT_MIN_PREVIEW_PX);
  });

  it("clamps too wide saved values on restore", () => {
    const workspace = 1400;
    const widths = resolvePaneWidths(workspace, { left: 0.5, preview: 0.3 });
    expect(widths.left).toBeLessThanOrEqual(360);
    expect(widths.preview).toBeLessThanOrEqual(workspace * EDITOR_LAYOUT_MAX_PREVIEW_RATIO);
    expect(widths.left + widths.center + widths.preview).toBeLessThanOrEqual(workspace);
  });

  it("protects the center minimum width by shrinking the outer panes", () => {
    const widths = resolvePaneWidths(1100, { left: 0.3, preview: 0.45 });
    expect(widths.center).toBeGreaterThanOrEqual(EDITOR_LAYOUT_MIN_CENTER_PX);
    expect(widths.left + widths.center + widths.preview).toBeLessThanOrEqual(1100);
  });
});

describe("layout storage", () => {
  it("round trips through load, save, and reset", () => {
    const storage = fakeStorage();
    expect(loadLayoutRatios(storage)).toEqual(EDITOR_LAYOUT_DEFAULT_RATIOS);
    saveLayoutRatios(storage, { left: 0.25, preview: 0.4 });
    expect(storage.store.get(EDITOR_LAYOUT_STORAGE_KEY)).toBe(
      serializeLayoutRatios({ left: 0.25, preview: 0.4 }),
    );
    expect(loadLayoutRatios(storage)).toEqual({ left: 0.25, preview: 0.4 });
    resetLayoutRatios(storage);
    expect(loadLayoutRatios(storage)).toEqual(EDITOR_LAYOUT_DEFAULT_RATIOS);
  });

  it("falls back to defaults for corrupt stored values", () => {
    const storage = fakeStorage({ [EDITOR_LAYOUT_STORAGE_KEY]: "broken" });
    expect(loadLayoutRatios(storage)).toEqual(EDITOR_LAYOUT_DEFAULT_RATIOS);
  });
});
