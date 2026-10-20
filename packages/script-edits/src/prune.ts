import {
  collectVideoPlaybackLineRefs,
  getVisualTemplate,
  type LineReference,
  type VisualCue,
} from "@kakeai/contracts";

interface ArrayRemoval {
  parent: (string | number)[];
  indices: Set<number>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function findLastNumericIndex(path: (string | number)[]): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    if (typeof path[index] === "number") {
      return index;
    }
  }
  return -1;
}

function getAtPath(root: unknown, path: (string | number)[]): unknown {
  let current = root;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[segment];
      continue;
    }
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function removeEmptyVideoPlayback(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      removeEmptyVideoPlayback(entry);
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const record = value as Record<string, unknown>;
  const playback = record.videoPlayback;
  if (typeof playback === "object" && playback !== null && !Array.isArray(playback)) {
    const gates = (playback as Record<string, unknown>).gates;
    if (Array.isArray(gates) && gates.length === 0) {
      delete record.videoPlayback;
    }
  }
  for (const child of Object.values(record)) {
    removeEmptyVideoPlayback(child);
  }
}

function applyLineRemovals(root: unknown, references: readonly LineReference[]): void {
  const arrayRemovals = new Map<string, ArrayRemoval>();
  const propertyRemovals: (string | number)[][] = [];

  for (const reference of references) {
    const numericIndex = findLastNumericIndex(reference.path);
    if (numericIndex === -1) {
      propertyRemovals.push(reference.path);
      continue;
    }
    const parent = reference.path.slice(0, numericIndex);
    const key = JSON.stringify(parent);
    const removal = arrayRemovals.get(key) ?? { parent, indices: new Set<number>() };
    removal.indices.add(reference.path[numericIndex] as number);
    arrayRemovals.set(key, removal);
  }

  for (const removal of arrayRemovals.values()) {
    const target = getAtPath(root, removal.parent);
    if (!Array.isArray(target)) {
      continue;
    }
    const kept = target.filter((_entry, index) => !removal.indices.has(index));
    target.splice(0, target.length, ...kept);
  }

  for (const path of propertyRemovals) {
    const container = path[0];
    if (typeof container !== "string") {
      continue;
    }
    if (typeof root !== "object" || root === null || Array.isArray(root)) {
      continue;
    }
    delete (root as Record<string, unknown>)[container];
  }

  removeEmptyVideoPlayback(root);
}

function cueLineReferences(cue: VisualCue): LineReference[] {
  const definition = getVisualTemplate(cue.template.id, cue.template.version);
  const templateReferences = definition?.collectLineRefs?.(cue.input, []) ?? [];
  return [...templateReferences, ...collectVideoPlaybackLineRefs(cue.input, [])];
}

export function pruneCueForLines(
  cue: VisualCue,
  allowedLineIds: ReadonlySet<string>,
): VisualCue | null {
  const removed = cueLineReferences(cue).filter(
    (reference) => !allowedLineIds.has(reference.lineId),
  );
  if (removed.length === 0) {
    return cue;
  }
  const input = cloneJson(cue.input);
  applyLineRemovals(input, removed);
  const definition = getVisualTemplate(cue.template.id, cue.template.version);
  if (definition !== undefined && !definition.inputSchema.safeParse(input).success) {
    return null;
  }
  return { ...cue, input };
}
