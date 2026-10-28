import { useEffect, useRef, useState } from "react";
import {
  parseRichText,
  type RichTextMark,
  type TemplateFieldSpec,
} from "@kakeai/contracts";
import { MediaPicker } from "./MediaPicker";
import { RICH_TEXT_DELIMITER, wrapSelection } from "../lib/richTextEditing";
import {
  errorTextClass,
  iconButtonClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

const RICH_TEXT_MARK_LABELS: Record<RichTextMark, string> = {
  bold: "太字",
  italic: "斜体",
  accent: "アクセント",
  outline: "縁取り",
};

interface RichTextFieldProps {
  field: Extract<TemplateFieldSpec, { kind: "richText" }>;
  value: unknown;
  onChange: (value: string) => void;
}

function RichTextField({ field, value, onChange }: RichTextFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const lastSelection = useRef<{ start: number; end: number } | null>(null);
  const text = typeof value === "string" ? value : "";
  const firstError = parseRichText(text, { allowedMarks: field.marks }).errors[0];

  const rememberSelection = () => {
    const element = textareaRef.current;
    if (element !== null) {
      lastSelection.current = { start: element.selectionStart, end: element.selectionEnd };
    }
  };

  useEffect(() => {
    const pending = pendingSelection.current;
    if (pending === null) {
      return;
    }
    pendingSelection.current = null;
    const element = textareaRef.current;
    if (element === null) {
      return;
    }
    element.focus();
    element.setSelectionRange(pending.start, pending.end);
  }, [text]);

  const applyMark = (mark: RichTextMark) => {
    const element = textareaRef.current;
    const focused = element !== null && document.activeElement === element;
    const selection =
      focused && element !== null
        ? { start: element.selectionStart, end: element.selectionEnd }
        : (lastSelection.current ?? { start: text.length, end: text.length });
    const next = wrapSelection(text, selection.start, selection.end, mark);
    pendingSelection.current = { start: next.selectionStart, end: next.selectionEnd };
    onChange(next.value);
  };

  const inputId = `thumbnail-rich-${field.key}`;

  return (
    <div className="my-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {field.label}
      </label>
      <textarea
        id={inputId}
        ref={textareaRef}
        rows={2}
        className={`${textFieldClass} mt-1 block w-full`}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onSelect={rememberSelection}
        onBlur={rememberSelection}
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {field.marks.map((mark) => (
          <button
            key={mark}
            type="button"
            className={iconButtonClass}
            title={`${RICH_TEXT_MARK_LABELS[mark]}（${RICH_TEXT_DELIMITER[mark]}）`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => applyMark(mark)}
          >
            {RICH_TEXT_MARK_LABELS[mark]}
          </button>
        ))}
        <span className={`${metaTextClass} ml-1`}>
          「**太字**」のように記号を直接入力しても装飾できます。
        </span>
      </div>
      {firstError !== undefined && (
        <p className={`${errorTextClass} mt-1`}>{firstError.message}</p>
      )}
    </div>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function NumberSliderField({
  field,
  value,
  onChange,
}: {
  field: Extract<TemplateFieldSpec, { kind: "number" }>;
  value: unknown;
  onChange: (value: number) => void;
}) {
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? 1;
  const current =
    typeof value === "number" ? clampNumber(value, min, max) : min;
  const [draft, setDraft] = useState(String(current));

  useEffect(() => {
    setDraft(String(current));
  }, [current]);

  const commit = () => {
    const raw = draft.trim();
    if (raw === "") {
      setDraft(String(current));
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      setDraft(String(current));
      return;
    }
    const next = clampNumber(parsed, min, max);
    setDraft(String(next));
    onChange(next);
  };

  return (
    <div className="my-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{field.label}</span>
        <span className={`${metaTextClass} tabular-nums`}>{current}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="range"
          aria-label={field.label}
          min={min}
          max={max}
          step={step}
          className="min-w-0 flex-1"
          value={current}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          type="number"
          aria-label={`${field.label}（数値）`}
          min={min}
          max={max}
          step={step}
          className={`${textFieldClass} w-20`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </div>
  );
}

interface FieldProps {
  field: TemplateFieldSpec;
  input: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
  clearValue: (key: string) => void;
}

export function ThumbnailField({ field, input, setValue, clearValue }: FieldProps) {
  const value = input[field.key];
  if (field.kind === "richText") {
    return (
      <RichTextField
        field={field}
        value={value}
        onChange={(next) => setValue(field.key, next)}
      />
    );
  }
  if (field.kind === "text" || field.kind === "optionalText") {
    return (
      <label className="my-2 block">
        <span className="text-sm font-medium">{field.label}</span>
        <input
          className={`${textFieldClass} mt-1 w-full`}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => setValue(field.key, event.target.value)}
        />
      </label>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="my-2 block">
        <span className="text-sm font-medium">{field.label}</span>
        <select
          className={`${textFieldClass} mt-1 block w-full`}
          value={typeof value === "string" ? value : (field.options[0]?.value ?? "")}
          onChange={(event) => setValue(field.key, event.target.value)}
        >
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.kind === "media") {
    return (
      <MediaPicker
        label={field.label}
        kinds={field.assetKinds}
        selectedAssetId={typeof value === "string" ? value : null}
        onSelect={(assetId) => setValue(field.key, assetId)}
      />
    );
  }
  if (field.kind === "mediaCrop") {
    const isFocal = (candidate: unknown): candidate is { x: number; y: number } =>
      typeof candidate === "object" &&
      candidate !== null &&
      typeof (candidate as { x?: unknown }).x === "number" &&
      typeof (candidate as { y?: unknown }).y === "number";
    const clamp = (n: number) => clampNumber(n, 0, 1);
    const focal = isFocal(value)
      ? { x: clamp(value.x), y: clamp(value.y) }
      : { x: 0.5, y: 0.5 };
    const zoomKey = field.zoomKey;
    const rawZoom = zoomKey === undefined ? undefined : input[zoomKey];
    const zoom = typeof rawZoom === "number" ? rawZoom : 1;
    return (
      <div className="my-2">
        <span className="text-sm font-medium">{field.label}</span>
        {(["x", "y"] as const).map((axis) => (
          <label key={axis} className="mt-1 flex items-center gap-2 text-sm">
            <span className="w-6">{axis === "x" ? "左右" : "上下"}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(focal[axis] * 100)}
              onChange={(event) =>
                setValue(field.key, { ...focal, [axis]: Number(event.target.value) / 100 })
              }
            />
          </label>
        ))}
        {zoomKey !== undefined && (
          <label className="mt-1 flex items-center gap-2 text-sm">
            <span className="w-6">拡大</span>
            <input
              type="range"
              min={50}
              max={300}
              value={Math.round(zoom * 100)}
              onChange={(event) => setValue(zoomKey, Number(event.target.value) / 100)}
            />
          </label>
        )}
      </div>
    );
  }
  if (field.kind === "number" && field.min !== undefined && field.max !== undefined) {
    return (
      <NumberSliderField
        field={field}
        value={value}
        onChange={(next) => setValue(field.key, next)}
      />
    );
  }
  if (field.kind === "number" || field.kind === "decimal") {
    return (
      <label className="my-2 block">
        <span className="text-sm font-medium">{field.label}</span>
        <input
          type="number"
          step={field.kind === "number" ? (field.step ?? 1) : "any"}
          min={field.min}
          max={field.max}
          className={`${textFieldClass} mt-1 w-full`}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => {
            const raw = event.target.value;
            if (raw === "") {
              clearValue(field.key);
              return;
            }
            const next = Number(raw);
            if (!Number.isNaN(next)) {
              setValue(field.key, next);
            }
          }}
        />
      </label>
    );
  }
  if (field.kind === "boolean") {
    return (
      <label className="my-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => setValue(field.key, event.target.checked)}
        />
        <span className="font-medium">{field.label}</span>
      </label>
    );
  }
  if (field.kind === "color") {
    return (
      <label className="my-2 flex items-center gap-2 text-sm">
        <span className="font-medium">{field.label}</span>
        <input
          type="color"
          value={typeof value === "string" ? value : "#000000"}
          onChange={(event) => setValue(field.key, event.target.value.toUpperCase())}
        />
      </label>
    );
  }
  return <p className={metaTextClass}>「{field.label}」は編集できません。</p>;
}

export function ThumbnailPreviewFrame({ html }: { html: string | null }) {
  return (
    <div className="w-[640px] max-w-full overflow-hidden rounded border border-border">
      <div className="h-[360px] w-[640px] overflow-hidden">
        <div className="h-[720px] w-[1280px] origin-top-left scale-50">
          {html === null ? (
            <p className={metaTextClass}>プレビューを生成中…</p>
          ) : (
            <iframe
              title="サムネイルプレビュー"
              sandbox="allow-same-origin"
              srcDoc={html}
              className="h-[720px] w-[1280px] border-0"
            />
          )}
        </div>
      </div>
    </div>
  );
}
