import {
  CHART_LINE_MAX_CATEGORIES,
  CHART_LINE_MAX_COLUMNS,
  CHART_LINE_MAX_SERIES,
  CHART_LINE_MIN_CATEGORIES,
  chartLineDataSchema,
  tableDataSchema,
  type TableColumn,
  type TableRow,
} from "@kakeai/contracts";

export interface ChartLineGridJson {
  columns: TableColumn[];
  rows: TableRow[];
}

export interface ChartLineChoice {
  key: string;
  label: string;
}

/** Sibling field that stores the series/category effects. */
export const CHART_LINE_EFFECTS_FIELD_KEY = "effects";

export function defaultChartLineGridDataJson(): string {
  return JSON.stringify({
    columns: [
      { key: "category", label: "カテゴリ", type: "text" },
      { key: "value", label: "値", type: "number" },
    ],
    rows: [
      { category: "項目1", value: 0 },
      { category: "項目2", value: 0 },
    ],
  });
}

/**
 * Tolerant parse for the editing UI. It accepts the same shape as the table
 * grid so an in-progress edit (empty cell, one row) can still be rendered;
 * the save-time contract is enforced by `chartLineGridIssues`.
 */
export function parseChartLineGrid(value: string): ChartLineGridJson | null {
  if (value.trim().length === 0) {
    return JSON.parse(defaultChartLineGridDataJson()) as ChartLineGridJson;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = { ...(raw as Record<string, unknown>) };
  delete record.emphasis;
  const parsed = tableDataSchema.safeParse(record);
  if (!parsed.success) {
    return null;
  }
  return { columns: parsed.data.columns, rows: parsed.data.rows };
}

export function chartLineSeriesChoices(gridJson: string): ChartLineChoice[] {
  const grid = parseChartLineGrid(gridJson);
  if (grid === null) {
    return [];
  }
  return grid.columns.slice(1).map((column) => ({
    key: column.key,
    label: column.label.trim().length > 0 ? column.label : column.key,
  }));
}

export function chartLineCategoryChoices(gridJson: string): ChartLineChoice[] {
  const grid = parseChartLineGrid(gridJson);
  const categoryColumn = grid?.columns[0];
  if (grid === null || categoryColumn === undefined) {
    return [];
  }
  const seen = new Set<string>();
  const choices: ChartLineChoice[] = [];
  for (const row of grid.rows) {
    const raw = row[categoryColumn.key];
    if (typeof raw !== "string") {
      continue;
    }
    const key = raw.trim();
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    choices.push({ key, label: key });
  }
  return choices;
}

/**
 * Japanese messages for the save-time line chart contract. The schema stays
 * the only validation source; only the array-size messages are prefixed here
 * because zod's defaults are not user facing.
 */
export function chartLineGridIssues(grid: ChartLineGridJson): string[] {
  const issues: string[] = [];
  if (grid.columns.length < 2) {
    issues.push("カテゴリ列と数値系列を1本以上入力してください");
  }
  if (grid.columns.length > CHART_LINE_MAX_COLUMNS) {
    issues.push(`系列は最大${CHART_LINE_MAX_SERIES}本までです`);
  }
  if (grid.rows.length < CHART_LINE_MIN_CATEGORIES) {
    issues.push(`カテゴリは${CHART_LINE_MIN_CATEGORIES}件以上必要です`);
  }
  if (grid.rows.length > CHART_LINE_MAX_CATEGORIES) {
    issues.push(`カテゴリは最大${CHART_LINE_MAX_CATEGORIES}件までです`);
  }
  if (issues.length > 0) {
    return issues;
  }
  const parsed = chartLineDataSchema.safeParse(grid);
  if (parsed.success) {
    return [];
  }
  return [...new Set(parsed.error.issues.map((issue) => issue.message))];
}

function parseEffects(value: string): unknown[] | null {
  if (value.trim().length === 0) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

function effectTarget(entry: unknown): Record<string, unknown> | null {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    return null;
  }
  const target = (entry as { target?: unknown }).target;
  return typeof target === "object" && target !== null && !Array.isArray(target)
    ? (target as Record<string, unknown>)
    : null;
}

function targetString(target: Record<string, unknown> | null, key: string): string | null {
  const value = target?.[key];
  return typeof value === "string" ? value : null;
}

/** Number of effects that point at a series key (series and point targets). */
export function countChartLineSeriesEffects(
  effectsJson: string,
  seriesKey: string,
): number {
  const effects = parseEffects(effectsJson);
  if (effects === null) {
    return 0;
  }
  return effects.filter((entry) => {
    const target = effectTarget(entry);
    const kind = targetString(target, "kind");
    return (
      (kind === "series" || kind === "point") &&
      targetString(target, "seriesKey") === seriesKey
    );
  }).length;
}

/** Number of effects that point at a category value. */
export function countChartLineCategoryEffects(
  effectsJson: string,
  categoryKey: string,
): number {
  const effects = parseEffects(effectsJson);
  if (effects === null) {
    return 0;
  }
  return effects.filter((entry) => {
    const target = effectTarget(entry);
    const kind = targetString(target, "kind");
    return (
      (kind === "category" || kind === "point") &&
      targetString(target, "categoryKey") === categoryKey
    );
  }).length;
}

function updateEffectTargets(
  effectsJson: string,
  update: (target: Record<string, unknown>) => Record<string, unknown> | null,
): string | null {
  const effects = parseEffects(effectsJson);
  if (effects === null) {
    return null;
  }
  const next = effects
    .map((entry) => {
      const target = effectTarget(entry);
      if (target === null) {
        return entry;
      }
      const updated = update(target);
      return updated === null
        ? null
        : { ...(entry as Record<string, unknown>), target: updated };
    })
    .filter((entry) => entry !== null);
  return JSON.stringify(next);
}

/** Rewrites every `seriesKey` reference in one edit. */
export function renameChartLineSeriesEffects(
  effectsJson: string,
  previousKey: string,
  nextKey: string,
): string | null {
  if (previousKey === nextKey) {
    return effectsJson;
  }
  return updateEffectTargets(effectsJson, (target) => {
    const kind = targetString(target, "kind");
    if (
      (kind === "series" || kind === "point") &&
      targetString(target, "seriesKey") === previousKey
    ) {
      return { ...target, seriesKey: nextKey };
    }
    return target;
  });
}

/** Rewrites every `categoryKey` reference in one edit. */
export function renameChartLineCategoryEffects(
  effectsJson: string,
  previousKey: string,
  nextKey: string,
): string | null {
  if (previousKey === nextKey) {
    return effectsJson;
  }
  return updateEffectTargets(effectsJson, (target) => {
    const kind = targetString(target, "kind");
    if (
      (kind === "category" || kind === "point") &&
      targetString(target, "categoryKey") === previousKey
    ) {
      return { ...target, categoryKey: nextKey };
    }
    return target;
  });
}

/** Removes every effect that depends on a deleted series. */
export function removeChartLineSeriesEffects(
  effectsJson: string,
  seriesKey: string,
): string | null {
  return updateEffectTargets(effectsJson, (target) => {
    const kind = targetString(target, "kind");
    return (kind === "series" || kind === "point") &&
      targetString(target, "seriesKey") === seriesKey
      ? null
      : target;
  });
}

/** Removes every effect that depends on a deleted category row. */
export function removeChartLineCategoryEffects(
  effectsJson: string,
  categoryKey: string,
): string | null {
  return updateEffectTargets(effectsJson, (target) => {
    const kind = targetString(target, "kind");
    return (kind === "category" || kind === "point") &&
      targetString(target, "categoryKey") === categoryKey
      ? null
      : target;
  });
}
