import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WorkSummary } from "@kakeai/contracts";
import {
  useCloneWork,
  useCreateWork,
  useDeleteWork,
  useRestoreScriptVersion,
  useScriptVersions,
  useWorks,
} from "../api/hooks";
import { Modal } from "../components/Modal";
import { errorMessage } from "../lib/errorMessage";
import { workRoute } from "../lib/routes";
import {
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

interface CloneModalProps {
  open: boolean;
  onClose: () => void;
  work: WorkSummary | null;
}

function CloneModal({ open, onClose, work }: CloneModalProps) {
  const navigate = useNavigate();
  const cloneWork = useCloneWork();
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (work !== null) {
      setTitle(`「${work.title}」のコピー`);
    }
  }, [work]);

  if (work === null) {
    return null;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    cloneWork.mutate(
      { workId: work.id, title: trimmed },
      {
        onSuccess: (newWork) => {
          onClose();
          navigate(workRoute(newWork.id));
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="作品の複製">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm">
          現在版の台本（素材・音声・BGM・演出設定）を引き継いだ新しい作品を作成します。
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium">作品名</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={`w-full ${textFieldClass}`}
            disabled={cloneWork.isPending}
            autoFocus
          />
        </div>
        {cloneWork.isError && <p className={errorTextClass}>{errorMessage(cloneWork.error)}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            className={buttonNeutralClass}
            onClick={onClose}
            disabled={cloneWork.isPending}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className={buttonPrimaryClass}
            disabled={cloneWork.isPending || title.trim().length === 0}
          >
            {cloneWork.isPending ? "複製中…" : "複製"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface HistoryModalProps {
  open: boolean;
  onClose: () => void;
  work: WorkSummary | null;
}

function HistoryModal({ open, onClose, work }: HistoryModalProps) {
  const edition = work?.languageEditions[0];
  const editionId = edition?.id;
  const currentScriptVersionId = edition?.currentScriptVersion.id;

  const versionsQuery = useScriptVersions(editionId);
  const restoreMutation = useRestoreScriptVersion(work?.id, editionId);

  if (work === null) {
    return null;
  }

  const onRestore = (versionNumber: number, versionId: string) => {
    if (
      window.confirm(
        `v${versionNumber} から復元しますか？\n※既存の版は上書きせず、新しい版を作成します。`,
      )
    ) {
      restoreMutation.mutate(versionId);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`「${work.title}」の版履歴・復元`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          過去の版を選択して「復元」を押すと、その内容で新しい版を作成して最新の現在版にします。
        </p>

        {restoreMutation.isError && (
          <p className={errorTextClass}>{errorMessage(restoreMutation.error)}</p>
        )}

        {versionsQuery.isLoading && <p>履歴を読み込み中…</p>}
        {versionsQuery.isError && (
          <p className={errorTextClass}>{errorMessage(versionsQuery.error)}</p>
        )}

        {versionsQuery.data !== undefined && (
          <ul className="divide-y divide-border rounded-md border border-border">
            {versionsQuery.data.map((version) => {
              const isCurrent = version.id === currentScriptVersionId;
              return (
                <li key={version.id} className="flex items-center justify-between p-3">
                  <div>
                    <span className="font-semibold">v{version.versionNumber}</span>
                    <span className={`ml-3 ${metaTextClass}`}>
                      {new Date(version.createdAt).toLocaleString("ja-JP")}
                    </span>
                  </div>
                  <div>
                    {isCurrent ? (
                      <span className="rounded bg-brand-100 px-2 py-1 text-xs font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-300">
                        現在版
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={buttonNeutralClass}
                        disabled={restoreMutation.isPending}
                        onClick={() => onRestore(version.versionNumber, version.id)}
                      >
                        {restoreMutation.isPending ? "復元中…" : "復元"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function WorkListPage() {
  const works = useWorks();
  const createWork = useCreateWork();
  const deleteWork = useDeleteWork();
  const [title, setTitle] = useState("");

  const [openMenuWorkId, setOpenMenuWorkId] = useState<string | null>(null);
  const [cloneModalWork, setCloneModalWork] = useState<WorkSummary | null>(null);
  const [historyModalWork, setHistoryModalWork] = useState<WorkSummary | null>(null);

  useEffect(() => {
    const handleDocumentClick = () => setOpenMenuWorkId(null);
    document.addEventListener("click", handleDocumentClick);
    return () => document.removeEventListener("click", handleDocumentClick);
  }, []);

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    createWork.mutate(trimmed, { onSuccess: () => setTitle("") });
  };

  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold">作品一覧</h1>

      <form onSubmit={onCreate} className="my-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="新しい作品名"
          className={`min-w-[200px] flex-1 ${textFieldClass}`}
        />
        <button type="submit" className={buttonPrimaryClass} disabled={createWork.isPending}>
          作成
        </button>
      </form>
      {createWork.isError && <p className={errorTextClass}>{errorMessage(createWork.error)}</p>}
      {deleteWork.isError && <p className={errorTextClass}>{errorMessage(deleteWork.error)}</p>}

      {works.isLoading && <p>読み込み中…</p>}
      {works.isError && <p className={errorTextClass}>{errorMessage(works.error)}</p>}

      <ul className="list-none p-0">
        {works.data?.map((work) => {
          const edition = work.languageEditions[0];
          const isMenuOpen = openMenuWorkId === work.id;
          return (
            <li
              key={work.id}
              className="flex items-center gap-3 border-b border-border py-2.5"
            >
              <Link to={workRoute(work.id)} className="flex-1 font-semibold text-inherit">
                {work.title}
              </Link>
              <span className={metaTextClass}>
                v{edition?.currentScriptVersion.versionNumber ?? "-"} ・{" "}
                {new Date(work.updatedAt).toLocaleString("ja-JP")}
              </span>

              <div className="relative">
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuWorkId(isMenuOpen ? null : work.id);
                  }}
                >
                  操作 ▾
                </button>

                {isMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 min-w-[140px] rounded-md border border-border bg-surface py-1 shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
                      onClick={() => {
                        setOpenMenuWorkId(null);
                        setCloneModalWork(work);
                      }}
                    >
                      複製
                    </button>
                    <button
                      type="button"
                      className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
                      onClick={() => {
                        setOpenMenuWorkId(null);
                        setHistoryModalWork(work);
                      }}
                    >
                      履歴・復元
                    </button>
                    <button
                      type="button"
                      className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-surface-muted dark:text-red-400"
                      disabled={deleteWork.isPending}
                      onClick={() => {
                        setOpenMenuWorkId(null);
                        if (window.confirm(`「${work.title}」を削除しますか？`)) {
                          deleteWork.mutate(work.id);
                        }
                      }}
                    >
                      削除
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {works.data?.length === 0 && <p>作品がありません。上のフォームから作成してください。</p>}

      <CloneModal
        open={cloneModalWork !== null}
        onClose={() => setCloneModalWork(null)}
        work={cloneModalWork}
      />

      {historyModalWork !== null && (
        <HistoryModal
          open={historyModalWork !== null}
          onClose={() => setHistoryModalWork(null)}
          work={
            works.data?.find((w) => w.id === historyModalWork.id) ?? historyModalWork
          }
        />
      )}
    </section>
  );
}
