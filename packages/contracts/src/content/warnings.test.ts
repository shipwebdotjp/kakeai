import { describe, expect, it } from "vitest";
import type { VisualCue } from "./visual";
import { validContentDocument } from "../testing/fixtures";
import {
  CAPTION_CONSTRAINT,
  CHART_CATEGORY_GUIDELINE,
  CHART_SERIES_GUIDELINE,
  TABLE_CELL_CHAR_GUIDELINE,
  TABLE_COLUMN_GUIDELINE,
  TABLE_ROW_GUIDELINE,
  TEXT_CONSTRAINTS,
  computeContentWarnings,
} from "./warnings";

function tableCue(input: unknown): VisualCue {
  return {
    id: "visual-table-1",
    range: { kind: "scene" },
    layer: "overlay",
    order: 0,
    transition: {
      enter: { preset: "none", durationMs: 0 },
      exit: { preset: "none", durationMs: 0 },
    },
    template: { id: "table.simple", version: 1 },
    input,
  };
}

function chartCue(input: unknown): VisualCue {
  return {
    id: "visual-chart-1",
    range: { kind: "scene" },
    layer: "overlay",
    order: 0,
    transition: {
      enter: { preset: "none", durationMs: 0 },
      exit: { preset: "none", durationMs: 0 },
    },
    template: { id: "chart.bar", version: 1 },
    input,
  };
}

describe("computeContentWarnings", () => {
  it("returns no warnings for a document within the template limits", () => {
    expect(computeContentWarnings(validContentDocument())).toEqual([]);
  });

  it("warns when a point body exceeds the line budget", () => {
    const document = validContentDocument();
    const scene = document.scenes[1]!;
    const bodyCue = scene.visualCues.find(
      (cue) => (cue.input as { role?: string }).role === "body",
    )!;
    (bodyCue.input as { text: string }).text = "あ".repeat(
      TEXT_CONSTRAINTS.body.charsPerLine * TEXT_CONSTRAINTS.body.maxLines + 1,
    );
    const warnings = computeContentWarnings(document);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("text_overflow");
    expect(warnings[0]!.path).toEqual(["scenes", 1, "visualCues", 1, "input", "text"]);
  });

    it("warns when a caption exceeds the line budget", () => {

    const document = validContentDocument();
    const scene = document.scenes[1]!;
    if (scene.kind !== "point") {
      throw new Error("expected a point scene");
    }
    scene.lines[0]!.captionText = "い".repeat(
      CAPTION_CONSTRAINT.charsPerLine * CAPTION_CONSTRAINT.maxLines + 1,
    );
    const warnings = computeContentWarnings(document);
    expect(warnings.map((warning) => warning.path)).toContainEqual([
      "scenes",
      1,
      "lines",
      0,
      "captionText",
    ]);
  });

  it("warns when a table cell exceeds the character guideline", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues.push(
      tableCue({
        data: {
          columns: [{ key: "name", label: "項目", type: "text" }],
          rows: [{ name: "あ".repeat(TABLE_CELL_CHAR_GUIDELINE + 1) }],
        },
      }),
    );
    const warnings = computeContentWarnings(document);
    expect(warnings.map((warning) => warning.code)).toContain("table_cell_overflow");
    expect(warnings.map((warning) => warning.path)).toContainEqual([
      "scenes",
      1,
      "visualCues",
      2,
      "input",
      "data",
      "rows",
      0,
      "name",
    ]);
  });

  it("warns when table rows and columns exceed the guidelines", () => {
    const document = validContentDocument();
    const columns = Array.from({ length: TABLE_COLUMN_GUIDELINE + 1 }, (_, index) => ({
      key: `col${index + 1}`,
      label: `列${index + 1}`,
      type: "text",
    }));
    const rows = Array.from({ length: TABLE_ROW_GUIDELINE + 1 }, () => ({ col1: "a" }));
    document.scenes[1]!.visualCues.push(tableCue({ data: { columns, rows } }));
    const warnings = computeContentWarnings(document);
    expect(warnings.map((warning) => warning.code)).toContain("table_columns_overflow");
    expect(warnings.map((warning) => warning.code)).toContain("table_rows_overflow");
  });

  it("warns when a bar chart has a negative value", () => {
    const document = validContentDocument();
    document.scenes[1]!.visualCues.push(
      chartCue({
        data: {
          columns: [
            { key: "name", label: "項目", type: "text" },
            { key: "value", label: "値", type: "number" },
          ],
          rows: [
            { name: "a", value: 10 },
            { name: "b", value: -5 },
          ],
        },
      }),
    );
    const warnings = computeContentWarnings(document);
    const negative = warnings.find((warning) => warning.code === "chart_negative_value");
    expect(negative?.path).toEqual([
      "scenes",
      1,
      "visualCues",
      2,
      "input",
      "data",
      "rows",
      1,
      "value",
    ]);
  });

  it("warns when bar chart categories or series exceed the guidelines", () => {
    const document = validContentDocument();
    const columns = [
      { key: "name", label: "項目", type: "text" },
      ...Array.from({ length: CHART_SERIES_GUIDELINE + 1 }, (_, index) => ({
        key: `s${index + 1}`,
        label: `系列${index + 1}`,
        type: "number" as const,
      })),
    ];
    const rows = Array.from({ length: CHART_CATEGORY_GUIDELINE + 1 }, (_, rowIndex) => {
      const row: Record<string, string | number> = { name: `c${rowIndex + 1}` };
      columns.slice(1).forEach((column) => {
        row[column.key] = rowIndex + 1;
      });
      return row;
    });
    document.scenes[1]!.visualCues.push(chartCue({ data: { columns, rows } }));
    const codes = computeContentWarnings(document).map((warning) => warning.code);
    expect(codes).toContain("chart_categories_overflow");
    expect(codes).toContain("chart_series_overflow");
  });
});
