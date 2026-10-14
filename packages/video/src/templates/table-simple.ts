import {
  DEFAULT_ANIMATION_POLICY,
  TABLE_REVEAL_DEFAULT_STAGGER_MS,
  tableSimpleInputSchema,
  type TableColumn,
  type TableNumberFormat,
  type TableTone,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type { AnimationItem, RenderedCue, RenderContext } from "../render-context";
import { accentForegroundHex, mixHex } from "../theme";

function formatNumber(value: number, format: TableNumberFormat | undefined): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return new Intl.NumberFormat("ja-JP", {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(value);
    case "integer":
      return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(value);
    case "decimal":
      return new Intl.NumberFormat("ja-JP", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
      }).format(value);
    default:
      return String(value);
  }
}

function cellText(value: string | number, column: TableColumn): string {
  if (typeof value === "number" && column.type === "number") {
    return formatNumber(value, column.format);
  }
  return String(value);
}

function columnAlign(column: TableColumn): string {
  if (column.align !== undefined) {
    return column.align;
  }
  return column.type === "number" ? "right" : "left";
}

function toneHex(tone: TableTone, theme: VisualThemeDefinition): string {
  switch (tone) {
    case "primary":
      return theme.accents.primary;
    case "secondary":
      return theme.accents.secondary;
    case "tertiary":
      return theme.accents.tertiary;
    case "success":
      return theme.semantic.success;
    case "warning":
      return theme.semantic.warning;
    case "error":
      return theme.semantic.error;
    case "info":
      return theme.semantic.info;
    default: {
      const exhaustive: never = tone;
      throw new CompositionCompileError([
        { path: [], code: "unknown_tone", message: `未対応の表の強調色です: ${String(exhaustive)}` },
      ]);
    }
  }
}

interface RowEmphasis {
  base: string | null;
  cells: Map<string, string>;
}

export function renderTableSimple(input: unknown, context: RenderContext): RenderedCue {
  const parsed = tableSimpleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "table.simple の入力が不正です。" },
    ]);
  }
  const { caption, data, style, reveal } = parsed.data;
  const { columns, rows, emphasis } = data;
  const theme = context.theme;

  const emphasisByRow = new Map<number, RowEmphasis>();
  for (const entry of emphasis ?? []) {
    const background = mixHex(toneHex(entry.tone, theme), theme.surface, 0.78);
    const entryStyle = `background:${background};color:${accentForegroundHex(background, theme)}`;
    const existing = emphasisByRow.get(entry.row);
    if (existing === undefined) {
      emphasisByRow.set(entry.row, {
        base: entry.key === undefined ? entryStyle : null,
        cells: entry.key === undefined ? new Map() : new Map([[entry.key, entryStyle]]),
      });
    } else if (entry.key === undefined) {
      existing.base = entryStyle;
    } else {
      existing.cells.set(entry.key, entryStyle);
    }
  }

  const headerAccent = `var(--kakeai-accent-${style?.headerAccent ?? "primary"})`;
  const headerHtml = columns
    .map(
      (column) =>
        `<th class="kakeai-tablehead" style="text-align:${columnAlign(column)};border-bottom-color:${headerAccent}">${escapeHtmlText(column.label)}</th>`,
    )
    .join("");

  const revealMode = reveal?.mode ?? "rows";
  const revealPreset = reveal?.preset ?? "fade";
  const durationMs = Math.min(
    reveal?.durationMs ?? DEFAULT_ANIMATION_POLICY.defaultDurationMs,
    DEFAULT_ANIMATION_POLICY.maxDurationMs,
  );
  const staggerMs = reveal?.staggerMs ?? TABLE_REVEAL_DEFAULT_STAGGER_MS;
  const animation: AnimationItem[] = [];

  const bodyHtml = rows
    .map((row, rowIndex) => {
      const rowEmphasis = emphasisByRow.get(rowIndex);
      const rowId = context.scope.id(`row-${rowIndex}`);
      const cellsHtml = columns
        .map((column, columnIndex) => {
          const cellId = context.scope.id(`cell-${rowIndex}-${columnIndex}`);
          const cellEmphasis = rowEmphasis?.cells.get(column.key) ?? rowEmphasis?.base ?? null;
          const cellStyle = `text-align:${columnAlign(column)};${cellEmphasis !== null ? `${cellEmphasis};` : ""}`;
          if (revealMode === "columns") {
            animation.push({
              targetId: cellId,
              preset: revealPreset,
              startMs: columnIndex * staggerMs,
              durationMs,
            });
          }
          return `<td id="${cellId}" class="kakeai-tablecell" style="${cellStyle}">${escapeHtmlText(cellText(row[column.key] ?? "", column))}</td>`;
        })
        .join("");
      if (revealMode === "rows") {
        animation.push({
          targetId: rowId,
          preset: revealPreset,
          startMs: rowIndex * staggerMs,
          durationMs,
        });
      }
      const rowStyle = rowEmphasis?.base ?? "";
      return `<tr id="${rowId}" class="kakeai-tablerow"${rowStyle.length > 0 ? ` style="${rowStyle}"` : ""}>${cellsHtml}</tr>`;
    })
    .join("");

  const captionHtml =
    caption === undefined || caption.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-tablecaption">${escapeHtmlText(caption)}</figcaption>`;
  const preset = style?.preset ?? "clean";
  const zebra = style?.zebra ?? preset === "striped";
  return {
    html: `<figure class="kakeai-tablewrap"><div class="kakeai-tableframe kakeai-table-${preset}${zebra ? " kakeai-table-zebra" : ""}">${captionHtml}<table class="kakeai-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div></figure>`,
    assetIds: [],
    animation,
  };
}
