export const EDITOR_FOLD_STORAGE_PREFIX = "kakeai.editor.fold.v1:";

const FACESET_OPEN_PREFIX = "faceset-open:";

export type SceneSectionKind = "visual" | "audio" | "lines";

export function sceneFoldKey(sceneId: string): string {
  return `scene-open:${sceneId}`;
}

export function sectionFoldKey(sceneId: string, section: SceneSectionKind): string {
  return `section:${section}:${sceneId}`;
}

export function faceSetFoldKey(faceSetId: string): string {
  return `${FACESET_OPEN_PREFIX}${faceSetId}`;
}

export function isPersistedFoldKey(key: string): boolean {
  return (
    key.startsWith("scene-open:") || key.startsWith("section:") || key.startsWith(FACESET_OPEN_PREFIX)
  );
}

export function foldStorageKey(scope: string): string {
  return `${EDITOR_FOLD_STORAGE_PREFIX}${scope}`;
}

export interface FoldStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * localStorageに保存された折りたたみ状態を読み込む。
 * 壊れたJSON・想定外の形は空扱いにし、boolean以外の値は捨てる。
 */
export function parseFoldEntries(raw: string | null | undefined): Map<string, boolean> {
  const entries = new Map<string, boolean>();
  if (raw === null || raw === undefined || raw.trim().length === 0) {
    return entries;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return entries;
  }
  if (!isRecord(parsed)) {
    return entries;
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (!isPersistedFoldKey(key) || typeof value !== "boolean") {
      continue;
    }
    entries.set(key, value);
  }
  return entries;
}

export function serializeFoldEntries(entries: ReadonlyMap<string, boolean>): string {
  const record: Record<string, boolean> = {};
  for (const [key, value] of entries) {
    if (!isPersistedFoldKey(key)) {
      continue;
    }
    record[key] = value;
  }
  return JSON.stringify(record);
}

export function loadFoldEntries(storage: FoldStorage | null, storageKey: string): Map<string, boolean> {
  if (storage === null) {
    return new Map();
  }
  try {
    return parseFoldEntries(storage.getItem(storageKey));
  } catch {
    return new Map();
  }
}

export function saveFoldEntries(
  storage: FoldStorage | null,
  storageKey: string,
  entries: ReadonlyMap<string, boolean>,
): void {
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(storageKey, serializeFoldEntries(entries));
  } catch {
    // 保存不可時は無視する
  }
}
