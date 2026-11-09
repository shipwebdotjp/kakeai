import {
  liveChartStateSchema,
  liveHeadlineStateSchema,
  liveImageStateSchema,
  liveListStateSchema,
  liveQuoteStateSchema,
  TABLE_TONES,
  type LiveCard,
  type LiveChartCategory,
  type LiveChartSeries,
  type LiveChartState,
  type LiveHeadlineState,
  type LiveImageState,
  type LiveListState,
  type LiveListStateItem,
  type LiveQuoteState,
  type TableTone,
} from "@kakeai/contracts";
import type { ZodType } from "zod";

export type CardStateDraft =
  | { cardType: "headline"; state: LiveHeadlineState; issues: string[] }
  | { cardType: "image"; state: LiveImageState; issues: string[] }
  | { cardType: "list"; state: LiveListState; issues: string[] }
  | { cardType: "chart"; state: LiveChartState; issues: string[] }
  | { cardType: "quote"; state: LiveQuoteState; issues: string[] };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function toneOr(value: unknown, fallback: TableTone): TableTone {
  return typeof value === "string" && (TABLE_TONES as readonly string[]).includes(value)
    ? (value as TableTone)
    : fallback;
}

function schemaIssues(schema: ZodType, raw: unknown): string[] {
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => {
    const path = issue.path
      .filter(
        (part): part is string | number =>
          typeof part === "string" || typeof part === "number",
      )
      .join(".");
    return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
  });
}

function listItems(raw: unknown): LiveListStateItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const items: LiveListStateItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id.length === 0) {
      continue;
    }
    // A duplicate id cannot be targeted by the editor and would collide as a
    // React key; keep the first occurrence and let the schema warning explain.
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    const note = optionalText(entry.note);
    items.push({
      id: entry.id,
      text: requiredText(entry.text),
      ...(note === undefined ? {} : { note }),
    });
  }
  return items;
}

function chartCategories(raw: unknown): LiveChartCategory[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const categories: LiveChartCategory[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.key !== "string" || entry.key.length === 0) {
      continue;
    }
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    categories.push({ key: entry.key, label: requiredText(entry.label) });
  }
  return categories;
}

function chartSeries(
  raw: unknown,
  categories: readonly LiveChartCategory[],
): LiveChartSeries[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const categoryKeys = new Set(categories.map((category) => category.key));
  const seriesList: LiveChartSeries[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.key !== "string" || entry.key.length === 0) {
      continue;
    }
    if (seen.has(entry.key)) {
      continue;
    }
    seen.add(entry.key);
    const rawValues = isRecord(entry.values) ? entry.values : {};
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(rawValues)) {
      if (
        categoryKeys.has(key) &&
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        values[key] = value;
      }
    }
    // The editor shows a missing value as 0, so persist that same value on the
    // next edit instead of keeping the state permanently invalid.
    for (const category of categories) {
      if (values[category.key] === undefined) {
        values[category.key] = 0;
      }
    }
    const tone = optionalText(entry.tone);
    seriesList.push({
      key: entry.key,
      label: requiredText(entry.label),
      values,
      ...(tone === undefined || !(TABLE_TONES as readonly string[]).includes(tone)
        ? {}
        : { tone: tone as TableTone }),
    });
  }
  return seriesList;
}

function chartHighlight(
  raw: unknown,
  categories: readonly LiveChartCategory[],
  seriesList: readonly LiveChartSeries[],
): LiveChartState["highlight"] {
  if (!isRecord(raw)) {
    return undefined;
  }
  const categoryKeys = new Set(categories.map((category) => category.key));
  const seriesKeys = new Set(seriesList.map((series) => series.key));
  return {
    seriesKeys: Array.isArray(raw.seriesKeys)
      ? [...new Set(raw.seriesKeys.filter((key): key is string => typeof key === "string" && seriesKeys.has(key)))]
      : [],
    categoryKeys: Array.isArray(raw.categoryKeys)
      ? [...new Set(raw.categoryKeys.filter((key): key is string => typeof key === "string" && categoryKeys.has(key)))]
      : [],
  };
}

/**
 * Builds an editable draft from a possibly malformed state. The contract keeps
 * structural ids, but empty required text is represented as an empty string so
 * the field editor still renders and the user can repair it. Returns `null`
 * only when the state has no usable id, because no editor action could target
 * it through `updateCardState`.
 */
export function buildCardStateDraft(
  cardType: LiveCard["type"],
  raw: unknown,
): CardStateDraft | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) {
    return null;
  }
  const id = raw.id;
  switch (cardType) {
    case "headline": {
      const subtitle = optionalText(raw.subtitle);
      const kicker = optionalText(raw.kicker);
      return {
        cardType,
        state: {
          id,
          title: requiredText(raw.title),
          ...(subtitle === undefined ? {} : { subtitle }),
          ...(kicker === undefined ? {} : { kicker }),
          tone: toneOr(raw.tone, "primary"),
          align: raw.align === "left" ? "left" : "center",
        },
        issues: schemaIssues(liveHeadlineStateSchema, raw),
      };
    }
    case "image": {
      const alt = optionalText(raw.alt);
      const caption = optionalText(raw.caption);
      const credit = optionalText(raw.credit);
      return {
        cardType,
        state: {
          id,
          assetId: requiredText(raw.assetId),
          ...(alt === undefined ? {} : { alt }),
          ...(caption === undefined ? {} : { caption }),
          ...(credit === undefined ? {} : { credit }),
          fit: raw.fit === "contain" ? "contain" : "cover",
        },
        issues: schemaIssues(liveImageStateSchema, raw),
      };
    }
    case "list": {
      const items = listItems(raw.items);
      const itemIds = new Set(items.map((item) => item.id));
      const title = optionalText(raw.title);
      return {
        cardType,
        state: {
          id,
          ...(title === undefined ? {} : { title }),
          items,
          ...(typeof raw.activeItemId === "string" && itemIds.has(raw.activeItemId)
            ? { activeItemId: raw.activeItemId }
            : {}),
          ordered: raw.ordered === true,
        },
        issues: schemaIssues(liveListStateSchema, raw),
      };
    }
    case "chart": {
      const categories = chartCategories(raw.categories);
      const series = chartSeries(raw.series, categories);
      const title = optionalText(raw.title);
      const unit = optionalText(raw.unit);
      const highlight = chartHighlight(raw.highlight, categories, series);
      return {
        cardType,
        state: {
          id,
          ...(title === undefined ? {} : { title }),
          categories,
          series,
          ...(unit === undefined ? {} : { unit }),
          ...(highlight === undefined ? {} : { highlight }),
        },
        issues: schemaIssues(liveChartStateSchema, raw),
      };
    }
    case "quote": {
      const author = optionalText(raw.author);
      const source = optionalText(raw.source);
      return {
        cardType,
        state: {
          id,
          quote: requiredText(raw.quote),
          ...(author === undefined ? {} : { author }),
          ...(source === undefined ? {} : { source }),
          tone: toneOr(raw.tone, "primary"),
          align: raw.align === "center" ? "center" : "left",
        },
        issues: schemaIssues(liveQuoteStateSchema, raw),
      };
    }
    default:
      return null;
  }
}
