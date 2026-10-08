import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrentScriptVersion, useUpdateWork, useWork } from "../api/hooks";
import { SceneEditor } from "../components/SceneEditor";
import { errorMessage } from "../lib/errorMessage";

export function WorkEditPage() {
  const { workId } = useParams<{ workId: string }>();
  const work = useWork(workId);
  const editionId = work.data?.languageEditions[0]?.id;
  const current = useCurrentScriptVersion(editionId);
  const updateWork = useUpdateWork(workId);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  useEffect(() => {
    setTitleDraft(null);
  }, [workId]);

  const title = titleDraft ?? work.data?.title ?? "";

  const onRename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length > 0) {
      updateWork.mutate(trimmed, { onSuccess: () => setTitleDraft(null) });
    }
  };

  return (
    <section>
      <p>
        <Link to="/">← 作品一覧</Link>
      </p>

      {work.isLoading && <p>読み込み中…</p>}
      {work.isError && <p className="error">{errorMessage(work.error)}</p>}

      {work.data && (
        <>
          <form className="row" onSubmit={onRename}>
            <input value={title} onChange={(event) => setTitleDraft(event.target.value)} />
            <button type="submit" disabled={updateWork.isPending}>
              作品名を保存
            </button>
          </form>
          {updateWork.isError && <p className="error">{errorMessage(updateWork.error)}</p>}

          {current.isLoading && <p>台本を読み込み中…</p>}
          {current.isError && <p className="error">{errorMessage(current.error)}</p>}
          {editionId === undefined && <p>この作品には言語版がありません。</p>}
          {current.data && editionId !== undefined && (
            <SceneEditor key={current.data.id} base={current.data.content} editionId={editionId} />
          )}
        </>
      )}
    </section>
  );
}
