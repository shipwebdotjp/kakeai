import { type VisualCue } from "@kakeai/contracts";

export function readInputObject(
  cue: VisualCue | null,
): Record<string, unknown> {
  if (cue === null || typeof cue.input !== "object" || cue.input === null) {
    return {};
  }
  return { ...(cue.input as Record<string, unknown>) };
}

export function getAtPath(
  source: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (
      typeof current !== "object" ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setAtPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split(".");
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index]!;
    const next = current[key];
    const cloned =
      typeof next === "object" && next !== null && !Array.isArray(next)
        ? { ...(next as Record<string, unknown>) }
        : {};
    current[key] = cloned;
    current = cloned;
  }
  current[parts[parts.length - 1]!] = value;
}

export function deleteAtPath(
  target: Record<string, unknown>,
  path: string,
): void {
  const parts = path.split(".");
  let current: Record<string, unknown> | undefined = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next: unknown = current?.[parts[index]!];
    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      return;
    }
    const cloned: Record<string, unknown> = {
      ...(next as Record<string, unknown>),
    };
    current![parts[index]!] = cloned;
    current = cloned;
  }
  if (current !== undefined) {
    delete current[parts[parts.length - 1]!];
  }
}
