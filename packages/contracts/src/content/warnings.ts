import type { Warning } from "../error";
import type { ContentDocument } from "./document";
import {
  chartBarInputSchema,
  chartBarV1,
  chatThreadInputSchema,
  chatThreadV1,
  tableSimpleInputSchema,
  tableSimpleV1,
  textBlockInputSchema,
  textBlockV1,
  type ChartData,
  type TableData,
  type TextRole,
} from "../templates";

export interface TextConstraint {
  maxLines: number;
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
): Warning[] {
  const warnings: Warning[] = [];
  const categories = data.rows.length;
  const series = Math.max(0, data.columns.length - 1);
  if (categories > CHART_CATEGORY_GUIDELINE) {
    warnings.push({
      path: [...basePath, "data", "rows"],
      code: "chart_categories_overflow",
      message: `グラフのカテゴリ数が目安（最大${CHART_CATEGORY_GUIDELINE}件）を超えています。プレビューで確認してください。`,
    });
  }
  if (series > CHART_SERIES_GUIDELINE) {
    warnings.push({
      path: [...basePath, "data", "columns"],
      code: "chart_series_overflow",
      message: `グラフの系列数が目安（最大${CHART_SERIES_GUIDELINE}本）を超えています。プレビューで確認してください。`,
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
): Warning[] {
  const warnings: Warning[] = [];
  if (data.columns.length > TABLE_COLUMN_GUIDELINE) {
    warnings.push({
      path: [...basePath, "data", "columns"],
      code: "table_columns_overflow",
      message: `表の列数が目安（最大${TABLE_COLUMN_GUIDELINE}列）を超えています。プレビューで確認してください。`,
    });
  }
  if (data.rows.length > TABLE_ROW_GUIDELINE) {
    warnings.push({
      path: [...basePath, "data", "rows"],
      code: "table_rows_overflow",
      message: `表の行数が目安（最大${TABLE_ROW_GUIDELINE}行）を超えています。プレビューで確認してください。`,
    });
  }
  data.rows.forEach((row, rowIndex) => {
    for (const [key, value] of Object.entries(row)) {
      if ([...String(value)].length > TABLE_CELL_CHAR_GUIDELINE) {
        warnings.push({
          path: [...basePath, "data", "rows", rowIndex, key],
          code: "table_cell_overflow",
          message: `表のセルが目安（最大${TABLE_CELL_CHAR_GUIDELINE}文字）を超えています。プレビューで確認してください。`,
        });
      }
    }
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
  return text.split("\n").reduce((total, line) => {
    const characters = [...line].length;
    return total + Math.max(1, Math.ceil(characters / charsPerLine));
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

export function computeContentWarnings(document: ContentDocument): Warning[] {
  const warnings: Warning[] = [];
  document.scenes.forEach((scene, sceneIndex) => {
    scene.visualCues.forEach((cue, cueIndex) => {
      if (cue.template.id === chartBarV1.id && cue.template.version === chartBarV1.version) {
        const parsed = chartBarInputSchema.safeParse(cue.input);
        if (parsed.success) {
          warnings.push(
            ...chartWarnings(
              parsed.data.data,
              ["scenes", sceneIndex, "visualCues", cueIndex, "input"],
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
              CHAT_MESSAGE_CONSTRAINT,
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
        TEXT_CONSTRAINTS[role],
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
        CAPTION_CONSTRAINT,
      );
      if (caption) {
        warnings.push(caption);
      }
    });
  });
  return warnings;
}
