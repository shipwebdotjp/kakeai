import { Link } from "react-router-dom";
import { useLaunchLiveRun, useLiveRuns, useStopLiveRun } from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { liveRunNewRoute, liveRunsRoute } from "../../lib/routes";
import { buttonPrimaryClass, errorTextClass, metaTextClass } from "../../ui";
import { LiveRunStatus } from "./LiveRunStatus";

export function LiveRunsPage() {
  const runsQuery = useLiveRuns();
  const launch = useLaunchLiveRun();
  const stop = useStopLiveRun();
  const runs = runsQuery.data?.items ?? [];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ライブ実行</h1>
          <p className={metaTextClass}>
            確定したプログラム版からパッケージを書き出し、Run として起動します。
            番組の開始はコンソールで行います。
          </p>
        </div>
        <Link to={liveRunNewRoute()} className={buttonPrimaryClass}>
          新しい Run
        </Link>
      </div>

      {runsQuery.isError && (
        <p className={errorTextClass}>{errorMessage(runsQuery.error)}</p>
      )}
      {launch.isError && <p className={errorTextClass}>{errorMessage(launch.error)}</p>}
      {stop.isError && <p className={errorTextClass}>{errorMessage(stop.error)}</p>}
      {runsQuery.isLoading && <p>Run を読み込み中…</p>}
      {runsQuery.isSuccess && runs.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="m-0 text-base font-semibold">まだ Run がありません</h2>
          <p className={metaTextClass}>
            ライブプログラムの版を確定し、パッケージを書き出してから Run を作成してください。
          </p>
          <Link to={liveRunNewRoute()} className={`${buttonPrimaryClass} mt-2`}>
            新しい Run
          </Link>
        </div>
      )}

      <div className="space-y-3">
        {runs.map((run) => (
          <LiveRunStatus
            key={run.id}
            run={run}
            launchPending={launch.isPending && launch.variables === run.id}
            stopPending={stop.isPending && stop.variables === run.id}
            onLaunch={() => launch.mutate(run.id)}
            onStop={() => stop.mutate(run.id)}
          />
        ))}
      </div>

      {runs.length > 0 && (
        <p className={metaTextClass}>
          Run 一覧は {liveRunsRoute()} で更新できます。
        </p>
      )}
    </section>
  );
}
