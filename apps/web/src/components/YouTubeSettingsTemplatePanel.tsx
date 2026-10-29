import { useEffect, useState } from "react";
import {
  youtubeVideoSettingsDocumentSchema,
  type YouTubeVideoSettingsDocument,
} from "@kakeai/contracts";
import { ApiError } from "../api/client";
import {
  useCreateYouTubeSettingsTemplate,
  useDeleteYouTubeSettingsTemplate,
  useYouTubeSettingsTemplate,
  useYouTubeSettingsTemplates,
  useUpdateYouTubeSettingsTemplate,
} from "../api/hooks";
import {
  buttonDangerClass,
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

export interface YouTubeSettingsTemplatePanelProps {
  currentSettings: YouTubeVideoSettingsDocument;
  defaultName: string;
  onApply: (document: YouTubeVideoSettingsDocument) => void;
}

export function YouTubeSettingsTemplatePanel({
  currentSettings,
  defaultName,
  onApply,
}: YouTubeSettingsTemplatePanelProps) {
  const [selectedId, setSelectedId] = useState("");
  const [nameDraft, setNameDraft] = useState(defaultName);
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templatesQuery = useYouTubeSettingsTemplates();
  const templateDetailQuery = useYouTubeSettingsTemplate(
    selectedId === "" ? undefined : selectedId,
  );
  const createTemplate = useCreateYouTubeSettingsTemplate();
  const updateTemplate = useUpdateYouTubeSettingsTemplate();
  const deleteTemplate = useDeleteYouTubeSettingsTemplate();

  const detail =
    templateDetailQuery.data?.id === selectedId ? templateDetailQuery.data : undefined;
  const templates = templatesQuery.data ?? [];
  const trimmedName = nameDraft.trim();

  useEffect(() => {
    if (selectedId === "" && !nameTouched) {
      setNameDraft(defaultName);
    }
  }, [defaultName, nameTouched, selectedId]);

  const selectTemplate = (templateId: string) => {
    setSelectedId(templateId);
    setError(null);
    setNameTouched(false);
    if (templateId === "") {
      setNameDraft(defaultName);
      return;
    }
    const selected = templates.find((t) => t.id === templateId);
    if (selected !== undefined) {
      setNameDraft(selected.name);
    }
  };

  const applyTemplate = () => {
    if (detail === undefined) {
      return;
    }
    if (
      !window.confirm(
        `現在の設定をテンプレート「${detail.name}」で上書きしますか？タイトルを含む全項目が置き換わります。`,
      )
    ) {
      return;
    }
    setError(null);
    const validated = youtubeVideoSettingsDocumentSchema.safeParse(structuredClone(detail.document));
    if (!validated.success) {
      setError("テンプレートの内容が無効です。");
      return;
    }
    onApply(validated.data);
  };

  const saveNewTemplate = () => {
    if (trimmedName.length === 0) {
      return;
    }
    setError(null);
    createTemplate.mutate(
      { name: trimmedName, document: currentSettings },
      {
        onSuccess: (template) => {
          setSelectedId(template.id);
          setNameDraft(template.name);
          setNameTouched(false);
        },
        onError: (mutationError) => setError(errorMessage(mutationError)),
      },
    );
  };

  const overwriteTemplate = () => {
    if (selectedId === "" || trimmedName.length === 0) {
      return;
    }
    if (
      !window.confirm(
        "選択中のテンプレートを現在の設定で上書きしますか？タイトルを含む全項目が更新されます。",
      )
    ) {
      return;
    }
    setError(null);
    updateTemplate.mutate(
      {
        templateId: selectedId,
        input: { name: trimmedName, document: currentSettings },
      },
      {
        onSuccess: (template) => {
          setNameDraft(template.name);
          setNameTouched(false);
        },
        onError: (mutationError) => setError(errorMessage(mutationError)),
      },
    );
  };

  const removeTemplate = () => {
    if (selectedId === "") {
      return;
    }
    if (!window.confirm("選択中のテンプレートを削除しますか？")) {
      return;
    }
    setError(null);
    deleteTemplate.mutate(selectedId, {
      onSuccess: () => {
        setSelectedId("");
        setNameDraft(defaultName);
        setNameTouched(false);
      },
      onError: (mutationError) => setError(errorMessage(mutationError)),
    });
  };

  const loadPending = templateDetailQuery.isLoading || templateDetailQuery.isPending;

  return (
    <details className="mt-4 rounded border border-border p-3">
      <summary className={detailsSummaryClass}>
        投稿設定テンプレート（プリセットの保存と適用）
      </summary>
      <div className="mt-3 grid gap-3">
        {templatesQuery.isLoading && <p className={metaTextClass}>読み込み中…</p>}
        {templatesQuery.isError && (
          <p className={errorTextClass}>{errorMessage(templatesQuery.error)}</p>
        )}

        <label className="block text-xs">
          <span className="font-semibold">テンプレート</span>
          <select
            className={`${textFieldClass} mt-1 block w-full`}
            value={selectedId}
            onChange={(event) => selectTemplate(event.target.value)}
          >
            <option value="">（新規テンプレート）</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={selectedId === "" || detail === undefined || loadPending}
            onClick={applyTemplate}
          >
            {loadPending ? "読み込み中…" : "このテンプレートを適用"}
          </button>
          <button
            type="button"
            className={buttonDangerClass}
            disabled={selectedId === "" || deleteTemplate.isPending}
            onClick={removeTemplate}
          >
            削除
          </button>
          {templateDetailQuery.isError && (
            <span className={errorTextClass}>{errorMessage(templateDetailQuery.error)}</span>
          )}
        </div>

        <label className="block text-xs">
          <span className="font-semibold">テンプレート名</span>
          <input
            className={`${textFieldClass} mt-1 block w-full`}
            maxLength={100}
            value={nameDraft}
            onChange={(event) => {
              setNameDraft(event.target.value);
              setNameTouched(true);
            }}
            placeholder="例: 標準投稿プリセット"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={trimmedName.length === 0 || createTemplate.isPending}
            onClick={saveNewTemplate}
          >
            {createTemplate.isPending ? "保存中…" : "現在の設定を新規保存"}
          </button>
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={selectedId === "" || trimmedName.length === 0 || updateTemplate.isPending}
            onClick={overwriteTemplate}
          >
            {updateTemplate.isPending ? "上書き中…" : "選択中を上書き"}
          </button>
        </div>

        <p className={metaTextClass}>
          「このテンプレートを適用」を押すと、タイトルを含むすべてのフィールドがテンプレートの内容で置き換わります（確認ダイアログが表示されます）。
        </p>
        {error !== null && <p className={errorTextClass}>{error}</p>}
      </div>
    </details>
  );
}
