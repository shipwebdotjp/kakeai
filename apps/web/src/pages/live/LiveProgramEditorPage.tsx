import { Link, useParams } from "react-router-dom";
import { useLiveProgram } from "../../api/hooks";
import { errorMessage } from "../../lib/errorMessage";
import { liveProgramsRoute } from "../../lib/routes";
import { errorTextClass } from "../../ui";
import { LiveProgramEditor } from "../../live/components/LiveProgramEditor";

export function LiveProgramEditorPage() {
  const { programId } = useParams<{ programId: string }>();
  const programQuery = useLiveProgram(programId);

  if (programId === undefined || programId.length === 0) {
    return <p className={errorTextClass}>プログラムIDがありません。</p>;
  }
  if (programQuery.isLoading) {
    return <p>ライブプログラムを読み込み中…</p>;
  }
  if (programQuery.isError) {
    return (
      <div className="space-y-2">
        <p className={errorTextClass}>{errorMessage(programQuery.error)}</p>
        <Link to={liveProgramsRoute()} className="text-sm text-brand-700 hover:underline">
          ライブプログラム一覧へ戻る
        </Link>
      </div>
    );
  }
  if (programQuery.data === undefined) {
    return <p>ライブプログラムを読み込み中…</p>;
  }
  return <LiveProgramEditor key={programQuery.data.id} initial={programQuery.data} />;
}
