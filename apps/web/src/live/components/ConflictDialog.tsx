import { Modal } from "../../components/Modal";
import { buttonNeutralClass, buttonPrimaryClass, metaTextClass } from "../../ui";
import type { LiveProgramRevisionConflict } from "../model/version-actions";

interface ConflictDialogProps {
  conflict: LiveProgramRevisionConflict | null;
  onReload: () => void;
  onClose: () => void;
}

export function ConflictDialog({ conflict, onReload, onClose }: ConflictDialogProps) {
  return (
    <Modal
      open={conflict !== null}
      onClose={onClose}
      title="他の変更が保存されています"
    >
      {conflict !== null && (
        <div className="flex flex-col gap-4">
          <p>
            このプログラムは別の画面または操作で更新されました。編集中の内容はまだ保存されていません。
          </p>
          <p className={metaTextClass}>
            サーバーの現在リビジョン: {conflict.currentRevision}
          </p>
          <p className="text-sm text-amber-700 dark:text-amber-300">
            最新の下書きを読み込むと、この画面の未保存の編集は失われます。必要な内容は先にコピーしてください。
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonNeutralClass} onClick={onClose}>
              閉じる
            </button>
            <button type="button" className={buttonPrimaryClass} onClick={onReload}>
              最新の下書きを読み込む
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
