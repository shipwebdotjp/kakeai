import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyThumbnailAppearance,
  getThumbnailTemplate,
  type FontFace,
  type LanguageEditionSummary,
  type ResolvedThumbnailAppearance,
  type SupportedLocale,
  type Thumbnail,
  type ThumbnailAppearance,
} from "@kakeai/contracts";
import { ApiError } from "../api/client";
import {
  useCreateThumbnail,
  useSaveThumbnail,
  useThumbnails,
  useThumbnailPreview,
} from "../api/hooks";
import { ThumbnailAppearanceEditor } from "./ThumbnailAppearanceEditor";
import { ThumbnailField, ThumbnailPreviewFrame } from "./thumbnail-fields";
import { LOCALE_LABELS } from "../lib/localeLabels";
import {
  blankThumbnailCandidateDraft,
  importedThumbnailCandidateDraft,
  thumbnailDraftSubmitBody,
} from "../lib/thumbnailCandidateDraft";
import {
  defaultThumbnailInput,
  thumbnailInputWithDefaults,
  THUMBNAIL_TEMPLATE_CATALOG,
} from "../lib/thumbnailTemplate";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  detailsSummaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "操作に失敗しました。";
}

export function ThumbnailForm({
  editionId,
  locale,
  otherEditions,
  candidate,
  defaultTemplate,
  appearanceDefaults,
  commonAppearance,
  appearanceLoading,
  fontFaces,
  fontCatalogSupported,
  onSaved,
}: {
  editionId: string;
  locale: SupportedLocale;
  otherEditions: readonly LanguageEditionSummary[];
  candidate: Thumbnail | null;
  defaultTemplate: { id: string; version: number };
  appearanceDefaults: ResolvedThumbnailAppearance | null;
  commonAppearance: ThumbnailAppearance | null | undefined;
  appearanceLoading: boolean;
  fontFaces: readonly FontFace[];
  fontCatalogSupported: boolean;
  onSaved: (thumbnail: Thumbnail) => void;
}) {
  const initialTemplate = candidate?.template ?? defaultTemplate;
  const [label, setLabel] = useState(candidate?.label ?? "");
  const [templateId, setTemplateId] = useState(initialTemplate.id);
  const [templateVersion, setTemplateVersion] = useState(initialTemplate.version);
  const [input, setInput] = useState<Record<string, unknown>>(
    thumbnailInputWithDefaults(
      initialTemplate.id,
      initialTemplate.version,
      candidate?.input,
    ),
  );
  const [appearanceOverride, setAppearanceOverride] = useState<ThumbnailAppearance | null>(
    candidate?.appearanceOverride ?? null,
  );
  const [importEditionId, setImportEditionId] = useState("");
  const [importThumbnailId, setImportThumbnailId] = useState("");
  const [importedFrom, setImportedFrom] = useState<{
    editionId: string;
    thumbnailId: string;
    label: string;
  } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useCreateThumbnail(editionId);
  const save = useSaveThumbnail(editionId);
  const previewMutation = useThumbnailPreview(editionId);
  const importCandidates = useThumbnails(
    importEditionId.length === 0 ? undefined : importEditionId,
  );
  const previewRef = useRef(previewMutation.mutateAsync);
  const seqRef = useRef(0);
  useEffect(() => {
    previewRef.current = previewMutation.mutateAsync;
  }, [previewMutation.mutateAsync]);

  const definition = getThumbnailTemplate(templateId, templateVersion);
  const fields = definition?.inputFields ?? [];
  const inheritedAppearance = useMemo(
    () =>
      appearanceDefaults === null
        ? null
        : applyThumbnailAppearance(appearanceDefaults, commonAppearance ?? null, locale),
    [appearanceDefaults, commonAppearance, locale],
  );

  const previewBody = useMemo(
    () => ({
      template: { id: templateId, version: templateVersion },
      input,
      appearanceOverride: appearanceOverride ?? undefined,
      ...(commonAppearance === undefined ? {} : { appearance: commonAppearance }),
    }),
    [templateId, templateVersion, input, appearanceOverride, commonAppearance],
  );

  useEffect(() => {
    const seq = ++seqRef.current;
    const handle = setTimeout(() => {
      previewRef
        .current(previewBody)
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
  }, [previewBody]);

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
    setInput(defaultThumbnailInput(id, version));
  };

  const selectedImport =
    (importCandidates.data ?? []).find((entry) => entry.id === importThumbnailId) ?? null;

  const applyImport = () => {
    if (selectedImport === null) {
      return;
    }
    const draft = importedThumbnailCandidateDraft(selectedImport, importEditionId);
    setLabel(draft.label);
    setTemplateId(draft.template.id);
    setTemplateVersion(draft.template.version);
    setInput(draft.input);
    setAppearanceOverride(draft.appearanceOverride);
    setImportedFrom(draft.importedFrom);
  };

  const discardImport = () => {
    const draft = blankThumbnailCandidateDraft(defaultTemplate);
    setLabel(draft.label);
    setTemplateId(draft.template.id);
    setTemplateVersion(draft.template.version);
    setInput(draft.input);
    setAppearanceOverride(draft.appearanceOverride);
    setImportedFrom(draft.importedFrom);
    setImportThumbnailId("");
  };

  const submit = () => {
    setError(null);
    const body = thumbnailDraftSubmitBody({
      label,
      template: { id: templateId, version: templateVersion },
      input,
      appearanceOverride,
      importedFrom,
    });
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
        {candidate === null && otherEditions.length > 0 && (
          <fieldset className="my-3 rounded border border-border p-2">
            <legend className="px-1 text-sm font-medium">他の言語版から取り込む</legend>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="block font-medium">言語版</span>
                <select
                  className={`${textFieldClass} mt-1`}
                  value={importEditionId}
                  onChange={(event) => {
                    setImportEditionId(event.target.value);
                    setImportThumbnailId("");
                  }}
                >
                  <option value="">選択…</option>
                  {otherEditions.map((edition) => (
                    <option key={edition.id} value={edition.id}>
                      {LOCALE_LABELS[edition.locale]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="block font-medium">候補</span>
                <select
                  className={`${textFieldClass} mt-1`}
                  value={importThumbnailId}
                  disabled={importEditionId.length === 0}
                  onChange={(event) => setImportThumbnailId(event.target.value)}
                >
                  <option value="">
                    {importCandidates.isLoading ? "読み込み中…" : "選択…"}
                  </option>
                  {(importCandidates.data ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={buttonNeutralClass}
                disabled={selectedImport === null}
                onClick={applyImport}
              >
                取り込む
              </button>
            </div>
            {importCandidates.isError && (
              <p className={`${errorTextClass} mt-2`}>候補を読み込めませんでした。</p>
            )}
            {importedFrom !== null && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <p className={metaTextClass}>
                  「{importedFrom.label}」を取り込みました。保存するまで新しい候補は作成されません。
                </p>
                <button type="button" className={buttonNeutralClass} onClick={discardImport}>
                  取り込みをやめる
                </button>
              </div>
            )}
          </fieldset>
        )}
        <label className="my-2 block">
          <span className="text-sm font-medium">テンプレート</span>
          <select
            className={`${textFieldClass} mt-1 block w-full`}
            value={definition === undefined ? "" : `${templateId}@${templateVersion}`}
            onChange={(event) => {
              const entry = THUMBNAIL_TEMPLATE_CATALOG.find(
                (item) => `${item.id}@${item.version}` === event.target.value,
              );
              if (entry !== undefined) {
                changeTemplate(entry.id, entry.version);
              }
            }}
          >
            {definition === undefined && (
              <option value="" disabled>
                （利用できないテンプレート: {templateId}@{templateVersion}）
              </option>
            )}
            {THUMBNAIL_TEMPLATE_CATALOG.map((entry) => (
              <option key={`${entry.id}@${entry.version}`} value={`${entry.id}@${entry.version}`}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        {definition === undefined && (
          <div className="my-2 flex flex-wrap items-center gap-2">
            <p className={errorTextClass}>
              この候補のテンプレートは現在利用できません。テンプレートを選び直して保存してください。
            </p>
            <button
              type="button"
              className={buttonNeutralClass}
              onClick={() => changeTemplate(defaultTemplate.id, defaultTemplate.version)}
            >
              既定のテンプレートに切り替える
            </button>
          </div>
        )}
        {fields.map((field) => (
          <ThumbnailField
            key={field.key}
            field={field}
            input={input}
            setValue={setValue}
            clearValue={clearValue}
          />
        ))}
        {inheritedAppearance === null ? (
          <p className={metaTextClass}>
            {appearanceLoading
              ? "共通の見た目を読み込み中…"
              : "共通の見た目を読み込めないため、候補の上書きは編集できません。"}
          </p>
        ) : (
          <details className="my-3 rounded border border-border p-2">
            <summary className={detailsSummaryClass}>この候補だけ見た目を上書き</summary>
            <div className="mt-2">
              <ThumbnailAppearanceEditor
                base={inheritedAppearance}
                value={appearanceOverride}
                onChange={setAppearanceOverride}
                fontFaces={fontFaces}
                fontCatalogSupported={fontCatalogSupported}
                idPrefix={`candidate-${candidate?.id ?? "new"}`}
                key={`candidate-${candidate?.id ?? "new"}-${locale}`}
                locale={locale}
                resetLabel="候補の上書きをすべて解除"
              />
            </div>
          </details>
        )}
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
