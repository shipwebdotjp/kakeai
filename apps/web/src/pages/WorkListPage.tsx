import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreateWork, useDeleteWork, useWorks } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";

export function WorkListPage() {
  const works = useWorks();
  const createWork = useCreateWork();
  const deleteWork = useDeleteWork();
  const [title, setTitle] = useState("");

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      return;
    }
    createWork.mutate(trimmed, { onSuccess: () => setTitle("") });
  };

  return (
    <section>
      <h1>作品一覧</h1>

      <form onSubmit={onCreate} className="row">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="新しい作品名"
        />
        <button type="submit" disabled={createWork.isPending}>
          作成
        </button>
      </form>
      {createWork.isError && <p className="error">{errorMessage(createWork.error)}</p>}
      {deleteWork.isError && <p className="error">{errorMessage(deleteWork.error)}</p>}

      {works.isLoading && <p>読み込み中…</p>}
      {works.isError && <p className="error">{errorMessage(works.error)}</p>}

      <ul className="work-list">
        {works.data?.map((work) => {
          const edition = work.languageEditions[0];
          return (
            <li key={work.id} className="work-item">
              <Link to={`/works/${work.id}`}>{work.title}</Link>
              <span className="meta">
                v{edition?.currentScriptVersion.versionNumber ?? "-"} ・{" "}
                {new Date(work.updatedAt).toLocaleString("ja-JP")}
              </span>
              <button
                type="button"
                disabled={deleteWork.isPending}
                onClick={() => {
                  if (window.confirm(`「${work.title}」を削除しますか？`)) {
                    deleteWork.mutate(work.id);
                  }
                }}
              >
                削除
              </button>
            </li>
          );
        })}
      </ul>
      {works.data?.length === 0 && <p>作品がありません。上のフォームから作成してください。</p>}
    </section>
  );
}
