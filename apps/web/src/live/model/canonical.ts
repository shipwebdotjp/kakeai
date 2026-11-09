/**
 * Stable JSON used only for dirty checks and state comparisons. Object keys are
 * sorted so a locally reordered copy of a server document does not look dirty.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] !== undefined) {
        sorted[key] = sortValue(record[key]);
      }
    }
    return sorted;
  }
  return value;
}
