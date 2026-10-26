import type { z } from "zod";

interface FigureColumnLike {
  key: string;
  type: "text" | "number";
  format?: unknown;
}

interface FigureData {
  columns: readonly FigureColumnLike[];
  rows: readonly Readonly<Record<string, string | number>>[];
}

export function refineFigureData(data: FigureData, ctx: z.RefinementCtx): void {
  const keys = data.columns.map((column) => column.key);
  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: "custom", message: "列キーは一意にしてください", path: ["columns"] });
  }
  const known = new Set(keys);
  data.rows.forEach((row, rowIndex) => {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `未定義の列キーです: ${key}`,
          path: ["rows", rowIndex, key],
        });
      }
    }
  });
  for (const [columnIndex, column] of data.columns.entries()) {
    if (column.type === "text" && column.format !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: `format は number 列だけが持てます: ${column.key}`,
        path: ["columns", columnIndex, "format"],
      });
    }
  }
}
