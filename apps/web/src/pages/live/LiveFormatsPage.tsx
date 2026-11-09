import { Link, useNavigate } from "react-router-dom";
import { useDuplicateLiveFormat, useLiveFormats } from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { liveFormatNewRoute, liveFormatRoute } from "../../lib/routes";
import { formatDateTime, formatDuration } from "../../live/duration";
import {
  badgeNeutralClass,
  buttonNeutralClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  sectionTitleClass,
} from "../../ui";

export function LiveFormatsPage() {
  const navigate = useNavigate();
  const formatsQuery = useLiveFormats();
  const duplicateFormat = useDuplicateLiveFormat();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">ライブフォーマット</h1>
          <p className={metaTextClass}>
            番組の再利用可能なプリセットです。セグメントの骨格、キャスト、テーマ、定型カード、ポリシーを定義します。
          </p>
        </div>
        <Link to={liveFormatNewRoute()} className={buttonPrimaryClass}>
          新規フォーマット
        </Link>
      </div>

      <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        フォーマットの変更は、以後に作成するライブプログラムにだけ反映されます。既存プログラムには自動反映されません（作成元は来歴として残るだけです）。
      </div>

      {formatsQuery.isLoading && <p>フォーマットを読み込み中…</p>}
      {formatsQuery.isError && (
        <p className={errorTextClass}>{errorMessage(formatsQuery.error)}</p>
      )}
      {duplicateFormat.isError && (
        <p className={errorTextClass}>{errorMessage(duplicateFormat.error)}</p>
      )}

      {formatsQuery.isSuccess && formatsQuery.data.items.length === 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className={sectionTitleClass}>まだフォーマットがありません</h2>
          <p className={metaTextClass}>
            最初のフォーマットを作成すると、ライブプログラムの作成ウィザードで選べます。
          </p>
        </div>
      )}

      <ul className="m-0 list-none space-y-2 p-0">
        {formatsQuery.data?.items.map((format) => (
          <li
            key={format.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={liveFormatRoute(format.id)}
                  className="font-semibold text-brand-700 hover:underline"
                >
                  {format.name}
                </Link>
                <span className={badgeNeutralClass}>{format.title}</span>
                <span className={metaTextClass}>{formatDuration(format.targetDurationMs)}</span>
              </div>
              <p className="m-0 mt-1 text-sm text-muted-foreground">
                セグメント {format.segmentCount}件 / カード {format.cardCount}件 / 更新{" "}
                {formatDateTime(format.updatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={liveFormatRoute(format.id)} className={buttonPrimaryClass}>
                編集
              </Link>
              <button
                type="button"
                className={buttonNeutralClass}
                disabled={duplicateFormat.isPending}
                onClick={() => {
                  const name = window.prompt(
                    "複製後のフォーマット名",
                    `${format.name} のコピー`,
                  );
                  if (name === null || name.trim() === "") {
                    return;
                  }
                  duplicateFormat.mutate(
                    { formatId: format.id, name: name.trim() },
                    {
                      onSuccess: (created) => navigate(liveFormatRoute(created.id)),
                    },
                  );
                }}
              >
                複製
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
