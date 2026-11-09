import type { LiveRun, LiveRunStatus } from "@kakeai/contracts";
import { formatDateTime } from "../duration";
import {
  badgeDangerClass,
  badgeInfoClass,
  badgeNeutralClass,
  badgeSuccessClass,
  badgeWarningClass,
  buttonDangerOutlineClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
} from "../../ui";

export function liveRunStatusLabel(status: LiveRunStatus): string {
  switch (status) {
    case "preparing":
      return "準備済み（未起動）";
    case "launching":
      return "アプリ起動中";
    case "running":
      return "アプリ実行中";
    case "stopped":
      return "停止";
    case "failed":
      return "失敗";
    case "ended":
      return "番組終了";
  }
}

function statusBadgeClass(status: LiveRunStatus): string {
  switch (status) {
    case "preparing":
      return badgeNeutralClass;
    case "launching":
      return badgeWarningClass;
    case "running":
      return badgeSuccessClass;
    case "ended":
      return badgeInfoClass;
    case "stopped":
      return badgeNeutralClass;
    case "failed":
      return badgeDangerClass;
  }
}

export interface LiveRunStatusProps {
  run: LiveRun;
  launchPending?: boolean;
  stopPending?: boolean;
  onLaunch?: () => void;
  onStop?: () => void;
}

/**
 * Shows one Run. The console is where the operator starts the show; the app
 * being "running" only means the loopback server is reachable.
 */
export function LiveRunStatus({
  run,
  launchPending = false,
  stopPending = false,
  onLaunch,
  onStop,
}: LiveRunStatusProps) {
  const sourceLabel =
    run.source.kind === "youtube"
      ? `YouTube${run.source.videoUrl === null ? "" : `: ${run.source.videoUrl}`}`
      : `fixture: ${run.source.fixtureFile}`;
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={statusBadgeClass(run.status)}>
          {liveRunStatusLabel(run.status)}
        </span>
        <span className="text-sm font-semibold">{run.id}</span>
        <span className={metaTextClass}>{formatDateTime(run.createdAt)}</span>
      </div>

      <dl className="m-0 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className={metaTextClass}>プログラム版</dt>
          <dd className="m-0 break-all font-mono text-xs">{run.programVersionId}</dd>
        </div>
        <div>
          <dt className={metaTextClass}>package build</dt>
          <dd className="m-0 break-all font-mono text-xs">
            {run.packageBuild.packageId}
          </dd>
        </div>
        <div>
          <dt className={metaTextClass}>パッケージ</dt>
          <dd className="m-0 break-all font-mono text-xs">
            {run.packageBuild.packagePath}
          </dd>
        </div>
        <div>
          <dt className={metaTextClass}>コメントソース</dt>
          <dd className="m-0 break-all text-xs">{sourceLabel}</dd>
        </div>
        <div>
          <dt className={metaTextClass}>開始予定</dt>
          <dd className="m-0">{run.startAt === null ? "未設定" : formatDateTime(run.startAt)}</dd>
        </div>
        <div>
          <dt className={metaTextClass}>ポート / PID</dt>
          <dd className="m-0 tabular-nums">
            {run.requestedPort} / {run.control.pid ?? "—"}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className={metaTextClass}>Run ログ</dt>
          <dd className="m-0 break-all font-mono text-xs">{run.logDir}</dd>
        </div>
        <div>
          <dt className={metaTextClass}>アプリ状態</dt>
          <dd className="m-0">
            {run.state.ready ? "control 応答あり" : "未接続"}
            {" / "}
            番組:{" "}
            {run.state.showEnded
              ? "終了"
              : run.state.showStarted
                ? `進行中 (${run.state.phase ?? "—"})`
                : "未開始"}
          </dd>
        </div>
        <div>
          <dt className={metaTextClass}>起動 / 終了</dt>
          <dd className="m-0">
            {run.launchedAt === null ? "未起動" : formatDateTime(run.launchedAt)}
            {" / "}
            {run.endedAt === null ? "—" : formatDateTime(run.endedAt)}
          </dd>
        </div>
      </dl>

      {run.failure !== null && (
        <p className={errorTextClass}>
          {run.failure.code}: {run.failure.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {run.status === "preparing" && onLaunch !== undefined && (
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={launchPending}
            onClick={onLaunch}
          >
            {launchPending ? "起動中…" : "アプリ起動"}
          </button>
        )}
        {run.consoleUrl !== null && (
          <a
            className={buttonPrimaryClass}
            href={run.consoleUrl}
            target="_blank"
            rel="noreferrer"
          >
            コンソールを開く（番組開始はここ）
          </a>
        )}
        {run.stageUrl !== null && (
          <a
            className={buttonNeutralClass}
            href={run.stageUrl}
            target="_blank"
            rel="noreferrer"
          >
            OBS ステージを開く
          </a>
        )}
        {(run.status === "launching" || run.status === "running") &&
          onStop !== undefined && (
            <button
              type="button"
              className={buttonDangerOutlineClass}
              disabled={stopPending}
              onClick={onStop}
            >
              {stopPending ? "停止中…" : "停止"}
            </button>
          )}
      </div>
      {run.stageUrl !== null && (
        <p className={metaTextClass}>
          OBS のブラウザソース URL: <code className="break-all">{run.stageUrl}</code>
        </p>
      )}
      <p className={metaTextClass}>
        「アプリ起動」はローカルサーバーを立ち上げるだけです。番組開始・終了はコンソールで操作します。
      </p>
    </section>
  );
}
