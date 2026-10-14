import type { Warning } from "../error";
import type { ContentDocument } from "./document";
import {
  tableSimpleInputSchema,
  tableSimpleV1,
  textBlockInputSchema,
  textBlockV1,
  type TableData,
  type TableReveal,
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
};

export const CAPTION_CONSTRAINT: TextConstraint = { maxLines: 2, charsPerLine: 20 };

export const TABLE_CELL_CHAR_GUIDELINE = 14;
export const TABLE_ROW_GUIDELINE = 10;
export const TABLE_COLUMN_GUIDELINE = 6;
export const TABLE_REVEAL_TOTAL_GUIDELINE_MS = 4000;

function tableWarnings(
  data: TableData,
  reveal: TableReveal | undefined,
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
  if (reveal !== undefined && reveal.mode !== "none") {
    const count = reveal.mode === "rows" ? data.rows.length : data.columns.length;
    const totalMs = Math.max(0, count - 1) * reveal.staggerMs + reveal.durationMs;
    if (totalMs > TABLE_REVEAL_TOTAL_GUIDELINE_MS) {
      warnings.push({
        path: [...basePath, "reveal"],
        code: "table_reveal_overflow",
        message: `表の登場演出が目安（${TABLE_REVEAL_TOTAL_GUIDELINE_MS / 1000}秒）を超えています。ずれ・尺を見直してください。`,
      });
    }
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
      if (cue.template.id === tableSimpleV1.id && cue.template.version === tableSimpleV1.version) {
        const parsed = tableSimpleInputSchema.safeParse(cue.input);
        if (parsed.success) {
          warnings.push(
            ...tableWarnings(
              parsed.data.data,
              parsed.data.reveal,
              ["scenes", sceneIndex, "visualCues", cueIndex, "input"],
            ),
          );
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
