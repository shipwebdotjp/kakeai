import { useEffect, useState } from "react";
import type { Asset, LiveProgramDocument } from "@kakeai/contracts";
import { Modal } from "../../components/Modal";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../../ui";

interface AddCutInDialogProps {
  open: boolean;
  document: LiveProgramDocument;
  videoAssets: readonly Asset[];
  error?: string | null;
  onClose: () => void;
  onAdd: (input: { label: string; cutInId?: string; assetId?: string }) => void;
}

export function AddCutInDialog({
  open,
  document,
  videoAssets,
  error,
  onClose,
  onAdd,
}: AddCutInDialogProps) {
  const [mode, setMode] = useState<"existing" | "new">(
    document.cutIns.length > 0 ? "existing" : "new",
  );
  const [cutInId, setCutInId] = useState(document.cutIns[0]?.id ?? "");
  const [assetId, setAssetId] = useState(videoAssets[0]?.id ?? "");
  const [label, setLabel] = useState("CutIn");

  useEffect(() => {
    if (!open) {
      return;
    }
    setMode(document.cutIns.length > 0 ? "existing" : "new");
    setCutInId(document.cutIns[0]?.id ?? "");
    setAssetId(videoAssets[0]?.id ?? "");
    setLabel("CutIn");
    // Reset only when the dialog opens; option arrays are refreshed by the
    // default-asset effect below without discarding user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && assetId === "" && videoAssets[0] !== undefined) {
      setAssetId(videoAssets[0].id);
    }
  }, [assetId, open, videoAssets]);

  const canSubmit =
    mode === "existing" ? cutInId !== "" : assetId !== "" && videoAssets.length > 0;

  return (
    <Modal open={open} onClose={onClose} title="CutIn セグメントを追加">
      <div className="flex flex-col gap-4">
        <p className={metaTextClass}>
          CutIn は opening と closing の間にだけ置けます。書き出し時は ready な動画 Asset が必要です。
        </p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "existing"}
            disabled={document.cutIns.length === 0}
            onChange={() => setMode("existing")}
          />
          既存のCutInを使う
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />
          動画Assetから新しいCutInを作る
        </label>

        {mode === "existing" ? (
          <label className="block text-sm">
            CutIn
            <select
              className={`mt-1 w-full ${textFieldClass}`}
              value={cutInId}
              onChange={(event) => setCutInId(event.target.value)}
            >
              {document.cutIns.length === 0 && <option value="">CutInがありません</option>}
              {document.cutIns.map((cutIn) => (
                <option key={cutIn.id} value={cutIn.id}>
                  {cutIn.id}（{cutIn.assetId}）
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block text-sm">
            動画 Asset
            <select
              className={`mt-1 w-full ${textFieldClass}`}
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
        )}

        <label className="block text-sm">
          セグメントのラベル
          <input
            className={`mt-1 w-full ${textFieldClass}`}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>

        {error !== undefined && error !== null && (
          <p className={errorTextClass}>{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={buttonNeutralClass} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={!canSubmit || label.trim() === ""}
            onClick={() =>
              onAdd({
                label: label.trim(),
                ...(mode === "existing" ? { cutInId } : { assetId }),
              })
            }
          >
            追加
          </button>
        </div>
      </div>
    </Modal>
  );
}
