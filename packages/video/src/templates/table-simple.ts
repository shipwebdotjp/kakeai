import {
  DEFAULT_ANIMATION_POLICY,
  TABLE_REVEAL_DEFAULT_STAGGER_MS,
  tableSimpleInputSchema,
  type EmphasizeEffect,
  type TableColumn,
  type TableEffect,
  type TableTone,
  type VisualThemeDefinition,
} from "@kakeai/contracts";
import { CompositionCompileError } from "../compile-error";
import { escapeHtmlText } from "../escape";
import type {
  AnimationItem,
  RenderedCue,
  RenderContext,
  StateInterval,
} from "../render-context";
import { planAppearEffect, resolveTriggerWindow, type AppearTarget } from "../cue-effects";
import { accentForegroundHex, mixHex } from "../theme";
import { formatNumber } from "./table-format";

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
  const { caption, data, style, reveal, effects } = parsed.data;
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
  const stateIntervals: StateInterval[] = [];
  const rowIds: string[] = [];
  const cellIds = new Map<string, string>();

  const bodyHtml = rows
    .map((row, rowIndex) => {
      const rowEmphasis = emphasisByRow.get(rowIndex);
      const rowId = context.scope.id(`row-${rowIndex}`);
      rowIds.push(rowId);
      const cellsHtml = columns
        .map((column, columnIndex) => {
          const cellId = context.scope.id(`cell-${rowIndex}-${columnIndex}`);
          cellIds.set(`${rowIndex}:${column.key}`, cellId);
          const cellEmphasis = rowEmphasis?.cells.get(column.key) ?? rowEmphasis?.base ?? null;
          const cellStyle = `text-align:${columnAlign(column)};${cellEmphasis !== null ? `${cellEmphasis};` : ""}`;
          if (revealMode === "columns") {
            animation.push({
              targetId: cellId,
              action: revealPreset,
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
          action: revealPreset,
          startMs: rowIndex * staggerMs,
          durationMs,
        });
      }
      const rowStyle = rowEmphasis?.base ?? "";
      return `<tr id="${rowId}" class="kakeai-tablerow"${rowStyle.length > 0 ? ` style="${rowStyle}"` : ""}>${cellsHtml}</tr>`;
    })
    .join("");

  const spanMs = context.cueTiming?.spanMs ?? 0;
  const lineIntervals = context.lineIntervals ?? [];
  const preset = style?.preset ?? "clean";
  const zebra = style?.zebra ?? preset === "striped";
  applyTableEffects({
    effects: effects ?? [],
    rowIds,
    cellIds,
    columns,
    rows,
    zebra,
    theme,
    lineIntervals,
    spanMs,
    path: context.path,
    animation,
    stateIntervals,
  });

  const captionHtml =
    caption === undefined || caption.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-tablecaption">${escapeHtmlText(caption)}</figcaption>`;
  return {
    html: `<figure class="kakeai-tablewrap"><div class="kakeai-tableframe kakeai-table-${preset}${zebra ? " kakeai-table-zebra" : ""}">${captionHtml}<table class="kakeai-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
  };
}

interface TableEffectTargetRef {
  id: string;
  step: number;
  rowIndex: number;
}

function resolveTableEffectTargets(
  effect: TableEffect,
  rowIds: readonly string[],
  cellIds: ReadonlyMap<string, string>,
  columns: readonly TableColumn[],
  rows: readonly unknown[],
): TableEffectTargetRef[] {
  const target = effect.target;
  switch (target.kind) {
    case "row": {
      const id = rowIds[target.index];
      return id === undefined ? [] : [{ id, step: 0, rowIndex: target.index }];
    }
    case "cell": {
      const id = cellIds.get(`${target.row}:${target.key}`);
      return id === undefined ? [] : [{ id, step: 0, rowIndex: target.row }];
    }
    case "rows":
      return rowIds.map((id, index) => ({ id, step: index, rowIndex: index }));
    case "columns": {
      const refs: TableEffectTargetRef[] = [];
      columns.forEach((column, columnIndex) => {
        rows.forEach((_row, rowIndex) => {
          const id = cellIds.get(`${rowIndex}:${column.key}`);
          if (id !== undefined) {
            refs.push({ id, step: columnIndex, rowIndex });
          }
        });
      });
      return refs;
    }
  }
}

function emphasizeOnVars(
  effect: EmphasizeEffect,
  theme: VisualThemeDefinition,
): Record<string, string | number> {
  const hex = toneHex(effect.tone, theme);
  if (effect.style === "frame") {
    return { boxShadow: `inset 0 0 0 6px ${hex}` };
  }
  return { backgroundColor: hex, color: accentForegroundHex(hex, theme) };
}

function emphasizeOffVars(
  effect: EmphasizeEffect,
  zebraRow: boolean,
): Record<string, string | number> {
  if (effect.style === "frame") {
    return { boxShadow: "none" };
  }
  return {
    backgroundColor: zebraRow ? "var(--kakeai-surface-muted)" : "transparent",
    color: "inherit",
  };
}

function applyTableEffects(options: {
  effects: readonly TableEffect[];
  rowIds: readonly string[];
  cellIds: ReadonlyMap<string, string>;
  columns: readonly TableColumn[];
  rows: readonly unknown[];
  zebra: boolean;
  theme: VisualThemeDefinition;
  lineIntervals: RenderContext["lineIntervals"];
  spanMs: number;
  path: (string | number)[];
  animation: AnimationItem[];
  stateIntervals: StateInterval[];
}): void {
  const lineIntervals = options.lineIntervals ?? [];
  options.effects.forEach((entry, effectIndex) => {
    const path = [...options.path, "effects", effectIndex];
    const targets = resolveTableEffectTargets(
      entry,
      options.rowIds,
      options.cellIds,
      options.columns,
      options.rows,
    );
    if (targets.length === 0) {
      return;
    }
    if (entry.effect.kind === "appear") {
      const appearTargets: AppearTarget[] = targets.map(({ id, step }) => ({ id, step }));
      const plan = planAppearEffect({
        targets: appearTargets,
        trigger: entry.trigger,
        effect: entry.effect,
        lineIntervals,
        spanMs: options.spanMs,
        path,
      });
      options.animation.push(...plan.animation);
      options.stateIntervals.push(...plan.stateIntervals);
      return;
    }
    const window = resolveTriggerWindow(entry.trigger, lineIntervals, options.spanMs, path);
    if (window === null) {
      return;
    }
    for (const target of targets) {
      options.stateIntervals.push({
        targetId: target.id,
        intervals: [{ startMs: window.startMs, endMs: window.endMs }],
        on: emphasizeOnVars(entry.effect, options.theme),
        off: emphasizeOffVars(entry.effect, options.zebra && target.rowIndex % 2 === 1),
      });
    }
  });
}
