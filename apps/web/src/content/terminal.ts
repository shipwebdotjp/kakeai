type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArray(value: string): Json[] | null {
  if (value.trim().length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(isRecord) ? (parsed as Json[]) : null;
  } catch {
    return null;
  }
}

export function parseTerminalTurns(value: string): Json[] | null {
  return parseArray(value);
}

export function parseTerminalEffects(value: string): Json[] | null {
  return parseArray(value);
}

/**
 * Rewrites `target.index` for terminal reveal effects. Returning `null` from
 * `mapIndex` drops the effect; other entries are left untouched. Returns null
 * when the stored JSON cannot be read, so callers can leave it for manual
 * repair instead of destroying it.
 */
export function remapTerminalEffectTargets(
  value: string,
  mapIndex: (index: number) => number | null,
): string | null {
  const entries = parseArray(value);
  if (entries === null) {
    return null;
  }
  const next: Json[] = [];
  for (const entry of entries) {
    const target = entry.target;
    if (
      !isRecord(target) ||
      target.kind !== "turn" ||
      typeof target.index !== "number" ||
      !Number.isInteger(target.index)
    ) {
      next.push(entry);
      continue;
    }
    const mapped = mapIndex(target.index);
    if (mapped === null) {
      continue;
    }
    next.push({ ...entry, target: { ...target, index: mapped } });
  }
  return JSON.stringify(next);
}

export function firstUnusedTerminalLineId(
  effectsValue: string,
  lines: readonly { id: string }[],
): string | null {
  const entries = parseArray(effectsValue);
  if (entries === null) {
    return null;
  }
  const used = new Set<string>();
  for (const entry of entries) {
    const trigger = entry.trigger;
    if (
      isRecord(trigger) &&
      trigger.kind === "lines" &&
      typeof trigger.startLineId === "string"
    ) {
      used.add(trigger.startLineId);
      if (typeof trigger.endLineId === "string") {
        used.add(trigger.endLineId);
      }
    }
  }
  return lines.find((line) => !used.has(line.id))?.id ?? null;
}

export function appendTerminalRevealEffect(
  effectsValue: string,
  turnIndex: number,
  lineId: string,
): string | null {
  const entries = parseArray(effectsValue);
  if (entries === null) {
    return null;
  }
  return JSON.stringify([
    ...entries,
    {
      target: { kind: "turn", index: turnIndex },
      trigger: { kind: "lines", startLineId: lineId, endLineId: lineId },
      effect: { kind: "reveal", mode: "type" },
    },
  ]);
}
