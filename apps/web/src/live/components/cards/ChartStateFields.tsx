import { useEffect, useState } from "react";
import type { LiveChartState, TableTone } from "@kakeai/contracts";
import { TABLE_TONES } from "@kakeai/contracts";
import {
  addChartCategory,
  addChartSeries,
  LIVE_CHART_MAX_CATEGORIES,
  LIVE_CHART_MAX_SERIES,
  removeChartCategory,
  removeChartSeries,
  setChartValue,
  toggleChartHighlight,
} from "../../model/cards";
import { createLiveLocalId } from "../../model/ids";
import { iconButtonClass, metaTextClass, textFieldClass } from "../../../ui";
import { setOptionalText } from "./optional-field";
import {
  isBlankText,
  requiredFieldClass,
  requiredMessageClass,
} from "./required-field";

interface ChartStateFieldsProps {
  state: LiveChartState;
  onChange: (state: LiveChartState) => void;
}

export function ChartStateFields({ state, onChange }: ChartStateFieldsProps) {
  const highlight = state.highlight ?? { seriesKeys: [], categoryKeys: [] };
  const categoriesFull = state.categories.length >= LIVE_CHART_MAX_CATEGORIES;
  const seriesFull = state.series.length >= LIVE_CHART_MAX_SERIES;
  const categoriesMissing = state.categories.length === 0;
  const seriesMissing = state.series.length === 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          タイトル
          <input
            className={`mt-1 w-full ${textFieldClass}`}
            value={state.title ?? ""}
            onChange={(event) =>
            onChange(setOptionalText(state, "title", event.target.value))
          }
          />
        </label>
        <label className="block text-sm">
          単位
          <input
            className={`mt-1 w-full ${textFieldClass}`}
            value={state.unit ?? ""}
            onChange={(event) =>
            onChange(setOptionalText(state, "unit", event.target.value))
          }
          />
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 text-sm font-medium">カテゴリ</p>
          <button
            type="button"
            className="text-sm text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            disabled={categoriesFull}
            title={
              categoriesFull
                ? `カテゴリは最大${LIVE_CHART_MAX_CATEGORIES}件までです。`
                : undefined
            }
            onClick={() =>
              onChange(
                addChartCategory(state, {
                  key: createLiveLocalId("category"),
                  label: "新しいカテゴリ",
                }),
              )
            }
          >
            カテゴリを追加
          </button>
        </div>
        {categoriesFull && (
          <p className={`m-0 mt-1 ${metaTextClass}`}>
            カテゴリは最大{LIVE_CHART_MAX_CATEGORIES}件までです。
          </p>
        )}
        {categoriesMissing && (
          <p className={`m-0 mt-1 ${requiredMessageClass}`}>
            カテゴリを1件以上追加してください。
          </p>
        )}
        <ul className="m-0 mt-1 list-none space-y-1 p-0">
          {state.categories.map((category) => {
            const labelMissing = isBlankText(category.label);
            return (
              <li key={category.key} className="flex items-center gap-1">
                <div className="min-w-40 flex-1">
                  <input
                    className={`w-full ${textFieldClass} ${labelMissing ? requiredFieldClass : ""}`}
                    value={category.label}
                    aria-label="カテゴリ名"
                    aria-invalid={labelMissing}
                    onChange={(event) =>
                      onChange({
                        ...state,
                        categories: state.categories.map((entry) =>
                          entry.key === category.key
                            ? { ...entry, label: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  />
                  {labelMissing && (
                    <span className={`block ${requiredMessageClass}`}>
                      カテゴリ名は必須です。
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={highlight.categoryKeys.includes(category.key)}
                    onChange={() => onChange(toggleChartHighlight(state, "category", category.key))}
                  />
                  強調
                </label>
                <span className="max-w-24 truncate text-[10px] text-muted-foreground" title={category.key}>
                  {category.key}
                </span>
                <button
                  type="button"
                  className={iconButtonClass}
                  aria-label={`${category.label} を削除`}
                  disabled={state.categories.length <= 1}
                  onClick={() => onChange(removeChartCategory(state, category.key))}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 text-sm font-medium">系列</p>
          <button
            type="button"
            className="text-sm text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
            disabled={seriesFull}
            title={
              seriesFull ? `系列は最大${LIVE_CHART_MAX_SERIES}件までです。` : undefined
            }
            onClick={() =>
              onChange(
                addChartSeries(state, {
                  key: createLiveLocalId("series"),
                  label: "新しい系列",
                  values: {},
                }),
              )
            }
          >
            系列を追加
          </button>
        </div>
        {seriesFull && (
          <p className={`m-0 mt-1 ${metaTextClass}`}>
            系列は最大{LIVE_CHART_MAX_SERIES}件までです。
          </p>
        )}
        {seriesMissing && (
          <p className={`m-0 mt-1 ${requiredMessageClass}`}>
            系列を1件以上追加してください。
          </p>
        )}
        <div className="mt-1 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border-b border-border p-1 text-left">系列</th>
                {state.categories.map((category) => (
                  <th key={category.key} className="border-b border-border p-1 text-left">
                    {category.label}
                  </th>
                ))}
                <th className="border-b border-border p-1" />
              </tr>
            </thead>
            <tbody>
              {state.series.map((series) => {
                const labelMissing = isBlankText(series.label);
                return (
                <tr key={series.key}>
                  <td className="min-w-40 p-1">
                    <input
                      className={`w-full ${textFieldClass} ${labelMissing ? requiredFieldClass : ""}`}
                      value={series.label}
                      aria-label="系列名"
                      aria-invalid={labelMissing}
                      onChange={(event) =>
                        onChange({
                          ...state,
                          series: state.series.map((entry) =>
                            entry.key === series.key
                              ? { ...entry, label: event.target.value }
                              : entry,
                          ),
                        })
                      }
                    />
                    {labelMissing && (
                      <span className={`block ${requiredMessageClass}`}>
                        系列名は必須です。
                      </span>
                    )}
                    <div className="mt-1 flex items-center gap-1 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={highlight.seriesKeys.includes(series.key)}
                          onChange={() => onChange(toggleChartHighlight(state, "series", series.key))}
                        />
                        強調
                      </label>
                      <select
                        className={`${textFieldClass} py-0.5`}
                        aria-label="系列トーン"
                        value={series.tone ?? ""}
                        onChange={(event) =>
                          onChange({
                            ...state,
                            series: state.series.map((entry) =>
                              entry.key === series.key
                                ? {
                                    ...entry,
                                    ...(event.target.value === ""
                                      ? { tone: undefined }
                                      : { tone: event.target.value as TableTone }),
                                  }
                                : entry,
                            ),
                          })
                        }
                      >
                        <option value="">既定</option>
                        {TABLE_TONES.map((tone) => (
                          <option key={tone} value={tone}>
                            {tone}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  {state.categories.map((category) => (
                    <td key={category.key} className="p-1">
                      <ChartValueInput
                        value={series.values[category.key] ?? 0}
                        ariaLabel={`${series.label} ${category.label} の値`}
                        onCommit={(value) =>
                          onChange(setChartValue(state, series.key, category.key, value))
                        }
                      />
                    </td>
                  ))}
                  <td className="p-1">
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label={`${series.label} を削除`}
                      disabled={state.series.length <= 1}
                      onClick={() => onChange(removeChartSeries(state, series.key))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface ChartValueInputProps {
  value: number;
  ariaLabel: string;
  onCommit: (value: number) => void;
}

function ChartValueInput({ value, ariaLabel, onCommit }: ChartValueInputProps) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    const parsed = Number(trimmed);
    if (trimmed === "" || !Number.isFinite(parsed)) {
      setText(String(value));
      return;
    }
    onCommit(parsed);
  };

  return (
    <input
      className={`w-20 ${textFieldClass}`}
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}
