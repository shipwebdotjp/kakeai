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
  /** 1行の幅を全角換算の文字数で表す。半角文字は2文字で全角1文字分とする。 */
  charsPerLine: number;
}

/** 半角換算の幅における全角1文字分の単位。 */
export const UNITS_PER_FULLWIDTH_CHAR = 2;

/**
 * テキストの幅を半角換算の単位で数える。全角（CJK・全角形・絵文字・主な記号）は
 * UNITS_PER_FULLWIDTH_CHAR、ASCII・半角カナなどは1、結合文字・制御文字など
 * 幅を持たない主な文字は0とする。英語は1文字あたり約0.47emのため、
 * 半角1単位=0.5emとして約7%保守的に見積もられる。表にない全角文字は
 * 半角として数えるため、失敗方向は警告の出し忘れ（過小評価）側である。
 */
export function textWidthUnits(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) {
      continue;
    }
    if (isZeroWidthCodePoint(code)) {
      continue;
    }
    width += isFullwidthCodePoint(code) ? UNITS_PER_FULLWIDTH_CHAR : 1;
  }
  return width;
}

function isZeroWidthCodePoint(code: number): boolean {
  if (code <= 0x001f || (code >= 0x007f && code <= 0x009f)) {
    return true;
  }
  if (code === 0x00ad || code === 0xfeff) {
    return true;
  }
  if (code >= 0x200b && code <= 0x200f) {
    return true;
  }
  if (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe00 && code <= 0xfe0f) ||
    (code >= 0xe0100 && code <= 0xe01ef)
  ) {
    return true;
  }
  return false;
}

function isFullwidthCodePoint(code: number): boolean {
  if (code === 0x231a || code === 0x231b) {
    return true;
  }
  if (code >= 0x23e9 && code <= 0x23f3) {
    return true;
  }
  if (code >= 0x2600 && code <= 0x27bf) {
    return true;
  }
  if (code >= 0x2b00 && code <= 0x2bff) {
    return true;
  }
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3041 && code <= 0x33ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0xa4cf) ||
      (code >= 0xa960 && code <= 0xa97c) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xd7b0 && code <= 0xd7c6) ||
      (code >= 0xd7cb && code <= 0xd7fb) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1b000 && code <= 0x1b001) ||
      (code >= 0x1f000 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
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
      if (
        textWidthUnits(String(value)) >
        TABLE_CELL_CHAR_GUIDELINE * UNITS_PER_FULLWIDTH_CHAR
      ) {
        warnings.push({
          path: [...basePath, "data", "rows", rowIndex, key],
          code: "table_cell_overflow",
          message: `表のセルが目安（最大${TABLE_CELL_CHAR_GUIDELINE}文字相当）を超えています。プレビューで確認してください。`,
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
