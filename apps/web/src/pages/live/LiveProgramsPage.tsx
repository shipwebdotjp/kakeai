import { Link } from "react-router-dom";
import { useLiveFormats, useLivePrograms } from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { formatDateTime } from "../../live/duration";
import { liveFormatRoute, liveFormatsRoute, liveProgramNewRoute, liveProgramRoute } from "../../lib/routes";
import {
  badgeNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  sectionTitleClass,
} from "../../ui";

export function LiveProgramsPage() {
  const programsQuery = useLivePrograms();
  const formatsQuery = useLiveFormats();
  const programs = programsQuery.data?.items ?? [];
  const formatNameById = new Map(
    (formatsQuery.data?.items ?? []).map((format) => [format.id, format.name]),
  );

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ライブプログラム</h1>
          <p className={metaTextClass}>
            配信ごとの台本を、動画タイムラインではなくセグメントのスパインとして編集します。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={liveFormatsRoute()} className={buttonPrimaryClass}>
            ライブフォーマット
          </Link>
          <Link to={liveProgramNewRoute()} className={buttonPrimaryClass}>
            新規プログラム
          </Link>
        </div>
      </div>

      {programsQuery.isLoading && <p>ライブプログラムを読み込み中…</p>}
      {programsQuery.isError && (
        <p className={errorTextClass}>{errorMessage(programsQuery.error)}</p>
      )}
      {formatsQuery.isError && (
        <p className={errorTextClass}>{errorMessage(formatsQuery.error)}</p>
      )}

      {programsQuery.isSuccess && programs.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className={sectionTitleClass}>まだプログラムがありません</h2>
          <p className={metaTextClass}>
            ライブフォーマットを選んで新しいプログラムを作成してください。
            {formatsQuery.data?.items.length === 0 &&
              " 先にライブフォーマットを作成する必要があります。"}
          </p>
          <div className="mt-2 flex gap-2">
            <Link to={liveProgramNewRoute()} className={buttonPrimaryClass}>
              新規プログラム
            </Link>
            <Link to={liveFormatsRoute()} className={buttonPrimaryClass}>
              フォーマットを作成
            </Link>
          </div>
        </div>
      )}

      {programs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="p-3">タイトル</th>
                <th className="p-3">リビジョン</th>
                <th className="p-3">版</th>
                <th className="p-3">作成元フォーマット</th>
                <th className="p-3">更新日時</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((program) => (
                <tr key={program.id} className="border-b border-border last:border-b-0">
                  <td className="p-3">
                    <Link
                      to={liveProgramRoute(program.id)}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {program.title}
                    </Link>
                    <p className="m-0 text-xs text-muted-foreground">{program.id}</p>
                  </td>
                  <td className="p-3 tabular-nums">{program.draftRevision}</td>
                  <td className="p-3">
                    {program.versionCount}件
                    {program.latestVersionNumber !== null && (
                      <span className="ml-1 text-muted-foreground">
                        （最新 v{program.latestVersionNumber}）
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {program.sourceFormat === null ? (
                      <span className={badgeNeutralClass}>なし</span>
                    ) : (
                      <Link
                        to={liveFormatRoute(program.sourceFormat.formatId)}
                        className="text-brand-700 hover:underline"
                      >
                        {formatNameById.get(program.sourceFormat.formatId) ??
                          program.sourceFormat.formatId}
                      </Link>
                    )}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {formatDateTime(program.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
