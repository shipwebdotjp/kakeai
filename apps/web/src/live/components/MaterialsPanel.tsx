import { useEffect, useState } from "react";
import type {
  Asset,
  LiveMaterialSummary,
  LiveProgramDocument,
} from "@kakeai/contracts";
import { addCutIn, cutInUsageCount, removeCutIn } from "../model/cutins";
import { createLiveLocalId } from "../model/ids";
import { errorMessage } from "../../lib/errorMessage";
import { formatDateTime } from "../duration";
import {
  buttonNeutralClass,
  errorTextClass,
  iconButtonClass,
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
  warningTextClass,
} from "../../ui";

interface MaterialsPanelProps {
  document: LiveProgramDocument;
  materials: readonly LiveMaterialSummary[];
  videoAssets: readonly Asset[];
  canImport: boolean;
  importPending: boolean;
  importError: unknown;
  onRequestImport: () => void;
  onChangeDocument: (updater: (document: LiveProgramDocument) => LiveProgramDocument) => void;
}

export function MaterialsPanel({
  document,
  materials,
  videoAssets,
  canImport,
  importPending,
  importError,
  onRequestImport,
  onChangeDocument,
}: MaterialsPanelProps) {
  const [assetId, setAssetId] = useState(videoAssets[0]?.id ?? "");

  useEffect(() => {
    if (
      (assetId === "" || !videoAssets.some((asset) => asset.id === assetId)) &&
      videoAssets[0] !== undefined
    ) {
      setAssetId(videoAssets[0].id);
    }
  }, [assetId, videoAssets]);

  const addSelectedCutIn = () => {
    if (assetId === "") {
      return;
    }
    onChangeDocument((current) =>
      addCutIn(current, { id: createLiveLocalId("cut"), assetId }),
    );
  };

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={sectionTitleClass}>Live Material</h2>
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={!canImport || importPending}
            onClick={onRequestImport}
          >
            {importPending ? "取り込み中…" : "WorkのSceneから取り込む"}
          </button>
        </div>
        <p className={metaTextClass}>
          取り込み時のScene内容と画像Assetをこのプログラム専用に固定します。元のWorkを後で編集しても変わりません。
        </p>
        {!canImport && (
          <p className={warningTextClass}>
            未保存の変更があります。素材を取り込む前に下書きを保存してください。
          </p>
        )}
        {importError !== undefined && importError !== null && (
          <p className={errorTextClass}>{errorMessage(importError)}</p>
        )}
        {materials.length === 0 ? (
          <p className={metaTextClass}>取り込み済みの素材はありません。</p>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-1 p-0">
            {materials.map((material) => (
              <li
                key={material.id}
                className="rounded border border-border bg-surface-muted px-2 py-1 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-medium">{material.name}</span>
                  <span className="text-xs text-muted-foreground">{material.id}</span>
                </div>
                <p className="m-0 text-xs text-muted-foreground">
                  取り込み: {formatDateTime(material.provenance.importedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-3">
        <h2 className={sectionTitleClass}>CutIn</h2>
        <p className={metaTextClass}>
          CutIn は ready な動画 Asset を参照します。セグメントの CutIn から選択してください。
        </p>
        {document.cutIns.length === 0 ? (
          <p className={metaTextClass}>CutIn がありません。</p>
        ) : (
          <ul className="m-0 mt-2 list-none space-y-1 p-0">
            {document.cutIns.map((cutIn) => {
              const usage = cutInUsageCount(document, cutIn.id);
              return (
                <li
                  key={cutIn.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface-muted px-2 py-1 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {cutIn.id}
                    <span className="ml-2 text-xs text-muted-foreground">
                      Asset: {cutIn.assetId}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">使用 {usage}件</span>
                  <button
                    type="button"
                    className={iconButtonClass}
                    aria-label={`${cutIn.id} を削除`}
                    disabled={usage > 0}
                    title={usage > 0 ? "使用中のCutInは削除できません" : undefined}
                    onClick={() =>
                      onChangeDocument((current) => removeCutIn(current, cutIn.id))
                    }
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            動画 Asset
            <select
              className={`mt-1 ${textFieldClass}`}
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
            >
              {videoAssets.length === 0 && <option value="">動画がありません</option>}
              {videoAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.originalFilename}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={assetId === ""}
            onClick={addSelectedCutIn}
          >
            CutIn を追加
          </button>
        </div>
      </section>
    </div>
  );
}
