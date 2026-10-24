import { useEffect, useState } from "react";
import type { ThumbnailAppearance } from "@kakeai/contracts";
import { ApiError } from "../api/client";
import {
  useCreateThumbnailAppearancePreset,
  useDeleteThumbnailAppearancePreset,
  useThumbnailAppearancePreset,
  useThumbnailAppearancePresets,
  useUpdateThumbnailAppearancePreset,
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

function formatPresetDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("ja-JP");
}

function cloneAppearance(appearance: ThumbnailAppearance): ThumbnailAppearance {
  return JSON.parse(JSON.stringify(appearance)) as ThumbnailAppearance;
}

export interface ThumbnailAppearancePresetPanelProps {
  appearanceDraft: ThumbnailAppearance | null;
  dirty: boolean;
  defaultName: string;
  onApply: (appearance: ThumbnailAppearance) => void;
}

export function ThumbnailAppearancePresetPanel({
  appearanceDraft,
  dirty,
  defaultName,
  onApply,
}: ThumbnailAppearancePresetPanelProps) {
  const [selectedId, setSelectedId] = useState("");
  const [nameDraft, setNameDraft] = useState(defaultName);
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presetsQuery = useThumbnailAppearancePresets();
  const detailQuery = useThumbnailAppearancePreset(selectedId === "" ? undefined : selectedId);
  const createPreset = useCreateThumbnailAppearancePreset();
  const updatePreset = useUpdateThumbnailAppearancePreset();
  const deletePreset = useDeleteThumbnailAppearancePreset();

  const detail = detailQuery.data?.id === selectedId ? detailQuery.data : undefined;
  const presets = presetsQuery.data ?? [];
  const trimmedName = nameDraft.trim();

  useEffect(() => {
    if (selectedId === "" && !nameTouched) {
      setNameDraft(defaultName);
    }
  }, [defaultName, nameTouched, selectedId]);

  const selectPreset = (presetId: string) => {
    setSelectedId(presetId);
    setError(null);
    setNameTouched(false);
    if (presetId === "") {
      setNameDraft(defaultName);
      return;
    }
    const selected = presets.find((preset) => preset.id === presetId);
    if (selected !== undefined) {
      setNameDraft(selected.name);
    }
  };

  const applyPreset = () => {
    if (detail === undefined) {
      return;
    }
    if (
      dirty &&
      !window.confirm("未保存の変更を破棄してプリセットを読み込みますか？")
    ) {
      return;
    }
    setError(null);
    onApply(cloneAppearance(detail.appearance));
  };

  const saveNewPreset = () => {
    if (appearanceDraft === null || trimmedName.length === 0) {
      return;
    }
    setError(null);
    createPreset.mutate(
      { name: trimmedName, appearance: appearanceDraft },
      {
        onSuccess: (preset) => {
          setSelectedId(preset.id);
          setNameDraft(preset.name);
          setNameTouched(false);
        },
        onError: (mutationError) => setError(errorMessage(mutationError)),
      },
    );
  };

  const overwritePreset = () => {
    if (selectedId === "" || appearanceDraft === null || trimmedName.length === 0) {
      return;
    }
    if (
      !window.confirm(
        "選択中のプリセットを現在の外観で上書きしますか？適用済みの言語版は自動では変わりません。",
      )
    ) {
      return;
    }
    setError(null);
    updatePreset.mutate(
      { id: selectedId, input: { name: trimmedName, appearance: appearanceDraft } },
      {
        onSuccess: (preset) => {
          setNameDraft(preset.name);
          setNameTouched(false);
        },
        onError: (mutationError) => setError(errorMessage(mutationError)),
      },
    );
  };

  const removePreset = () => {
    if (selectedId === "") {
      return;
    }
    if (!window.confirm("選択中の外観プリセットを削除しますか？")) {
      return;
    }
    setError(null);
    deletePreset.mutate(selectedId, {
      onSuccess: () => {
        setSelectedId("");
        setNameDraft(defaultName);
        setNameTouched(false);
      },
      onError: (mutationError) => setError(errorMessage(mutationError)),
    });
  };

  const loadPending = detailQuery.isFetching;

  return (
    <details className="mt-3 rounded border border-border p-2">
      <summary className={detailsSummaryClass}>
        外観プリセット（他の作品・言語版で再利用）
      </summary>
      <div className="mt-2 grid gap-2">
        {presetsQuery.isLoading && <p className={metaTextClass}>読み込み中…</p>}
        {presetsQuery.isError && (
          <p className={errorTextClass}>{errorMessage(presetsQuery.error)}</p>
        )}

        <label className="block text-xs">
          <span className="font-semibold">プリセット</span>
          <select
            className={`${textFieldClass} mt-1 block w-full`}
            value={selectedId}
            onChange={(event) => selectPreset(event.target.value)}
          >
            <option value="">（新規プリセット）</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
                {formatPresetDate(preset.updatedAt) === ""
                  ? ""
                  : `（${formatPresetDate(preset.updatedAt)}）`}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={selectedId === "" || detail === undefined || loadPending}
            onClick={applyPreset}
          >
            {loadPending ? "読み込み中…" : "読み込む"}
          </button>
          <button
            type="button"
            className={buttonDangerClass}
            disabled={selectedId === "" || deletePreset.isPending}
            onClick={removePreset}
          >
            削除
          </button>
          {detailQuery.isError && (
            <span className={errorTextClass}>{errorMessage(detailQuery.error)}</span>
          )}
        </div>

        <label className="block text-xs">
          <span className="font-semibold">プリセット名</span>
          <input
            className={`${textFieldClass} mt-1 block w-full`}
            maxLength={80}
            value={nameDraft}
            onChange={(event) => {
              setNameDraft(event.target.value);
              setNameTouched(true);
            }}
            placeholder="例: チャンネル標準のサムネイル"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={
              appearanceDraft === null ||
              trimmedName.length === 0 ||
              createPreset.isPending
            }
            onClick={saveNewPreset}
          >
            {createPreset.isPending ? "保存中…" : "現在の外観を新規保存"}
          </button>
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={
              selectedId === "" ||
              appearanceDraft === null ||
              trimmedName.length === 0 ||
              updatePreset.isPending
            }
            onClick={overwritePreset}
          >
            {updatePreset.isPending ? "上書き中…" : "選択中を上書き"}
          </button>
        </div>

        {appearanceDraft === null && (
          <p className={metaTextClass}>
            共通の見た目に上書きがないため、プリセットとして保存できません。
          </p>
        )}
        <p className={metaTextClass}>
          「読み込む」は現在の共通の見た目（下書き）へコピーします。「共通の見た目を保存」を押すまで適用されません。
        </p>
        <p className={metaTextClass}>
          プリセットは上書き・削除しても、適用済みの言語版を自動では変更しません。未指定の項目は適用先のテーマに従います。
        </p>
        {error !== null && <p className={errorTextClass}>{error}</p>}
      </div>
    </details>
  );
}
