export const EDITOR_LAYOUT_STORAGE_KEY = "kakeai-editor-layout-v1";

export const EDITOR_LAYOUT_WIDE_BREAKPOINT_PX = 1280;

export const EDITOR_LAYOUT_MIN_LEFT_PX = 192;
export const EDITOR_LAYOUT_MAX_LEFT_PX = 360;
export const EDITOR_LAYOUT_MIN_CENTER_PX = 480;
export const EDITOR_LAYOUT_MIN_PREVIEW_PX = 360;
export const EDITOR_LAYOUT_MAX_PREVIEW_RATIO = 0.5;

export interface EditorLayoutRatios {
  left: number;
  preview: number;
}

export const EDITOR_LAYOUT_DEFAULT_RATIOS: EditorLayoutRatios = {
  left: 0.2,
  preview: 0.36,
};

export interface EditorLayoutWidths {
  left: number;
  center: number;
  preview: number;
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1;
}

export function parseLayoutRatios(raw: string | null | undefined): EditorLayoutRatios | null {
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const { left, preview } = parsed as Record<string, unknown>;
  if (!validRatio(left) || !validRatio(preview) || left + preview >= 1) {
    return null;
  }
  return { left, preview };
}

export function serializeLayoutRatios(ratios: EditorLayoutRatios): string {
  return JSON.stringify({ left: ratios.left, preview: ratios.preview });
}

export function sanitizeLayoutRatios(
  candidate: EditorLayoutRatios,
  fallback: EditorLayoutRatios,
): EditorLayoutRatios {
  if (!validRatio(candidate.left) || !validRatio(candidate.preview)) {
    return fallback;
  }
  if (candidate.left + candidate.preview >= 1) {
    return fallback;
  }
  return { left: candidate.left, preview: candidate.preview };
}

export function shiftLayoutRatio(
  ratios: EditorLayoutRatios,
  workspacePx: number,
  pane: "left" | "preview",
  deltaPx: number,
): EditorLayoutRatios {
  if (!Number.isFinite(workspacePx) || workspacePx <= 0 || !Number.isFinite(deltaPx)) {
    return ratios;
  }
  const delta = deltaPx / workspacePx;
  const candidate: EditorLayoutRatios =
    pane === "left"
      ? { left: ratios.left + delta, preview: ratios.preview }
      : { left: ratios.left, preview: ratios.preview - delta };
  return sanitizeLayoutRatios(candidate, ratios);
}

export function resolvePaneWidths(
  workspacePx: number,
  ratios: EditorLayoutRatios,
): EditorLayoutWidths {
  const sane = sanitizeLayoutRatios(ratios, EDITOR_LAYOUT_DEFAULT_RATIOS);
  if (!Number.isFinite(workspacePx) || workspacePx <= 0) {
    return {
      left: EDITOR_LAYOUT_MIN_LEFT_PX,
      center: EDITOR_LAYOUT_MIN_CENTER_PX,
      preview: EDITOR_LAYOUT_MIN_PREVIEW_PX,
    };
  }
  let left = clampWidth(
    workspacePx * sane.left,
    EDITOR_LAYOUT_MIN_LEFT_PX,
    EDITOR_LAYOUT_MAX_LEFT_PX,
  );
  const maxPreview = Math.max(
    EDITOR_LAYOUT_MIN_PREVIEW_PX,
    workspacePx * EDITOR_LAYOUT_MAX_PREVIEW_RATIO,
  );
  let preview = clampWidth(
    workspacePx * sane.preview,
    EDITOR_LAYOUT_MIN_PREVIEW_PX,
    maxPreview,
  );
  let center = workspacePx - left - preview;
  if (center < EDITOR_LAYOUT_MIN_CENTER_PX) {
    const shrinkPreview = Math.min(EDITOR_LAYOUT_MIN_CENTER_PX - center, preview - EDITOR_LAYOUT_MIN_PREVIEW_PX);
    if (shrinkPreview > 0) {
      preview -= shrinkPreview;
      center += shrinkPreview;
    }
    const shrinkLeft = Math.min(EDITOR_LAYOUT_MIN_CENTER_PX - center, left - EDITOR_LAYOUT_MIN_LEFT_PX);
    if (shrinkLeft > 0) {
      left -= shrinkLeft;
      center += shrinkLeft;
    }
  }
  return { left, center, preview };
}

export interface LayoutStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export function loadLayoutRatios(storage: LayoutStorage): EditorLayoutRatios {
  try {
    return parseLayoutRatios(storage.getItem(EDITOR_LAYOUT_STORAGE_KEY)) ?? {
      ...EDITOR_LAYOUT_DEFAULT_RATIOS,
    };
  } catch {
    return { ...EDITOR_LAYOUT_DEFAULT_RATIOS };
  }
}

export function saveLayoutRatios(storage: LayoutStorage, ratios: EditorLayoutRatios): void {
  try {
    storage.setItem(EDITOR_LAYOUT_STORAGE_KEY, serializeLayoutRatios(ratios));
  } catch {
  }
}

export function resetLayoutRatios(storage: LayoutStorage): void {
  try {
    storage.removeItem(EDITOR_LAYOUT_STORAGE_KEY);
  } catch {
    // 削除不可時は無視する
  }
}
