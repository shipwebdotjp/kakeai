import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  LanguageEditionSummary,
  ScriptVersionSummary,
  WorkSummary,
} from "@kakeai/contracts";
import {
  useCloneWork,
  useCreateWork,
  useDeleteLanguageEdition,
  useDeleteScriptVersions,
  useDeleteWork,
  useRestoreScriptVersion,
  useScriptVersion,
  useScriptVersions,
  useWorks,
} from "../api/hooks";
import { Modal } from "../components/Modal";
import { SCENE_LABELS } from "../content/labels";
import { errorMessage } from "../lib/errorMessage";
import { workEditionRoute, workRoute } from "../lib/routes";
import {
  abbreviateAgentId,
  buildVersionOutline,
  isAgentAuthored,
  lineDisplayText,
} from "../lib/versionHistory";
import {
  badgeInfoClass,
  badgeNeutralClass,
  buttonDangerOutlineClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

interface EditionTarget {
  workId: string;
  editionId: string;
}

function resolveTarget(
  works: WorkSummary[] | undefined,
  target: EditionTarget | null,
): { work: WorkSummary; edition: LanguageEditionSummary } | null {
  if (target === null) {
    return null;
  }
  const work = works?.find((entry) => entry.id === target.workId);
  const edition = work?.languageEditions.find((entry) => entry.id === target.editionId);
  return work === undefined || edition === undefined ? null : { work, edition };
}

interface CloneModalProps {
  open: boolean;
  onClose: () => void;
  work: WorkSummary | null;
  edition: LanguageEditionSummary | null;
}

function CloneModal({ open, onClose, work, edition }: CloneModalProps) {
  const navigate = useNavigate();
  const cloneWork = useCloneWork();
  const [title, setTitle] = useState("");

  const resetMutation = cloneWork.reset;
  useEffect(() => {
    if (open && work !== null) {
      setTitle(`「${work.title}」のコピー`);
      resetMutation();
    }
  }, [open, work, resetMutation]);

  if (work === null || edition === null) {
    return null;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    cloneWork.mutate(
      { workId: work.id, title: trimmed, sourceEditionId: edition.id },
      {
        onSuccess: (newWork) => {
          onClose();
          const newEdition =
            newWork.languageEditions.find((entry) => entry.locale === edition.locale) ??
            newWork.languageEditions[0];
          navigate(
            newEdition === undefined
              ? workRoute(newWork.id)
              : workEditionRoute(newWork.id, newEdition.id),
          );
        },
      },
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="言語版の複製">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-sm">
          「{work.title}」の {edition.locale} 版（v
          {edition.currentScriptVersion.versionNumber}）の現在内容を引き継いだ新しい作品を作成します。
          複製先には {edition.locale} 版だけが作られます。
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
  edition: LanguageEditionSummary | null;
}

function CurrentVersionBadge() {
  return (
    <span className="rounded bg-brand-100 px-2 py-1 text-xs font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-300">
      現在版
    </span>
  );
}

function AuthorBadge({ version }: { version: Pick<ScriptVersionSummary, "author"> }) {
  return (
    <span className={isAgentAuthored(version.author) ? badgeInfoClass : badgeNeutralClass}>
      {isAgentAuthored(version.author) ? "エージェント作" : "利用者"}
    </span>
  );
}

function AgentIdText({ agentId, full }: { agentId: string; full?: boolean }) {
  return (
    <p className={`mt-1 break-all ${metaTextClass}`} title={agentId}>
      エージェントID: {full === true ? agentId : abbreviateAgentId(agentId)}
    </p>
  );
}

function OutlineStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

interface VersionInspectPanelProps {
  version: ScriptVersionSummary;
  isCurrent: boolean;
  onBack: () => void;
  onRestore: (version: ScriptVersionSummary) => void;
  restorePending: boolean;
  restoreError: unknown;
}

function VersionInspectPanel({
  version,
  isCurrent,
  onBack,
  onRestore,
  restorePending,
  restoreError,
}: VersionInspectPanelProps) {
  const detail = useScriptVersion(version.id);
  const outline = useMemo(
    () => (detail.data === undefined ? null : buildVersionOutline(detail.data.content)),
    [detail.data],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={buttonNeutralClass} onClick={onBack}>
          ← 履歴に戻る
        </button>
        {!isCurrent && (
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={restorePending}
            onClick={() => onRestore(version)}
          >
            {restorePending ? "復元中…" : "この版から復元"}
          </button>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">v{version.versionNumber}</h3>
          <AuthorBadge version={version} />
          {isCurrent && <CurrentVersionBadge />}
          <span className={metaTextClass}>
            {new Date(version.createdAt).toLocaleString("ja-JP")}
          </span>
        </div>
        {version.authorAgentId !== null && <AgentIdText agentId={version.authorAgentId} full />}
        {version.agentRequestId !== null && (
          <p className={`mt-1 break-all ${metaTextClass}`}>要求ID: {version.agentRequestId}</p>
        )}
        <p className={`mt-1 ${metaTextClass}`}>
          この画面は保存済みの内容を読み取り専用で表示しています。
          {!isCurrent && "「この版から復元」は既存の版を上書きせず、新しい版を作成します。"}
        </p>
      </div>

      {restoreError !== null && <p className={errorTextClass}>{errorMessage(restoreError)}</p>}

      {detail.isLoading && <p>内容を読み込み中…</p>}
      {detail.isError && <p className={errorTextClass}>{errorMessage(detail.error)}</p>}

      {outline !== null && (
        <>
          <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <OutlineStat label="シーン" value={outline.sceneCount} />
            <OutlineStat label="セリフ" value={outline.lineCount} />
            <OutlineStat label="音声テイク" value={outline.audioTakeCount} />
            <OutlineStat label="演出Cue" value={outline.visualCueCount + outline.audioCueCount} />
          </dl>

          <p className={metaTextClass}>
            テーマ: {outline.visualTheme.id} v{outline.visualTheme.version} ・ テンプレート:{" "}
            {outline.template.id}@{outline.template.version} ・ 言語: {outline.locale}
          </p>

          <ol className="m-0 list-none divide-y divide-border rounded-md border border-border p-0">
            {outline.scenes.map((scene) => (
              <li key={scene.id} className="p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                    {SCENE_LABELS[scene.kind]}
                  </span>
                  <span className="min-w-0 font-semibold break-words">{scene.label}</span>
                  <span className={metaTextClass}>セリフ {scene.lineCount}件</span>
                </div>
                {scene.lines.length === 0 ? (
                  <p className={`mt-1 ${metaTextClass}`}>セリフはありません。</p>
                ) : (
                  <ul className="m-0 mt-1 list-none space-y-1 p-0">
                    {scene.lines.map((line, index) => {
                      const text = lineDisplayText(line);
                      return (
                        <li key={line.id} className="flex gap-2 text-sm">
                          <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                            {index + 1}
                          </span>
                          <span className="min-w-0 break-words">{text}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function HistoryModal({ open, onClose, work, edition }: HistoryModalProps) {
  const editionId = edition?.id;
  const currentScriptVersionId = edition?.currentScriptVersion.id;

  const versionsQuery = useScriptVersions(editionId);
  const restoreMutation = useRestoreScriptVersion(work?.id, editionId);
  const deleteMutation = useDeleteScriptVersions(work?.id, editionId);
  const [inspecting, setInspecting] = useState<ScriptVersionSummary | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const resetRestore = restoreMutation.reset;
  const resetDelete = deleteMutation.reset;

  // A new work, edition, or reopened modal must not show another history's
  // version, selection, or a mutation error left over from a previous attempt.
  useEffect(() => {
    if (!open) {
      return;
    }
    setInspecting(null);
    setSelectedIds([]);
    resetRestore();
    resetDelete();
  }, [open, editionId, resetDelete, resetRestore]);

  useEffect(() => {
    if (versionsQuery.data === undefined) {
      return;
    }
    const available = new Set(
      versionsQuery.data
        .filter((version) => version.id !== currentScriptVersionId)
        .map((version) => version.id),
    );
    setSelectedIds((previous) => previous.filter((id) => available.has(id)));
  }, [currentScriptVersionId, versionsQuery.data]);

  if (work === null || edition === null) {
    return null;
  }

  const onRestore = (version: ScriptVersionSummary) => {
    if (
      window.confirm(
        `v${version.versionNumber} から復元しますか？\n※既存の版は上書きせず、新しい版を作成します。`,
      )
    ) {
      restoreMutation.mutate(version.id, { onSuccess: () => setInspecting(null) });
    }
  };

  const toggleSelected = (versionId: string) => {
    setSelectedIds((previous) =>
      previous.includes(versionId)
        ? previous.filter((id) => id !== versionId)
        : [...previous, versionId],
    );
  };

  const onBulkDelete = () => {
    if (selectedIds.length === 0) {
      return;
    }
    if (
      window.confirm(
        `選択した${selectedIds.length}件の版を削除しますか？\n※現在版は削除できません。削除した版に関連するJob・出力ファイルも削除され、元に戻せません。`,
      )
    ) {
      deleteMutation.mutate(selectedIds, { onSuccess: () => setSelectedIds([]) });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`「${work.title}」（${edition.locale}）の版履歴・復元`}
    >
      {inspecting !== null ? (
        <VersionInspectPanel
          version={inspecting}
          isCurrent={inspecting.id === currentScriptVersionId}
          onBack={() => setInspecting(null)}
          onRestore={onRestore}
          restorePending={restoreMutation.isPending}
          restoreError={restoreMutation.isError ? restoreMutation.error : null}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            各版には作成者（利用者／エージェント）を表示します。「内容を確認」で保存済みの内容を読み取り専用で確認でき、そこから新しい版として復元できます。現在版以外は選択してまとめて削除できます。
          </p>

          {restoreMutation.isError && (
            <p className={errorTextClass}>{errorMessage(restoreMutation.error)}</p>
          )}
          {deleteMutation.isError && (
            <p className={errorTextClass}>{errorMessage(deleteMutation.error)}</p>
          )}

          {versionsQuery.isLoading && <p>履歴を読み込み中…</p>}
          {versionsQuery.isError && (
            <p className={errorTextClass}>{errorMessage(versionsQuery.error)}</p>
          )}

          {versionsQuery.data !== undefined && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={metaTextClass}>選択中: {selectedIds.length}件</span>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  disabled={selectedIds.length === 0 || deleteMutation.isPending}
                  onClick={onBulkDelete}
                >
                  {deleteMutation.isPending ? "削除中…" : "選択した版を削除"}
                </button>
              </div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {versionsQuery.data.map((version) => {
                  const isCurrent = version.id === currentScriptVersionId;
                  return (
                    <li
                      key={version.id}
                      className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
                    >
                      <div className="flex min-w-0 gap-3">
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          aria-label={`v${version.versionNumber} を削除対象に選択`}
                          checked={selectedIds.includes(version.id)}
                          disabled={isCurrent || deleteMutation.isPending}
                          onChange={() => toggleSelected(version.id)}
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">v{version.versionNumber}</span>
                            <AuthorBadge version={version} />
                            {isCurrent && <CurrentVersionBadge />}
                            <span className={metaTextClass}>
                              {new Date(version.createdAt).toLocaleString("ja-JP")}
                            </span>
                          </div>
                          {version.authorAgentId !== null && (
                            <AgentIdText agentId={version.authorAgentId} />
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className={buttonNeutralClass}
                          aria-label={`v${version.versionNumber} の内容を確認`}
                          onClick={() => setInspecting(version)}
                        >
                          内容を確認
                        </button>
                        {!isCurrent && (
                          <button
                            type="button"
                            className={buttonNeutralClass}
                            aria-label={`v${version.versionNumber} から復元`}
                            disabled={restoreMutation.isPending}
                            onClick={() => onRestore(version)}
                          >
                            {restoreMutation.isPending ? "復元中…" : "復元"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

export function WorkListPage() {
  const works = useWorks();
  const createWork = useCreateWork();
  const deleteWork = useDeleteWork();
  const deleteEdition = useDeleteLanguageEdition();
  const [title, setTitle] = useState("");
  const [expandedWorkIds, setExpandedWorkIds] = useState<Set<string>>(() => new Set());
  const [cloneTarget, setCloneTarget] = useState<EditionTarget | null>(null);
  const [historyTarget, setHistoryTarget] = useState<EditionTarget | null>(null);

  const resolvedClone = resolveTarget(works.data, cloneTarget);
  const resolvedHistory = resolveTarget(works.data, historyTarget);

  const toggleExpanded = (workId: string) => {
    setExpandedWorkIds((previous) => {
      const next = new Set(previous);
      if (next.has(workId)) {
        next.delete(workId);
      } else {
        next.add(workId);
      }
      return next;
    });
  };

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
      {deleteEdition.isError && (
        <p className={errorTextClass}>{errorMessage(deleteEdition.error)}</p>
      )}

      {works.isLoading && <p>読み込み中…</p>}
      {works.isError && <p className={errorTextClass}>{errorMessage(works.error)}</p>}

      <ul className="list-none p-0">
        {works.data?.map((work) => {
          const isExpanded = expandedWorkIds.has(work.id);
          const firstEdition = work.languageEditions[0];
          return (
            <li key={work.id} className="border-b border-border py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={buttonNeutralClass}
                  aria-expanded={isExpanded}
                  aria-label={`${work.title} の言語版を${isExpanded ? "閉じる" : "開く"}`}
                  onClick={() => toggleExpanded(work.id)}
                >
                  {isExpanded ? "▾" : "▸"}
                </button>
                <Link
                  to={
                    firstEdition === undefined
                      ? workRoute(work.id)
                      : workEditionRoute(work.id, firstEdition.id)
                  }
                  className="min-w-0 flex-1 font-semibold text-inherit"
                >
                  {work.title}
                </Link>
                <span className={metaTextClass}>
                  最終更新 {new Date(work.updatedAt).toLocaleString("ja-JP")} ・ 言語版{" "}
                  {work.languageEditions.length}件
                </span>
                <button
                  type="button"
                  className={buttonDangerOutlineClass}
                  disabled={deleteWork.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        `「${work.title}」とすべての言語版・版履歴・出力ファイルを削除しますか？\nこの操作は元に戻せません。`,
                      )
                    ) {
                      deleteWork.mutate(work.id);
                    }
                  }}
                >
                  作品を削除
                </button>
              </div>

              {isExpanded && (
                <ul className="m-0 mt-2 list-none space-y-2 border-l-2 border-border pl-4">
                  {work.languageEditions.map((edition) => (
                    <li
                      key={edition.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-surface-muted/50 px-3 py-2"
                    >
                      <span className="font-medium">{edition.locale}</span>
                      <span className="text-sm font-semibold tabular-nums">
                        v{edition.currentScriptVersion.versionNumber}
                      </span>
                      <span className={metaTextClass}>
                        最終更新 {new Date(edition.updatedAt).toLocaleString("ja-JP")}
                      </span>

                      <div className="ml-auto flex flex-wrap items-center gap-2">
                        <Link
                          className={buttonNeutralClass}
                          to={workEditionRoute(work.id, edition.id)}
                        >
                          編集
                        </Link>
                        <button
                          type="button"
                          className={buttonNeutralClass}
                          onClick={() =>
                            setCloneTarget({ workId: work.id, editionId: edition.id })
                          }
                        >
                          複製
                        </button>
                        <button
                          type="button"
                          className={buttonNeutralClass}
                          onClick={() =>
                            setHistoryTarget({ workId: work.id, editionId: edition.id })
                          }
                        >
                          履歴・復元
                        </button>
                        <button
                          type="button"
                          className={buttonDangerOutlineClass}
                          disabled={
                            deleteEdition.isPending || work.languageEditions.length <= 1
                          }
                          title={
                            work.languageEditions.length <= 1
                              ? "作品には少なくとも1つの言語版が必要です。"
                              : undefined
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                `「${work.title}」の ${edition.locale} 版を削除しますか？\n※この言語版の台本履歴・レンダー履歴・出力ファイル・サムネイルも削除されます。作品全体は残ります。`,
                              )
                            ) {
                              deleteEdition.mutate({
                                workId: work.id,
                                editionId: edition.id,
                              });
                            }
                          }}
                        >
                          言語版を削除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {works.data?.length === 0 && <p>作品がありません。上のフォームから作成してください。</p>}

      <CloneModal
        open={resolvedClone !== null}
        onClose={() => setCloneTarget(null)}
        work={resolvedClone?.work ?? null}
        edition={resolvedClone?.edition ?? null}
      />

      <HistoryModal
        open={resolvedHistory !== null}
        onClose={() => setHistoryTarget(null)}
        work={resolvedHistory?.work ?? null}
        edition={resolvedHistory?.edition ?? null}
      />
    </section>
  );
}
