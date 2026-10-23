import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  getThumbnailTemplate,
  listThumbnailTemplateCatalog,
  parseRichText,
  type RichTextMark,
  type TemplateFieldSpec,
  type Thumbnail,
} from "@kakeai/contracts";
import { ApiError } from "../api/client";
import { thumbnailImageUrl } from "../api/client";
import {
  useCreateThumbnail,
  useDeleteThumbnail,
  useSaveThumbnail,
  useSetPrimaryThumbnail,
  useThumbnails,
  useThumbnailPreview,
  useWork,
} from "../api/hooks";
import { MediaPicker } from "../components/MediaPicker";
import { RICH_TEXT_DELIMITER, wrapSelection } from "../lib/richTextEditing";
import {
  badgeInfoClass,
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  iconButtonClass,
  metaTextClass,
  sectionCardClass,
  sectionTitleClass,
  textFieldClass,
} from "../ui";

const TEMPLATE_CATALOG = listThumbnailTemplateCatalog();

const RICH_TEXT_MARK_LABELS: Record<RichTextMark, string> = {
  bold: "太字",
  italic: "斜体",
  accent: "アクセント",
  outline: "縁取り",
};

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "操作に失敗しました。";
}

function defaultInput(templateId: string, version: number): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const definition = getThumbnailTemplate(templateId, version);
  for (const field of definition?.inputFields ?? []) {
    if (field.kind === "select" && field.optional !== true) {
      const first = field.options[0];
      if (first !== undefined) {
        input[field.key] = first.value;
      }
    } else if (field.kind === "text" || (field.kind === "richText" && field.optional !== true)) {
      input[field.key] = "";
    }
  }
  return input;
}

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

interface FieldProps {
  field: TemplateFieldSpec;
  input: Record<string, unknown>;
  setValue: (key: string, value: unknown) => void;
  clearValue: (key: string) => void;
}

function ThumbnailField({ field, input, setValue, clearValue }: FieldProps) {
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
    const clamp = (n: number) => Math.min(1, Math.max(0, n));
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
          onChange={(event) => setValue(field.key, event.target.value)}
        />
      </label>
    );
  }
  return <p className={metaTextClass}>「{field.label}」は編集できません。</p>;
}

function ThumbnailPreviewFrame({ html }: { html: string | null }) {
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

function ThumbnailForm({
  editionId,
  candidate,
  defaultTemplate,
  onSaved,
}: {
  editionId: string;
  candidate: Thumbnail | null;
  defaultTemplate: { id: string; version: number };
  onSaved: (thumbnail: Thumbnail) => void;
}) {
  const initialTemplate = candidate?.template ?? defaultTemplate;
  const [label, setLabel] = useState(candidate?.label ?? "");
  const [templateId, setTemplateId] = useState(initialTemplate.id);
  const [templateVersion, setTemplateVersion] = useState(initialTemplate.version);
  const [input, setInput] = useState<Record<string, unknown>>(
    (candidate?.input as Record<string, unknown> | undefined) ??
      defaultInput(initialTemplate.id, initialTemplate.version),
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateThumbnail(editionId);
  const save = useSaveThumbnail(editionId);
  const previewMutation = useThumbnailPreview(editionId);
  const previewRef = useRef(previewMutation.mutateAsync);
  const seqRef = useRef(0);
  useEffect(() => {
    previewRef.current = previewMutation.mutateAsync;
  }, [previewMutation.mutateAsync]);

  const definition = getThumbnailTemplate(templateId, templateVersion);
  const fields = definition?.inputFields ?? [];

  const requestBody = useMemo(
    () => ({ label: label.trim().length === 0 ? "無題" : label.trim(), template: { id: templateId, version: templateVersion }, input }),
    [label, templateId, templateVersion, input],
  );

  useEffect(() => {
    const seq = ++seqRef.current;
    const handle = setTimeout(() => {
      previewRef
        .current({ template: requestBody.template, input: requestBody.input })
        .then((result) => {
          if (seq === seqRef.current) {
            setPreview(result.html);
            setPreviewError(null);
          }
        })
        .catch(() => {
          if (seq === seqRef.current) {
            setPreview(null);
            setPreviewError("プレビューを生成できません。入力を確認してください。");
          }
        });
    }, 400);
    return () => {
      clearTimeout(handle);
    };
  }, [requestBody]);

  const setValue = (key: string, value: unknown) => {
    setInput((previous) => ({ ...previous, [key]: value }));
  };

  const clearValue = (key: string) => {
    setInput((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  };

  const changeTemplate = (id: string, version: number) => {
    setTemplateId(id);
    setTemplateVersion(version);
    setInput(defaultInput(id, version));
  };

  const submit = () => {
    setError(null);
    const body = { label: requestBody.label, template: requestBody.template, input: requestBody.input };
    const run = candidate === null ? create.mutateAsync(body) : save.mutateAsync({ id: candidate.id, input: body });
    run.then((result) => onSaved(result)).catch((err) => setError(errorMessage(err)));
  };

  const busy = create.isPending || save.isPending;

  return (
    <div className="flex flex-wrap gap-6">
      <div className="min-w-[280px] flex-1">
        <label className="my-2 block">
          <span className="text-sm font-medium">候補名</span>
          <input
            className={`${textFieldClass} mt-1 w-full`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="my-2 block">
          <span className="text-sm font-medium">テンプレート</span>
          <select
            className={`${textFieldClass} mt-1 block w-full`}
            value={`${templateId}@${templateVersion}`}
            onChange={(event) => {
              const entry = TEMPLATE_CATALOG.find(
                (item) => `${item.id}@${item.version}` === event.target.value,
              );
              if (entry !== undefined) {
                changeTemplate(entry.id, entry.version);
              }
            }}
          >
            {TEMPLATE_CATALOG.map((entry) => (
              <option key={`${entry.id}@${entry.version}`} value={`${entry.id}@${entry.version}`}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        {fields.map((field) => (
          <ThumbnailField
            key={field.key}
            field={field}
            input={input}
            setValue={setValue}
            clearValue={clearValue}
          />
        ))}
        <div className="my-3 flex items-center gap-2">
          <button type="button" className={buttonPrimaryClass} disabled={busy} onClick={submit}>
            {candidate === null ? "候補を追加" : "保存"}
          </button>
          {error !== null && <span className={errorTextClass}>{error}</span>}
        </div>
      </div>
      <div className="min-w-[320px]">
        <ThumbnailPreviewFrame html={preview} />
        {previewError !== null && <p className={`${errorTextClass} mt-2`}>{previewError}</p>}
      </div>
    </div>
  );
}

export function ThumbnailsPage() {
  const { workId, editionId } = useParams<{ workId: string; editionId: string }>();
  const work = useWork(workId);
  const thumbnails = useThumbnails(editionId);
  const setPrimary = useSetPrimaryThumbnail(editionId);
  const remove = useDeleteThumbnail(editionId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const candidates = thumbnails.data ?? [];
  const selected = candidates.find((candidate) => candidate.id === selectedId) ?? null;
  const defaultTemplate = TEMPLATE_CATALOG[0] ?? null;

  useEffect(() => {
    if (thumbnails.isFetching || !thumbnails.isSuccess) {
      return;
    }
    if (selectedId !== null && !candidates.some((candidate) => candidate.id === selectedId)) {
      setSelectedId(null);
    }
  }, [candidates, selectedId, thumbnails.isFetching, thumbnails.isSuccess]);

  return (
    <div className="mx-auto max-w-5xl">
      <p className={metaTextClass}>
        <Link to={workId === undefined ? "/" : `/works/${encodeURIComponent(workId)}`}>
          作品に戻る
        </Link>
      </p>
      <h1 className="mt-2 mb-1 text-lg font-bold">
        サムネイル{work.data !== undefined ? `: ${work.data.title}` : ""}
      </h1>
      <p className={metaTextClass}>
        YouTube投稿用のサムネイル候補を作成します。言語版ごとに管理し、選んだ1枚を書き出せます。
      </p>

      <section className={sectionCardClass}>
        <h2 className={sectionTitleClass}>候補</h2>
        {thumbnails.isLoading && <p className={metaTextClass}>読み込み中…</p>}
        {thumbnails.isError && <p className={errorTextClass}>{errorMessage(thumbnails.error)}</p>}
        {listError !== null && <p className={errorTextClass}>{listError}</p>}
        <div className="flex flex-wrap gap-2">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              className={`w-48 rounded border p-2 ${
                candidate.id === selectedId ? "border-brand-500" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="truncate text-left text-sm font-medium"
                  onClick={() => setSelectedId(candidate.id)}
                >
                  {candidate.label}
                </button>
                {candidate.isPrimary && <span className={badgeInfoClass}>投稿用</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <a
                  className={buttonNeutralClass}
                  href={thumbnailImageUrl(candidate.id)}
                  download
                >
                  書き出し
                </a>
                {!candidate.isPrimary && (
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    onClick={() =>
                      setPrimary.mutate(candidate.id, {
                        onError: (err) => setListError(errorMessage(err)),
                      })
                    }
                  >
                    投稿用にする
                  </button>
                )}
                <button
                  type="button"
                  className={buttonDangerClass}
                  onClick={() => {
                    if (!window.confirm(`「${candidate.label}」を削除しますか？`)) {
                      return;
                    }
                    setListError(null);
                    remove.mutate(candidate.id, {
                      onSuccess: () => {
                        if (selectedId === candidate.id) {
                          setSelectedId(null);
                        }
                      },
                      onError: (err) => setListError(errorMessage(err)),
                    });
                  }}
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={() => setSelectedId(null)}
          >
            ＋ 新しい候補
          </button>
        </div>
      </section>

      {editionId === undefined && (
        <p className={errorTextClass}>編集する言語版がありません。</p>
      )}
      {editionId !== undefined && defaultTemplate === null && (
        <p className={errorTextClass}>利用できるサムネイルテンプレートがありません。</p>
      )}
      {editionId !== undefined && defaultTemplate !== null && (
        <section className={sectionCardClass}>
          <h2 className={sectionTitleClass}>{selected === null ? "新しい候補" : "候補を編集"}</h2>
          <ThumbnailForm
            key={selected?.id ?? "new"}
            editionId={editionId}
            candidate={selected}
            defaultTemplate={defaultTemplate}
            onSaved={(thumbnail) => setSelectedId(thumbnail.id)}
          />
        </section>
      )}
    </div>
  );
}
