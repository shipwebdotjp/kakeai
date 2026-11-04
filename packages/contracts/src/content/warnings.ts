import type { Warning } from "../error";
import type { ContentDocument } from "./document";
import type { WorkOutputProfile } from "../dto";
import {
  OUTPUT_PROFILE_LAYOUT,
  charsPerLineFor,
  outputProfileLayout,
  type OutputProfileLayout,
} from "../output-profile";
import { UNITS_PER_FULLWIDTH_CHAR, textWidthUnits } from "../text-width";

export { UNITS_PER_FULLWIDTH_CHAR, textWidthUnits } from "../text-width";
import {
  chartBarInputSchema,
  chartBarV1,
  chatThreadInputSchema,
  chatThreadV1,
  flowDiagramInputSchema,
  flowDiagramV1,
  fitFlowNodeLabel,
  flowNodeWidth,
  FLOW_PLOT_MAX_WIDTH_PX,
  tableSimpleInputSchema,
  tableSimpleV1,
  textBlockInputSchema,
  textBlockV1,
  type ChartData,
  type FlowDiagram,
  type FlowOrientation,
  type TableData,
  type TextRole,
} from "../templates";

export interface TextConstraint {
  maxLines: number;
  /** 1行の幅を全角換算の文字数で表す。半角文字は2文字で全角1文字分とする。 */
  charsPerLine: number;
}

export const TEXT_CONSTRAINTS: Record<TextRole, TextConstraint> = {
  title: { maxLines: 2, charsPerLine: 18 },
  subtitle: { maxLines: 2, charsPerLine: 24 },
  heading: { maxLines: 2, charsPerLine: 16 },
  body: { maxLines: 6, charsPerLine: 28 },
  closing: { maxLines: 2, charsPerLine: 20 },
  label: { maxLines: 1, charsPerLine: 24 },
};

function textConstraintsFor(
  layout: OutputProfileLayout,
): Record<TextRole, TextConstraint> {
  if (layout === OUTPUT_PROFILE_LAYOUT.landscape) {
    return TEXT_CONSTRAINTS;
  }
  const entries = (Object.keys(TEXT_CONSTRAINTS) as TextRole[]).map((role) => [
    role,
    {
      ...TEXT_CONSTRAINTS[role],
      charsPerLine: charsPerLineFor(TEXT_CONSTRAINTS[role].charsPerLine, layout),
    },
  ]);
  return Object.fromEntries(entries) as Record<TextRole, TextConstraint>;
}

export const CAPTION_CONSTRAINT: TextConstraint = { maxLines: 2, charsPerLine: 38 };

export const CHAT_MESSAGE_CONSTRAINT: TextConstraint = { maxLines: 4, charsPerLine: 16 };

export const TABLE_CELL_CHAR_GUIDELINE = 14;
export const TABLE_ROW_GUIDELINE = 10;
export const TABLE_COLUMN_GUIDELINE = 6;

export const CHART_CATEGORY_GUIDELINE = 6;
export const CHART_SERIES_GUIDELINE = 3;

function chartWarnings(
  data: ChartData,
  basePath: (string | number)[],
  layout: OutputProfileLayout,
): Warning[] {
  const warnings: Warning[] = [];
  const categories = data.rows.length;
  const series = Math.max(0, data.columns.length - 1);
  if (categories > layout.chartCategoryLimit) {
    warnings.push({
      path: [...basePath, "data", "rows"],
      code: "chart_categories_overflow",
      message: `グラフのカテゴリ数が目安（最大${layout.chartCategoryLimit}件）を超えています。プレビューで確認してください。`,
    });
  }
  if (series > layout.chartSeriesLimit) {
    warnings.push({
      path: [...basePath, "data", "columns"],
      code: "chart_series_overflow",
      message: `グラフの系列数が目安（最大${layout.chartSeriesLimit}本）を超えています。プレビューで確認してください。`,
    });
  }
  data.columns.slice(1).forEach((column) => {
    data.rows.forEach((row, rowIndex) => {
      const value = row[column.key];
      const numeric = typeof value === "number" ? value : Number(value);
      if (Number.isFinite(numeric) && numeric < 0) {
        warnings.push({
          path: [...basePath, "data", "rows", rowIndex, column.key],
          code: "chart_negative_value",
          message: "棒グラフの負の値は0として描画されます。プレビューで確認してください。",
        });
      }
    });
  });
  return warnings;
}

function tableWarnings(
  data: TableData,
  basePath: (string | number)[],
  layout: OutputProfileLayout,
): Warning[] {
  const warnings: Warning[] = [];
  if (data.columns.length > layout.tableColumnLimit) {
    warnings.push({
      path: [...basePath, "data", "columns"],
      code: "table_columns_overflow",
      message: `表の列数が目安（最大${layout.tableColumnLimit}列）を超えています。プレビューで確認してください。`,
    });
  }
  if (data.rows.length > layout.tableRowLimit) {
    warnings.push({
      path: [...basePath, "data", "rows"],
      code: "table_rows_overflow",
      message: `表の行数が目安（最大${layout.tableRowLimit}行）を超えています。プレビューで確認してください。`,
    });
  }
  data.rows.forEach((row, rowIndex) => {
    for (const [key, value] of Object.entries(row)) {
      if (
        textWidthUnits(String(value)) >
        layout.tableCellCharLimit * UNITS_PER_FULLWIDTH_CHAR
      ) {
        warnings.push({
          path: [...basePath, "data", "rows", rowIndex, key],
          code: "table_cell_overflow",
          message: `表のセルが目安（最大${layout.tableCellCharLimit}文字相当）を超えています。プレビューで確認してください。`,
        });
      }
    }
  });
  return warnings;
}

function flowWarnings(
  diagram: FlowDiagram,
  rawOrientation: unknown,
  basePath: (string | number)[],
  layout: OutputProfileLayout,
): Warning[] {
  const orientation: FlowOrientation =
    rawOrientation === "vertical" || rawOrientation === "horizontal"
      ? rawOrientation
      : layout === OUTPUT_PROFILE_LAYOUT.portrait
        ? "vertical"
        : "horizontal";
  const plotWidth = Math.min(FLOW_PLOT_MAX_WIDTH_PX, layout.contentWidth);
  const nodeWidth = flowNodeWidth(diagram.nodes.length, orientation, plotWidth);
  const warnings: Warning[] = [];
  diagram.nodes.forEach((node, index) => {
    const fit = fitFlowNodeLabel(node.label, nodeWidth, layout.typeScale);
    if (!fit.reduced && !fit.overflow) {
      return;
    }
    const path = [...basePath, "diagram", "nodes", index, "label"];
    if (fit.overflow) {
      warnings.push({
        path,
        code: "flow_label_overflow",
        message:
          "ノードラベルが最小サイズでも1行に収まりません。ラベルを短くしてください。",
      });
      return;
    }
    warnings.push({
      path,
      code: "flow_label_reduced",
      message:
        "ノードラベルの文字サイズを縮小しています。プレビューで読みやすさを確認してください。",
    });
  });
  return warnings;
}

const ROLE_LABELS: Record<TextRole, string> = {
  title: "タイトル",
  subtitle: "サブタイトル",
  heading: "見出し",
  body: "本文",
  closing: "結びの文言",
  label: "ラベル",
};

function estimateLineCount(text: string, charsPerLine: number): number {
  if (text.length === 0) {
    return 0;
  }
  const capacity = charsPerLine * UNITS_PER_FULLWIDTH_CHAR;
  return text.split("\n").reduce((total, line) => {
    const width = textWidthUnits(line);
    if (width === 0) {
      return total + 1;
    }
    return total + Math.max(1, Math.ceil(width / capacity));
  }, 0);
}

function overflowWarning(
  path: (string | number)[],
  label: string,
  text: string,
  constraint: TextConstraint,
): Warning | undefined {
  const lines = estimateLineCount(text, constraint.charsPerLine);
  if (lines <= constraint.maxLines) {
    return undefined;
  }
  return {
    path,
    code: "text_overflow",
    message: `${label}がテンプレートの目安（最大${constraint.maxLines}行）を超えています。プレビューで確認してください。`,
  };
}

export function computeContentWarnings(
  document: ContentDocument,
  options: { outputProfile?: WorkOutputProfile } = {},
): Warning[] {
  const layout = outputProfileLayout(options.outputProfile);
  const textConstraints = textConstraintsFor(layout);
  const captionConstraint = {
    maxLines: layout.captionMaxLines,
    charsPerLine: layout.captionCharsPerLine,
  };
  const chatConstraint = {
    ...CHAT_MESSAGE_CONSTRAINT,
    charsPerLine: charsPerLineFor(CHAT_MESSAGE_CONSTRAINT.charsPerLine, layout),
  };
  const warnings: Warning[] = [];
  document.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      if (cue.template.id === flowDiagramV1.id && cue.template.version === flowDiagramV1.version) {
        const parsed = flowDiagramInputSchema.safeParse(cue.input);
        if (parsed.success) {
          const rawOrientation =
            typeof cue.input === "object" && cue.input !== null && "style" in cue.input
              ? (cue.input as { style?: { orientation?: unknown } }).style?.orientation
              : undefined;
          warnings.push(
            ...flowWarnings(
              parsed.data.diagram,
              rawOrientation,
              ["scenes", sceneIndex, "visualCues", cueIndex, "input"],
              layout,
            ),
          );
        }
        return;
      }
      if (cue.template.id === chartBarV1.id && cue.template.version === chartBarV1.version) {
        const parsed = chartBarInputSchema.safeParse(cue.input);
        if (parsed.success) {
          warnings.push(
            ...chartWarnings(
              parsed.data.data,
              ["scenes", sceneIndex, "visualCues", cueIndex, "input"],
              layout,
            ),
          );
        }
        return;
      }
      if (cue.template.id === tableSimpleV1.id && cue.template.version === tableSimpleV1.version) {
        const parsed = tableSimpleInputSchema.safeParse(cue.input);
        if (parsed.success) {
          warnings.push(
            ...tableWarnings(
              parsed.data.data,
              ["scenes", sceneIndex, "visualCues", cueIndex, "input"],
              layout,
            ),
          );
        }
        return;
      }
      if (cue.template.id === chatThreadV1.id && cue.template.version === chatThreadV1.version) {
        const parsed = chatThreadInputSchema.safeParse(cue.input);
        if (parsed.success) {
          parsed.data.messages.forEach((message, messageIndex) => {
            const warning = overflowWarning(
              [
                "scenes",
                sceneIndex,
                "visualCues",
                cueIndex,
                "input",
                "messages",
                messageIndex,
                "body",
              ],
              "チャット本文",
              message.body,
              chatConstraint,
            );
            if (warning) {
              warnings.push(warning);
            }
          });
        }
        return;
      }
      if (cue.template.id !== textBlockV1.id || cue.template.version !== textBlockV1.version) {
        return;
      }
      const parsed = textBlockInputSchema.safeParse(cue.input);
      if (!parsed.success) {
        return;
      }
      const { role, text } = parsed.data;
      const warning = overflowWarning(
        ["scenes", sceneIndex, "visualCues", cueIndex, "input", "text"],
        ROLE_LABELS[role],
        text,
        textConstraints[role],
      );
      if (warning) {
        warnings.push(warning);
      }
    });

    scene.lines.forEach((line, lineIndex) => {
      const caption = overflowWarning(
        ["scenes", sceneIndex, "lines", lineIndex, "captionText"],
        "字幕",
        line.captionText,
        captionConstraint,
      );
      if (caption) {
        warnings.push(caption);
      }
    });
  });
  return warnings;
}
