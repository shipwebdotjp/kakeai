import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type {
  LiveFixtureComment,
  LivePackageBuild,
  LiveRun,
  LiveRunSourceInput,
} from "@kakeai/contracts";
import {
  useCreateLiveExportJob,
  useCreateLiveRun,
  useJob,
  useLaunchLiveRun,
  useLivePrograms,
  useLiveProgramVersions,
  useLiveRun,
} from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { liveProgramRoute, liveRunNewRoute, liveRunsRoute } from "../../lib/routes";
import { parseLiveFixtureCommentsJson } from "../../live/model/fixture-file";
import { LiveRunStatus } from "../../live/runs/LiveRunStatus";
import {
  badgeSuccessClass,
  buttonPrimaryClass,
  errorTextClass,
  formLabelBlockClass,
  metaTextClass,
  sectionTitleClass,
  textFieldClass,
  warningTextClass,
} from "../../ui";

const DEFAULT_PORT = 3010;

export function LiveRunNewPage() {
  const [params] = useSearchParams();
  const exportOnly = params.get("mode") === "export";
  const programsQuery = useLivePrograms();
  const [programId, setProgramId] = useState(params.get("programId") ?? "");
  const versionsQuery = useLiveProgramVersions(programId.length > 0 ? programId : undefined);
  const [versionId, setVersionId] = useState(params.get("programVersionId") ?? "");

  const [outDir, setOutDir] = useState("");
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const exportJobQuery = useJob(exportJobId ?? undefined);
  const exportMutation = useCreateLiveExportJob();
  const [packageBuild, setPackageBuild] = useState<LivePackageBuild | null>(null);

  const [sourceKind, setSourceKind] = useState<"youtube" | "fixture">("youtube");
  const [videoUrl, setVideoUrl] = useState("");
  const [liveChatId, setLiveChatId] = useState("");
  const [fixturePath, setFixturePath] = useState("");
  const [fixtureComments, setFixtureComments] = useState<LiveFixtureComment[] | null>(null);
  const [fixtureFileName, setFixtureFileName] = useState("");
  const [startAt, setStartAt] = useState("");
  const [port, setPort] = useState(String(DEFAULT_PORT));
  const [localError, setLocalError] = useState<string | null>(null);

  const createMutation = useCreateLiveRun();
  const launchMutation = useLaunchLiveRun();
  const [createdRun, setCreatedRun] = useState<LiveRun | null>(null);
  const createdRunQuery = useLiveRun(createdRun?.id);
  const exportRequestRef = useRef(0);

  const versions = versionsQuery.data ?? [];
  useEffect(() => {
    if (versions.length === 0) {
      return;
    }
    if (!versions.some((version) => version.id === versionId)) {
      setVersionId(versions[0]!.id);
      resetPackageBuild();
    }
  }, [versionId, versions]);

  const exportResult = exportJobQuery.data?.liveExportResult ?? null;
  useEffect(() => {
    if (
      exportResult !== null &&
      exportResult.packageId !== null &&
      exportResult.manifestSha256 !== null &&
      exportResult.packagePath !== null
    ) {
      setPackageBuild({
        packageId: exportResult.packageId,
        manifestSha256: exportResult.manifestSha256,
        packagePath: exportResult.packagePath,
      });
    }
  }, [
    exportResult?.packageId,
    exportResult?.manifestSha256,
    exportResult?.packagePath,
    exportResult,
  ]);

  function resetPackageBuild(): void {
    // Any input change invalidates an in-flight export: its result belongs to
    // the previous outDir/version and must not be reused.
    exportRequestRef.current += 1;
    setPackageBuild(null);
    setExportJobId(null);
    setCreatedRun(null);
  }

  const searchKey = params.toString();
  useEffect(() => {
    // Export-only and run-creation reuse this route. When the query changes,
    // drop the previous creation/export result so the form becomes usable.
    exportRequestRef.current += 1;
    setCreatedRun(null);
    setPackageBuild(null);
    setExportJobId(null);
  }, [searchKey]);

  function resetRunCreation(): void {
    resetPackageBuild();
    setLocalError(null);
    createMutation.reset();
    launchMutation.reset();
  }

  function startExport(): void {
    setLocalError(null);
    if (versionId.length === 0) {
      setLocalError("プログラム版を選択してください。");
      return;
    }
    if (outDir.trim().length === 0) {
      setLocalError("パッケージの出力先（絶対パス）を入力してください。");
      return;
    }
    resetPackageBuild();
    const requestId = exportRequestRef.current;
    exportMutation.mutate(
      { programVersionId: versionId, outDir: outDir.trim() },
      {
        onSuccess: (job) => {
          if (exportRequestRef.current === requestId) {
            setExportJobId(job.id);
          }
        },
      },
    );
  }

  async function readFixtureFile(file: File): Promise<void> {
    setLocalError(null);
    try {
      const comments = parseLiveFixtureCommentsJson(await file.text());
      setFixtureComments(comments);
      setFixtureFileName(file.name);
      setFixturePath("");
    } catch (error) {
      setFixtureComments(null);
      setFixtureFileName("");
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }

  function buildSource(): LiveRunSourceInput | null {
    if (sourceKind === "youtube") {
      if (videoUrl.trim().length === 0 && liveChatId.trim().length === 0) {
        setLocalError("YouTube の videoUrl または liveChatId を入力してください。");
        return null;
      }
      return {
        kind: "youtube",
        ...(videoUrl.trim().length === 0 ? {} : { videoUrl: videoUrl.trim() }),
        ...(liveChatId.trim().length === 0 ? {} : { liveChatId: liveChatId.trim() }),
      };
    }
    if (fixtureComments !== null) {
      return { kind: "fixture", comments: fixtureComments };
    }
    if (fixturePath.trim().length > 0) {
      return { kind: "fixture", fixturePath: fixturePath.trim() };
    }
    setLocalError("fixture ファイルを選択するか、サーバー上のパスを入力してください。");
    return null;
  }

  function createRun(): void {
    setLocalError(null);
    if (packageBuild === null) {
      setLocalError("先にパッケージを書き出してください。");
      return;
    }
    if (versionId.length === 0) {
      setLocalError("プログラム版を選択してください。");
      return;
    }
    const source = buildSource();
    if (source === null) {
      return;
    }
    const parsedPort = Number(port);
    if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
      setLocalError("ポートは 1024〜65535 の整数で指定してください。");
      return;
    }
    let startAtIso: string | null = null;
    if (startAt.trim().length > 0) {
      const date = new Date(startAt);
      if (Number.isNaN(date.getTime())) {
        setLocalError("開始予定の日時が不正です。");
        return;
      }
      startAtIso = date.toISOString();
    }
    createMutation.mutate(
      {
        programVersionId: versionId,
        packageBuild,
        source,
        startAt: startAtIso,
        requestedPort: parsedPort,
      },
      { onSuccess: (run) => setCreatedRun(run) },
    );
  }

  if (createdRun !== null) {
    const currentRun =
      createdRunQuery.data ??
      (launchMutation.data?.id === createdRun.id ? launchMutation.data : createdRun);
    return (
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Run を作成しました</h1>
          <p className={metaTextClass}>
            「アプリ起動」でローカルサーバーを立ち上げます。番組開始はコンソールで行ってください。
          </p>
        </div>
        <LiveRunStatus
          run={currentRun}
          launchPending={launchMutation.isPending}
          onLaunch={() => launchMutation.mutate(currentRun.id)}
        />
        {launchMutation.isError && (
          <p className={errorTextClass}>{errorMessage(launchMutation.error)}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link to={liveRunsRoute()} className={buttonPrimaryClass}>
            Run 一覧へ
          </Link>
          <Link
            to={liveRunNewRoute()}
            className={buttonPrimaryClass}
            onClick={resetRunCreation}
          >
            別の Run を作成
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {exportOnly ? "パッケージを書き出す" : "新しいライブ Run"}
          </h1>
          <p className={metaTextClass}>
            {exportOnly
              ? "確定済みの版から v2 パッケージだけを書き出します。Run は作成しません。"
              : "版からパッケージを書き出し、コメントソース・開始予定・ポートを固定して Run を作ります。"}
            {exportOnly ? "" : " LLM/TTS の接続設定はローカルのライブ設定に残ります。"}
          </p>
        </div>
        <Link to={liveRunsRoute()} className={buttonPrimaryClass}>
          Run 一覧
        </Link>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className={sectionTitleClass}>1. プログラム版とパッケージ</h2>
        <label className={formLabelBlockClass}>
          ライブプログラム
          <select
            className={`${textFieldClass} mt-1 block w-full`}
            value={programId}
            onChange={(event) => {
              setProgramId(event.target.value);
              setVersionId("");
              resetPackageBuild();
            }}
          >
            <option value="">選択してください</option>
            {(programsQuery.data?.items ?? []).map((program) => (
              <option key={program.id} value={program.id}>
                {program.title}
              </option>
            ))}
          </select>
        </label>
        {programId.length > 0 && (
          <p className={metaTextClass}>
            プログラムを編集する場合は{" "}
            <Link to={liveProgramRoute(programId)} className="text-brand-700 hover:underline">
              エディタ
            </Link>{" "}
            を開いてください。
          </p>
        )}
        <label className={formLabelBlockClass}>
          版
          <select
            className={`${textFieldClass} mt-1 block w-full`}
            value={versionId}
            disabled={versions.length === 0}
            onChange={(event) => {
              setVersionId(event.target.value);
              resetPackageBuild();
            }}
          >
            <option value="">{versions.length === 0 ? "版がありません" : "選択してください"}</option>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                v{version.versionNumber} ({version.id})
              </option>
            ))}
          </select>
        </label>
        {versionsQuery.isError && (
          <p className={errorTextClass}>{errorMessage(versionsQuery.error)}</p>
        )}

        <div className="rounded-md border border-border bg-surface-muted p-3">
          <h3 className="m-0 text-sm font-semibold">パッケージ書き出し</h3>
          <p className={metaTextClass}>
            確定済みの版から v2 パッケージを書き出します。既存ディレクトリは上書きしません。
          </p>
          <label className={formLabelBlockClass}>
            出力先（絶対パス）
            <input
              className={`${textFieldClass} mt-1 block w-full font-mono`}
              value={outDir}
              placeholder="/Users/me/Kakeai/live-packages/run-1"
              onChange={(event) => {
                setOutDir(event.target.value);
                resetPackageBuild();
              }}
            />
          </label>
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={exportMutation.isPending || versionId.length === 0}
            onClick={startExport}
          >
            {exportMutation.isPending ? "書き出し中…" : "パッケージを書き出す"}
          </button>
          {exportMutation.isError && (
            <p className={errorTextClass}>{errorMessage(exportMutation.error)}</p>
          )}
          {exportJobQuery.data !== undefined && (
            <div className="mt-2 text-sm">
              <p className="m-0">
                Job: {exportJobQuery.data.status} ({exportJobQuery.data.progressPercent}%)
              </p>
              {exportJobQuery.data.error !== null && (
                <p className={errorTextClass}>
                  {exportJobQuery.data.error.code}: {exportJobQuery.data.error.message}
                </p>
              )}
              {exportResult !== null && exportResult.warnings.length > 0 && (
                <ul className={`m-0 list-disc pl-5 ${warningTextClass}`}>
                  {exportResult.warnings.map((warning, index) => (
                    <li key={`${index}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {packageBuild !== null && (
            <div className="mt-2 space-y-1 text-sm">
              <p className="m-0">
                <span className={badgeSuccessClass}>使用する build</span>{" "}
                <span className="font-mono text-xs">{packageBuild.packageId}</span>
              </p>
              <p className="m-0 break-all font-mono text-xs">{packageBuild.packagePath}</p>
              <p className="m-0 break-all font-mono text-xs">
                manifest {packageBuild.manifestSha256}
              </p>
            </div>
          )}
          {exportOnly && packageBuild !== null && (
            <p className="mt-2 text-sm">
              <Link
                to={liveRunNewRoute({ programId, programVersionId: versionId })}
                className="text-brand-700 hover:underline"
              >
                この版で Run を作成
              </Link>
            </p>
          )}
        </div>
      </section>

      {!exportOnly && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className={sectionTitleClass}>2. コメントソースと起動設定</h2>
          <div className="flex flex-wrap gap-3 text-sm">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={sourceKind === "youtube"}
                onChange={() => setSourceKind("youtube")}
              />
              YouTube
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                checked={sourceKind === "fixture"}
                onChange={() => setSourceKind("fixture")}
              />
              fixture
            </label>
          </div>

          {sourceKind === "youtube" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={formLabelBlockClass}>
                YouTube 動画 URL
                <input
                  className={`${textFieldClass} mt-1 block w-full`}
                  value={videoUrl}
                  placeholder="https://www.youtube.com/watch?v=..."
                  onChange={(event) => setVideoUrl(event.target.value)}
                />
              </label>
              <label className={formLabelBlockClass}>
                liveChatId（URL の代わりに指定可）
                <input
                  className={`${textFieldClass} mt-1 block w-full`}
                  value={liveChatId}
                  onChange={(event) => setLiveChatId(event.target.value)}
                />
              </label>
            </div>
          ) : (
            <div className="space-y-2">
              <label className={formLabelBlockClass}>
                fixture JSON ファイル
                <input
                  className="mt-1 block text-sm"
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file !== undefined) {
                      void readFixtureFile(file);
                    }
                  }}
                />
              </label>
              {fixtureFileName.length > 0 && (
                <p className={metaTextClass}>
                  読み込み済み: {fixtureFileName}
                  {fixtureComments === null ? "" : ` (${fixtureComments.length}件)`}
                </p>
              )}
              <label className={formLabelBlockClass}>
                サーバー上の fixture パス（ファイルを選ぶ場合は不要）
                <input
                  className={`${textFieldClass} mt-1 block w-full font-mono`}
                  value={fixturePath}
                  placeholder="/Users/me/fixtures/comments.json"
                  onChange={(event) => {
                    setFixturePath(event.target.value);
                    setFixtureComments(null);
                    setFixtureFileName("");
                  }}
                />
              </label>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <label className={formLabelBlockClass}>
              開始予定（任意）
              <input
                className={`${textFieldClass} mt-1 block w-full`}
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
              />
            </label>
            <label className={formLabelBlockClass}>
              ポート
              <input
                className={`${textFieldClass} mt-1 block w-full`}
                type="number"
                min={1024}
                max={65535}
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
          </div>

          {(localError !== null || createMutation.isError) && (
            <p className={errorTextClass}>
              {localError ?? (createMutation.isError ? errorMessage(createMutation.error) : "")}
            </p>
          )}
          <button
            type="button"
            className={buttonPrimaryClass}
            disabled={createMutation.isPending || packageBuild === null}
            onClick={createRun}
          >
            {createMutation.isPending ? "作成中…" : "Run を作成"}
          </button>
          {packageBuild === null && (
            <p className={warningTextClass}>
              パッケージ build が未選択です。先に書き出してください。
            </p>
          )}
        </section>
      )}
    </section>
  );
}
