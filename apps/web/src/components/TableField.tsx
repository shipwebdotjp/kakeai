import { useState } from "react";
import {
  tableDataSchema,
  type TableColumn,
  type TableData,
  type TableTone,
} from "@kakeai/contracts";
import { defaultTableDataJson } from "../content/form";
import { buttonNeutralClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";

const TONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "なし" },
  { value: "primary", label: "プライマリ" },
  { value: "secondary", label: "セカンダリ" },
  { value: "tertiary", label: "ターシャリ" },
  { value: "success", label: "成功" },
  { value: "warning", label: "警告" },
  { value: "error", label: "エラー" },
  { value: "info", label: "情報" },
];

const COLUMN_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "text", label: "文字列" },
  { value: "number", label: "数値" },
];

const ALIGN_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "自動" },
  { value: "left", label: "左" },
  { value: "center", label: "中央" },
  { value: "right", label: "右" },
];

const FORMAT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "", label: "そのまま" },
  { value: "integer", label: "整数" },
  { value: "decimal", label: "小数" },
  { value: "percent", label: "百分率" },
  { value: "currency", label: "通貨" },
];

interface TableFieldProps {
  label: string;
  fieldKey: string;
  value: string;
  setField: (key: string, value: string) => void;
  maxColumns: number;
  maxRows: number;
}

function parseTableData(value: string): TableData | null {
  if (value.trim().length === 0) {
    return null;
  }
  try {
    const parsed = tableDataSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let cell = "";
  let quoted = false;
  let index = 0;
  const pushCell = () => {
    current.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(current);
    current = [];
  };
  while (index < text.length) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
        } else {
          quoted = false;
          index += 1;
        }
      } else {
        cell += char;
        index += 1;
      }
    } else if (char === '"') {
      quoted = true;
      index += 1;
    } else if (char === ",") {
      pushCell();
      index += 1;
    } else if (char === "\n") {
      pushRow();
      index += 1;
    } else if (char === "\r") {
      index += 1;
    } else {
      cell += char;
      index += 1;
    }
  }
  pushRow();
  return rows.filter((row) => row.some((entry) => entry.trim().length > 0));
}

function inferColumnType(cells: string[]): "text" | "number" {
  const filled = cells.filter((entry) => entry.trim().length !== 0);
  if (filled.length === 0) {
    return "text";
  }
  return filled.every((entry) => Number.isFinite(Number(entry))) ? "number" : "text";
}

function coerceCellValue(raw: string, type: "text" | "number"): string | number {
  const trimmed = raw.trim();
  if (type === "number" && trimmed.length > 0) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return raw;
}

function nextColumnKey(columns: readonly TableColumn[]): string {
  let index = columns.length + 1;
  const taken = new Set(columns.map((column) => column.key));
  while (taken.has(`col${index}`)) {
    index += 1;
  }
  return `col${index}`;
}

function CellInput({
  value,
  columnType,
  onCommit,
}: {
  value: string | number | undefined;
  columnType: "text" | "number";
  onCommit: (raw: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={textFieldClass}
      inputMode={columnType === "number" ? "decimal" : "text"}
      value={draft ?? String(value ?? "")}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => {
        setDraft(null);
        onCommit(event.target.value);
      }}
    />
  );
}

function ColumnKeyInput({ columnKey, onCommit }: { columnKey: string; onCommit: (key: string) => void }) {
  return (
    <input
      className={`w-20 ${textFieldClass}`}
      defaultValue={columnKey}
      onBlur={(event) => {
        if (event.target.value !== columnKey) {
          onCommit(event.target.value);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function TableField({ label, fieldKey, value, setField, maxColumns, maxRows }: TableFieldProps) {
  const [csvText, setCsvText] = useState("");
  const [notice, setNotice] = useState("");
  const data = parseTableData(value);

  const commit = (next: TableData) => {
    setNotice("");
    setField(fieldKey, JSON.stringify(next));
  };

  if (data === null) {
    return (
      <div className="my-2">
        <span>{label}</span>
        <p className={errorTextClass}>表データを読み取れませんでした。初期化してください。</p>
        <button
          type="button"
          className={buttonNeutralClass}
          onClick={() => commit(JSON.parse(defaultTableDataJson()) as TableData)}
        >
          初期化
        </button>
      </div>
    );
  }

  const updateColumn = (index: number, patch: Partial<TableColumn>) => {
    const columns = data.columns.map((column, columnIndex) =>
      columnIndex === index ? { ...column, ...patch } : column,
    );
    commit({ ...data, columns });
  };

  const renameColumnKey = (index: number, nextKey: string) => {
    const key = nextKey.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) {
      setNotice("列キーは半角英数・_-の1〜64文字にしてください");
      return;
    }
    if (data.columns.some((column, columnIndex) => columnIndex !== index && column.key === key)) {
      setNotice("列キーは一意にしてください");
      return;
    }
    const previous = data.columns[index]!.key;
    const columns = data.columns.map((column, columnIndex) =>
      columnIndex === index ? { ...column, key } : column,
    );
    const rows = data.rows.map((row) => {
      if (!(previous in row)) {
        return row;
      }
      const { [previous]: moved, ...rest } = row;
      return { ...rest, [key]: moved as string | number };
    });
    const emphasis = (data.emphasis ?? []).map((entry) =>
      entry.key === previous ? { ...entry, key } : entry,
    );
    commit({ ...data, columns, rows, emphasis });
  };

  const changeColumnType = (index: number, type: "text" | "number") => {
    const key = data.columns[index]!.key;
    const columns = data.columns.map((column, columnIndex) =>
      columnIndex === index ? { ...column, type, format: undefined } : column,
    );
    const rows = data.rows.map((row) => {
      const current = row[key];
      if (current === undefined) {
        return row;
      }
      if (type === "number" && typeof current === "string") {
        return { ...row, [key]: coerceCellValue(current, "number") };
      }
      if (type === "text" && typeof current === "number") {
        return { ...row, [key]: String(current) };
      }
      return row;
    });
    commit({ ...data, columns, rows });
  };

  const addColumn = () => {
    if (data.columns.length >= maxColumns) {
      setNotice(`列は最大${maxColumns}列までです`);
      return;
    }
    const key = nextColumnKey(data.columns);
    commit({
      ...data,
      columns: [...data.columns, { key, label: `列${data.columns.length + 1}`, type: "text" as const }],
    });
  };

  const removeColumn = (index: number) => {
    const key = data.columns[index]!.key;
    commit({
      ...data,
      columns: data.columns.filter((_, columnIndex) => columnIndex !== index),
      rows: data.rows.map((row) => {
        const { [key]: _removed, ...rest } = row;
        return rest;
      }),
      emphasis: (data.emphasis ?? []).filter((entry) => entry.key !== key),
    });
  };

  const updateCell = (rowIndex: number, key: string, raw: string, type: "text" | "number") => {
    const rows = data.rows.map((row, index) =>
      index === rowIndex ? { ...row, [key]: coerceCellValue(raw, type) } : row,
    );
    commit({ ...data, rows });
  };

  const addRow = () => {
    if (data.rows.length >= maxRows) {
      setNotice(`行は最大${maxRows}行までです`);
      return;
    }
    const row: Record<string, string | number> = {};
    for (const column of data.columns) {
      row[column.key] = "";
    }
    commit({ ...data, rows: [...data.rows, row] });
  };

  const removeRow = (rowIndex: number) => {
    const rows = data.rows.filter((_, index) => index !== rowIndex);
    const emphasis = (data.emphasis ?? [])
      .filter((entry) => entry.row !== rowIndex)
      .map((entry) => (entry.row > rowIndex ? { ...entry, row: entry.row - 1 } : entry));
    commit({ ...data, rows, emphasis });
  };

  const cellTone = (rowIndex: number, key: string): string => {
    const entry = (data.emphasis ?? []).find(
      (candidate) => candidate.row === rowIndex && candidate.key === key,
    );
    return entry?.tone ?? "";
  };

  const setCellTone = (rowIndex: number, key: string, tone: string) => {
    const rest = (data.emphasis ?? []).filter(
      (entry) => !(entry.row === rowIndex && entry.key === key),
    );
    const emphasis =
      tone.length === 0 ? rest : [...rest, { row: rowIndex, key, tone: tone as TableTone }];
    commit({ ...data, emphasis });
  };

  const rowTone = (rowIndex: number): string => {
    const entry = (data.emphasis ?? []).find(
      (candidate) => candidate.row === rowIndex && candidate.key === undefined,
    );
    return entry?.tone ?? "";
  };

  const setRowTone = (rowIndex: number, tone: string) => {
    const rest = (data.emphasis ?? []).filter(
      (entry) => !(entry.row === rowIndex && entry.key === undefined),
    );
    const emphasis =
      tone.length === 0 ? rest : [...rest, { row: rowIndex, tone: tone as TableTone }];
    commit({ ...data, emphasis });
  };

  const importCsv = () => {
    const parsed = parseCsv(csvText);
    if (parsed.length === 0) {
      setNotice("取り込むCSVが空です");
      return;
    }
    const rawHeader = parsed[0]!;
    const bodyWidth = Math.max(0, ...parsed.slice(1).map((row) => row.length));
    const width = Math.min(Math.max(rawHeader.length, bodyWidth), maxColumns);
    const truncatedColumns = Math.max(0, Math.max(rawHeader.length, bodyWidth) - maxColumns);
    const body = parsed.slice(1, maxRows + 1);
    const truncatedRows = Math.max(0, parsed.length - 1 - body.length);
    const columns = Array.from({ length: width }, (_, index) => {
      const label = rawHeader[index] ?? "";
      const cells = body.map((row) => row[index] ?? "");
      return {
        key: `col${index + 1}`,
        label: label.trim().length > 0 ? label.trim() : `列${index + 1}`,
        type: inferColumnType(cells),
      } as TableColumn;
    });
    const rows = body.map((cells) => {
      const row: Record<string, string | number> = {};
      columns.forEach((column, index) => {
        row[column.key] = coerceCellValue(cells[index] ?? "", column.type);
      });
      return row;
    });
    const parts: string[] = [];
    if (truncatedColumns > 0) {
      parts.push(`${truncatedColumns}列を切り捨てました`);
    }
    if (truncatedRows > 0) {
      parts.push(`${truncatedRows}行を切り捨てました`);
    }
    setNotice(parts.join("、"));
    setCsvText("");
    setField(fieldKey, JSON.stringify({ columns, rows, emphasis: [] }));
  };

  return (
    <div className="my-2">
      <span>{label}</span>
      <p className={metaTextClass}>
        {data.columns.length}/{maxColumns}列・{data.rows.length}/{maxRows}行
      </p>
      {data.columns.some((column) => column.type === "number" && column.format === "percent") && (
        <p className={metaTextClass}>百分率の列は比率で入力します（0.25→25%）</p>
      )}
      {notice.length > 0 && <p className={errorTextClass}>{notice}</p>}
      <div className="mt-1 overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="border border-border p-1 text-xs">行の強調</th>
              {data.columns.map((column, columnIndex) => (
                <th key={column.key} className="border border-border p-1">
                  <div className="flex flex-col gap-1">
                    <input
                      className={textFieldClass}
                      value={column.label}
                      onChange={(event) => updateColumn(columnIndex, { label: event.target.value })}
                      placeholder="見出し"
                    />
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                      <ColumnKeyInput
                        key={column.key}
                        columnKey={column.key}
                        onCommit={(key) => renameColumnKey(columnIndex, key)}
                      />
                      <select
                        className={textFieldClass}
                        value={column.type}
                        onChange={(event) =>
                          changeColumnType(columnIndex, event.target.value as "text" | "number")
                        }
                      >
                        {COLUMN_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        className={textFieldClass}
                        value={column.align ?? ""}
                        onChange={(event) =>
                          updateColumn(columnIndex, {
                            align:
                              event.target.value.length === 0
                                ? undefined
                                : (event.target.value as "left" | "center" | "right"),
                          })
                        }
                      >
                        {ALIGN_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {column.type === "number" && (
                        <select
                          className={textFieldClass}
                          value={column.format ?? ""}
                          onChange={(event) =>
                            updateColumn(columnIndex, {
                              format:
                                event.target.value.length === 0
                                  ? undefined
                                  : (event.target.value as TableColumn["format"]),
                            })
                          }
                        >
                          {FORMAT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        className={buttonNeutralClass}
                        onClick={() => removeColumn(columnIndex)}
                      >
                        列削除
                      </button>
                    </div>
                  </div>
                </th>
              ))}
              <th className="border border-border p-1 text-xs">行操作</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <td className="border border-border p-1">
                  <select
                    className={textFieldClass}
                    value={rowTone(rowIndex)}
                    onChange={(event) => setRowTone(rowIndex, event.target.value)}
                  >
                    {TONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                {data.columns.map((column) => (
                  <td key={column.key} className="border border-border p-1">
                    <div className="flex items-center gap-1">
                      <CellInput
                        key={`${rowIndex}-${column.key}-${String(row[column.key] ?? "")}`}
                        value={row[column.key]}
                        columnType={column.type}
                        onCommit={(raw) => updateCell(rowIndex, column.key, raw, column.type)}
                      />
                      <select
                        className={textFieldClass}
                        value={cellTone(rowIndex, column.key)}
                        onChange={(event) =>
                          setCellTone(rowIndex, column.key, event.target.value)
                        }
                        title="セルの強調"
                      >
                        {TONE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                ))}
                <td className="border border-border p-1">
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    onClick={() => removeRow(rowIndex)}
                  >
                    行削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" className={buttonNeutralClass} onClick={addColumn}>
          列を追加
        </button>
        <button type="button" className={buttonNeutralClass} onClick={addRow}>
          行を追加
        </button>
      </div>
      <div className="mt-2">
        <span>CSV貼り付け</span>
        <textarea
          className={`mt-1 block w-full ${textFieldClass}`}
          rows={3}
          value={csvText}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder="プラン,月額"
        />
        <button type="button" className={`mt-1 ${buttonNeutralClass}`} onClick={importCsv}>
          取り込む
        </button>
      </div>
    </div>
  );
}
