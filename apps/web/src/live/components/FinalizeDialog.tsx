import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../../components/Modal";
import { errorMessage } from "../../lib/errorMessage";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  warningTextClass,
} from "../../ui";
import type { LiveProgramValidationIssue } from "../model/validation";
import { parseLiveProgramServerIssues } from "../model/version-actions";
import { ValidationIssues } from "./ValidationIssues";

interface FinalizeDialogProps {
  open: boolean;
  dirty: boolean;
  blockedByDraftIssues: boolean;
  versionIssues: readonly LiveProgramValidationIssue[];
  isPending: boolean;
  error: unknown;
  onClose: () => void;
  onSubmit: (note: string) => void;
}

export function FinalizeDialog({
  open,
  dirty,
  blockedByDraftIssues,
  versionIssues,
  isPending,
  error,
  onClose,
  onSubmit,
}: FinalizeDialogProps) {
  const [note, setNote] = useState("");
  const versionErrors = versionIssues.filter(
    (issue) => issue.severity === "error",
  );

  useEffect(() => {
    if (open) {
      setNote("");
    }
  }, [open]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(note);
  };

  return (
    <Modal open={open} onClose={onClose} title="版を確定">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className={metaTextClass}>
          現在の下書きを不変の版として保存します。保存済みの下書きだけが対象です。
        </p>
        {dirty && (
          <p className={warningTextClass}>
            未保存の変更があります。先に「下書きを保存」を実行してください。
          </p>
        )}
        {blockedByDraftIssues && (
          <p className={errorTextClass}>
            入力内容に契約上のエラーがあります。保存できる状態に修正してください。
          </p>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium" htmlFor="finalize-note">
            版のメモ（任意）
          </label>
          <textarea
            id="finalize-note"
            className="min-h-20 w-full rounded border border-border bg-surface px-2 py-1 text-sm"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
            disabled={isPending}
            placeholder="例: 初回収録版"
          />
        </div>

        <section>
          <h3 className="mb-2 text-sm font-semibold">版確定の検証</h3>
          <ValidationIssues
            issues={versionIssues}
            emptyMessage="スパインと参照の検証に問題はありません。"
          />
        </section>

        {error !== undefined && error !== null && (
          <div className="space-y-2">
            <p className={errorTextClass}>{errorMessage(error)}</p>
            <ValidationIssues issues={parseLiveProgramServerIssues(error)} />
          </div>
        )}

        {dirty && <p className={metaTextClass}>サーバー上の下書きを確定するため、未保存の変更は含まれません。</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className={buttonNeutralClass} onClick={onClose}>
            キャンセル
          </button>
          <button
            type="submit"
            className={buttonPrimaryClass}
            disabled={
              isPending ||
              dirty ||
              blockedByDraftIssues ||
              versionErrors.length > 0
            }
          >
            {isPending ? "確定中…" : "版を確定"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
