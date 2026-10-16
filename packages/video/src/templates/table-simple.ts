import {
  tableSimpleInputSchema,
  type EmphasizeEffect,
  type TableColumn,
  type TableEffect,
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
import { accentForegroundHex } from "../theme";
import { formatNumber } from "./table-format";
import { toneHex } from "./tone";

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

export function renderTableSimple(input: unknown, context: RenderContext): RenderedCue {
  const parsed = tableSimpleInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompositionCompileError([
      { path: context.path, code: "invalid_input", message: "table.simple の入力が不正です。" },
    ]);
  }
  const { caption, data, style, effects } = parsed.data;
  const { columns, rows } = data;
  const theme = context.theme;

  const headerAccent = `var(--kakeai-accent-${style?.headerAccent ?? "primary"})`;
  const headerHtml = columns
    .map(
      (column) =>
        `<th class="kakeai-tablehead" style="text-align:${columnAlign(column)};border-bottom-color:${headerAccent}">${escapeHtmlText(column.label)}</th>`,
    )
    .join("");

  const animation: AnimationItem[] = [];
  const stateIntervals: StateInterval[] = [];
  const rowIds: string[] = [];
  const cellIds = new Map<string, string>();

  const bodyHtml = rows
    .map((row, rowIndex) => {
      const rowId = context.scope.id(`row-${rowIndex}`);
      rowIds.push(rowId);
      const cellsHtml = columns
        .map((column, columnIndex) => {
          const cellId = context.scope.id(`cell-${rowIndex}-${columnIndex}`);
          cellIds.set(`${rowIndex}:${column.key}`, cellId);
          return `<td id="${cellId}" class="kakeai-tablecell" style="text-align:${columnAlign(column)};">${escapeHtmlText(cellText(row[column.key] ?? "", column))}</td>`;
        })
        .join("");
      return `<tr id="${rowId}" class="kakeai-tablerow">${cellsHtml}</tr>`;
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
