import { memo, useEffect, useState } from "react";
import type { Job } from "@kakeai/contracts";
import { scriptSubtitlesUrl } from "../api/client";
import { useCancelJob, useCreateRenderJob, useWorkJobs } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import {
  badgeDangerClass,
  badgeNeutralClass,
  badgeSuccessClass,
  badgeWarningClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
} from "../ui";
import { Collapsible } from "./Collapsible";

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

export const RenderSection = memo(function RenderSection({
  workId,
  scriptVersionId,
}: {
  workId: string;
  scriptVersionId: string;
}) {
  const jobs = useWorkJobs(workId);
  const createRenderJob = useCreateRenderJob(scriptVersionId);
  const cancelJob = useCancelJob(workId);
  const active = (jobs.data ?? []).some(
    (job) => job.status === "queued" || job.status === "running",
  );
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (active) {
      setHistoryOpen(true);
    }
  }, [active]);

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
              {job.status === "succeeded" && job.artifacts.length === 0 && (
                <p className={metaTextClass}>出力は削除済みです。</p>
              )}
              {job.status === "succeeded" &&
                job.artifacts.map((artifact) => (
                  <video
                    key={artifact.id}
                    src={artifact.contentUrl}
                    controls
                    preload="metadata"
                    className="mt-2 aspect-video w-full max-w-2xl rounded border border-border bg-black"
                  />
                ))}
            </li>
          ))}
        </ul>
        {(jobs.data ?? []).length === 0 && !jobs.isLoading && (
          <p className={metaTextClass}>レンダー履歴がありません。</p>
        )}
      </Collapsible>
      {cancelJob.isError && <p className={errorTextClass}>{errorMessage(cancelJob.error)}</p>}
    </section>
  );
});
