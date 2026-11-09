import { Link, useParams } from "react-router-dom";
import { useLiveFormat } from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { liveFormatsRoute } from "../../lib/routes";
import { errorTextClass } from "../../ui";
import { LiveFormatEditor } from "../../live/components/LiveFormatEditor";

export function LiveFormatEditorPage() {
  const { formatId } = useParams<{ formatId: string }>();
  const formatQuery = useLiveFormat(formatId);

  if (formatId === undefined || formatId.length === 0) {
    return <p className={errorTextClass}>フォーマットIDがありません。</p>;
  }
  if (formatQuery.isLoading) {
    return <p>ライブフォーマットを読み込み中…</p>;
  }
  if (formatQuery.isError) {
    return (
      <div className="space-y-2">
        <p className={errorTextClass}>{errorMessage(formatQuery.error)}</p>
        <Link to={liveFormatsRoute()} className="text-sm text-brand-700 hover:underline">
          ライブフォーマット一覧へ戻る
        </Link>
      </div>
    );
  }
  if (formatQuery.data === undefined) {
    return null;
  }
  return <LiveFormatEditor key={formatQuery.data.id} initial={formatQuery.data} />;
}
