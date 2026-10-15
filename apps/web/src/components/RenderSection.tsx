import { memo, useEffect } from "react";
import type { Job } from "@kakeai/contracts";
import { scriptSubtitlesUrl } from "../api/client";
import {
  useCancelJob,
  useCreateRenderJob,
  useDeleteArtifact,
  useWorkJobs,
} from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import {
  badgeDangerClass,
  badgeNeutralClass,
  badgeSuccessClass,
  badgeWarningClass,
  buttonDangerClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
} from "../ui";
import { Collapsible, useStoredCollapsible } from "./Collapsible";

const STATUS_BADGE_CLASS: Record<Job["status"], string> = {
  queued: badgeWarningClass,
  running: badgeWarningClass,
  succeeded: badgeSuccessClass,
  failed: badgeDangerClass,
  cancelled: badgeNeutralClass,
};

const STATUS_LABEL: Record<Job["status"], string> = {
  queued: "待機中",
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "キャンセル済み",
};

function JobError({ job }: { job: Job }) {
  if (job.error === null || job.error.message.trim() === "") {
    return null;
  }
  return <p className={errorTextClass}>{job.error.message}</p>;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  }
  if (bytes >= 1024 ** 2) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="mt-2 h-1.5 w-full max-w-2xl overflow-hidden rounded-full bg-surface-muted"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-brand-600 transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function ArtifactMetadata({ artifact }: { artifact: Job["artifacts"][number] }) {
  const entries: { label: string; value: string }[] = [];
  if (artifact.widthPx !== null && artifact.heightPx !== null) {
    entries.push({ label: "解像度", value: `${artifact.widthPx}×${artifact.heightPx}` });
  }
  entries.push({ label: "サイズ", value: formatBytes(artifact.byteSize) });
  if (artifact.durationMs !== null) {
    entries.push({ label: "長さ", value: formatDuration(artifact.durationMs) });
  }
  if (artifact.fps !== null) {
    entries.push({ label: "フレームレート", value: `${artifact.fps} fps` });
  }
  entries.push({ label: "形式", value: artifact.format });
  if (artifact.videoCodec !== null) {
    entries.push({ label: "映像コーデック", value: artifact.videoCodec });
  }
  if (artifact.audioCodec !== null) {
    entries.push({ label: "音声コーデック", value: artifact.audioCodec });
  }
  return (
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
      {entries.map((entry) => (
        <div key={entry.label} className="flex gap-1">
          <dt>{entry.label}</dt>
          <dd className="font-medium text-foreground">{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const RenderSection = memo(function RenderSection({
  workId,
  scriptVersionId,
  downloadName,
}: {
  workId: string;
  scriptVersionId: string;
  downloadName: string;
}) {
  const jobs = useWorkJobs(workId);
  const createRenderJob = useCreateRenderJob(scriptVersionId);
  const cancelJob = useCancelJob(workId);
  const deleteArtifact = useDeleteArtifact(workId);
  const active = (jobs.data ?? []).some(
    (job) => job.status === "queued" || job.status === "running",
  );
  const [historyOpen, setHistoryOpen] = useStoredCollapsible("render-history", false);

  useEffect(() => {
    if (active) {
      setHistoryOpen(true);
    }
  }, [active, setHistoryOpen]);

  return (
    <section className="mt-8">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">レンダー</h2>
        <button
          type="button"
          className={buttonPrimaryClass}
          disabled={createRenderJob.isPending || active}
          onClick={() => createRenderJob.mutate()}
        >
          MP4を出力
        </button>
        <a href={scriptSubtitlesUrl(scriptVersionId)} download className={buttonNeutralClass}>
          字幕をダウンロード
        </a>
      </div>
      {createRenderJob.isError && (
        <p className={errorTextClass}>{errorMessage(createRenderJob.error)}</p>
      )}

      {jobs.isLoading && <p className={metaTextClass}>履歴を読み込み中…</p>}
      {jobs.isError && <p className={errorTextClass}>{errorMessage(jobs.error)}</p>}

      <Collapsible
        title="履歴"
        summary={active ? "実行中" : `${(jobs.data ?? []).length}件`}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <ul className="m-0 list-none p-0">
          {(jobs.data ?? []).map((job) => (
            <li key={job.id} className="border-b border-border py-2.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className={STATUS_BADGE_CLASS[job.status]}>{STATUS_LABEL[job.status]}</span>
                <span className={metaTextClass}>
                  {job.scriptVersionId === null
                    ? ""
                    : `版 ${job.scriptVersionId.slice(0, 8)} ・ `}
                  {new Date(job.createdAt).toLocaleString("ja-JP")}
                  {job.status === "running" ? ` ・ ${job.progressPercent}%` : ""}
                </span>
                {job.status === "queued" && (
                  <button
                    type="button"
                    className={buttonNeutralClass}
                    disabled={cancelJob.isPending}
                    onClick={() => cancelJob.mutate(job.id)}
                  >
                    キャンセル
                  </button>
                )}
              </div>
              <JobError job={job} />
              {job.status === "running" && <ProgressBar percent={job.progressPercent} />}
              {job.status === "succeeded" && job.artifacts.length === 0 && (
                <p className={metaTextClass}>出力は削除済みです。</p>
              )}
              {job.status === "succeeded" &&
                job.artifacts.map((artifact) => (
                  <div key={artifact.id} className="mt-2 max-w-2xl">
                    <video
                      src={artifact.contentUrl}
                      controls
                      preload="metadata"
                      className="aspect-video w-full rounded border border-border bg-black"
                    />
                    <ArtifactMetadata artifact={artifact} />
                    <div className="mt-2 flex items-center gap-2">
                      <a
                        href={artifact.contentUrl}
                        download={downloadName}
                        className={buttonNeutralClass}
                      >
                        MP4をダウンロード
                      </a>
                      <button
                        type="button"
                        className={buttonDangerClass}
                        disabled={deleteArtifact.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              "この出力を削除しますか？削除すると元に戻せません。",
                            )
                          ) {
                            deleteArtifact.mutate(artifact.id);
                          }
                        }}
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
            </li>
          ))}
        </ul>
        {(jobs.data ?? []).length === 0 && !jobs.isLoading && (
          <p className={metaTextClass}>レンダー履歴がありません。</p>
        )}
      </Collapsible>
      {cancelJob.isError && <p className={errorTextClass}>{errorMessage(cancelJob.error)}</p>}
      {deleteArtifact.isError && (
        <p className={errorTextClass}>{errorMessage(deleteArtifact.error)}</p>
      )}
    </section>
  );
});
