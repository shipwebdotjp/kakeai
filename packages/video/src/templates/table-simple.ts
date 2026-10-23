import {
  tableSimpleInputSchema,
  type EmphasizeEffect,
  type OnsetPreset,
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
  ValueAnimation,
} from "../render-context";
import {
  onsetOverlayId,
  planAppearEffect,
  planOnsetEffect,
  planValueAnimation,
  resolveTriggerWindow,
  SPOTLIGHT_DIM_OFF,
  SPOTLIGHT_DIM_ON,
  tableNumberFormatToValueFormat,
  type AppearTarget,
} from "../cue-effects";
import { accentForegroundHex, themeRoleFontStyle } from "../theme";
import { formatNumber } from "./table-format";
import { toneHex } from "./tone";

interface TableOnset {
  preset: OnsetPreset;
  color: string;
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
  const valueAnimations: ValueAnimation[] = [];
  const onsets = new Map<string, TableOnset>();

  const rowIdOf = (rowIndex: number): string => context.scope.id(`row-${rowIndex}`);
  const cellIdOf = (rowIndex: number, columnIndex: number): string =>
    context.scope.id(`cell-${rowIndex}-${columnIndex}`);
  const rowIds = rows.map((_row, rowIndex) => rowIdOf(rowIndex));
  const rowCellIds = rows.map((_row, rowIndex) =>
    columns.map((_column, columnIndex) => cellIdOf(rowIndex, columnIndex)),
  );
  const cellIds = new Map<string, string>();
  columns.forEach((column, columnIndex) => {
    rows.forEach((_row, rowIndex) => {
      cellIds.set(`${rowIndex}:${column.key}`, cellIdOf(rowIndex, columnIndex));
    });
  });

  const spanMs = context.cueTiming?.spanMs ?? 0;
  const lineIntervals = context.lineIntervals ?? [];
  const preset = style?.preset ?? "clean";
  const zebra = style?.zebra ?? preset === "striped";
  applyTableEffects({
    effects: effects ?? [],
    rowIds,
    rowCellIds,
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
    valueAnimations,
    onsets,
  });

  const bodyHtml = rows
    .map((row, rowIndex) => {
      const cellsHtml = columns
        .map((column, columnIndex) => {
          const cellId = cellIdOf(rowIndex, columnIndex);
          const onset = onsets.get(cellId);
          const overlay =
            onset === undefined
              ? ""
              : `<span id="${onsetOverlayId(cellId)}" class="kakeai-onsetoverlay kakeai-onset-${onset.preset}" style="--kakeai-onset-color:${onset.color}"></span>`;
          return `<td id="${cellId}" class="kakeai-tablecell" style="text-align:${columnAlign(column)};"><span id="${cellId}-text">${escapeHtmlText(cellText(row[column.key] ?? "", column))}</span>${overlay}</td>`;
        })
        .join("");
      return `<tr id="${rowIdOf(rowIndex)}" class="kakeai-tablerow">${cellsHtml}</tr>`;
    })
    .join("");

  const captionHtml =
    caption === undefined || caption.trim().length === 0
      ? ""
      : `<figcaption class="kakeai-tablecaption" style="${themeRoleFontStyle(theme, "heading")}">${escapeHtmlText(caption)}</figcaption>`;
  return {
    html: `<figure class="kakeai-tablewrap" style="${themeRoleFontStyle(theme, "body")}"><div class="kakeai-tableframe kakeai-table-${preset}${zebra ? " kakeai-table-zebra" : ""}">${captionHtml}<table class="kakeai-table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div></figure>`,
    assetIds: [],
    animation,
    stateIntervals,
    valueAnimations,
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

function onsetElementIds(
  effect: TableEffect,
  targets: readonly TableEffectTargetRef[],
  rowCellIds: readonly (readonly string[])[],
): string[] {
  switch (effect.target.kind) {
    case "row":
      return [...(rowCellIds[effect.target.index] ?? [])];
    case "rows":
    case "columns":
      return rowCellIds.flatMap((ids) => [...ids]);
    case "cell":
      return targets[0] === undefined ? [] : [targets[0].id];
  }
}

function spotlightSiblingIds(
  effect: TableEffect,
  targets: readonly TableEffectTargetRef[],
  rowCellIds: readonly (readonly string[])[],
): string[] {
  if (effect.effect.kind !== "emphasize" || effect.effect.style !== "spotlight") {
    return [];
  }
  const target = effect.target;
  if (target.kind === "row") {
    return rowCellIds.flatMap((ids, rowIndex) => (rowIndex === target.index ? [] : [...ids]));
  }
  if (target.kind === "cell") {
    const targetId = targets[0]?.id;
    return targets.length === 0 ? [] : rowCellIds.flat().filter((id) => id !== targetId);
  }
  return [];
}

function emphasizeOnVars(
  effect: EmphasizeEffect,
  theme: VisualThemeDefinition,
): Record<string, string | number> {
  const hex = toneHex(effect.tone, theme);
  if (effect.style === "frame") {
    return { boxShadow: `inset 0 0 0 6px ${hex}` };
  }
  if (effect.style === "spotlight") {
    return { boxShadow: `inset 0 0 0 4px ${hex}` };
  }
  return { backgroundColor: hex, color: accentForegroundHex(hex, theme) };
}

function emphasizeOffVars(
  effect: EmphasizeEffect,
  zebraRow: boolean,
): Record<string, string | number> {
  if (effect.style === "frame" || effect.style === "spotlight") {
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
  rowCellIds: readonly (readonly string[])[];
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
  valueAnimations: ValueAnimation[];
  onsets: Map<string, TableOnset>;
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
    if (entry.effect.kind === "value") {
      const target = entry.target;
      if (target.kind !== "cell") {
        return;
      }
      const targetId = options.cellIds.get(`${target.row}:${target.key}`);
      const column = options.columns.find((item) => item.key === target.key);
      if (targetId === undefined || column === undefined || column.type !== "number") {
        return;
      }
      const raw = (options.rows[target.row] as Record<string, unknown> | undefined)?.[column.key];
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return;
      }
      const numeric = raw;
      const valueWindow = resolveTriggerWindow(entry.trigger, lineIntervals, options.spanMs, path);
      if (valueWindow === null) {
        return;
      }
      const plan = planValueAnimation({
        targetId: `${targetId}-text`,
        to: numeric,
        format: tableNumberFormatToValueFormat(column.format),
        effect: entry.effect,
        window: valueWindow,
        spanMs: options.spanMs,
      });
      if (plan !== null) {
        options.valueAnimations.push(plan);
      }
      return;
    }
    const window = resolveTriggerWindow(entry.trigger, lineIntervals, options.spanMs, path);
    if (window === null) {
      return;
    }
    const interval = [{ startMs: window.startMs, endMs: window.endMs }];
    for (const target of targets) {
      options.stateIntervals.push({
        targetId: target.id,
        intervals: interval,
        on: emphasizeOnVars(entry.effect, options.theme),
        off: emphasizeOffVars(entry.effect, options.zebra && target.rowIndex % 2 === 1),
      });
    }
    for (const siblingId of spotlightSiblingIds(entry, targets, options.rowCellIds)) {
      options.stateIntervals.push({
        targetId: siblingId,
        intervals: interval,
        on: SPOTLIGHT_DIM_ON,
        off: SPOTLIGHT_DIM_OFF,
      });
    }
    if (entry.effect.onset !== undefined) {
      const color = toneHex(entry.effect.tone, options.theme);
      for (const elementId of onsetElementIds(entry, targets, options.rowCellIds)) {
        options.onsets.set(elementId, { preset: entry.effect.onset.preset, color });
        const onsetPlan = planOnsetEffect({
          overlayId: onsetOverlayId(elementId),
          effect: entry.effect,
          window,
          spanMs: options.spanMs,
        });
        options.animation.push(...onsetPlan.animation);
        options.stateIntervals.push(...onsetPlan.stateIntervals);
      }
    }
  });
}
