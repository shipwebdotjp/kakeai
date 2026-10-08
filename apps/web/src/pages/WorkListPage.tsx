import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCreateWork, useDeleteWork, useWorks } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import {
  buttonDangerClass,
  buttonPrimaryClass,
  errorTextClass,
  metaTextClass,
  textFieldClass,
} from "../ui";

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
      <h1 className="mb-4 text-2xl font-bold">作品一覧</h1>

      <form onSubmit={onCreate} className="my-3 flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="新しい作品名"
          className={`min-w-[200px] flex-1 ${textFieldClass}`}
        />
        <button type="submit" className={buttonPrimaryClass} disabled={createWork.isPending}>
          作成
        </button>
      </form>
      {createWork.isError && <p className={errorTextClass}>{errorMessage(createWork.error)}</p>}
      {deleteWork.isError && <p className={errorTextClass}>{errorMessage(deleteWork.error)}</p>}

      {works.isLoading && <p>読み込み中…</p>}
      {works.isError && <p className={errorTextClass}>{errorMessage(works.error)}</p>}

      <ul className="list-none p-0">
        {works.data?.map((work) => {
          const edition = work.languageEditions[0];
          return (
            <li
              key={work.id}
              className="flex items-center gap-3 border-b border-gray-200 py-2.5 dark:border-gray-700"
            >
              <Link to={`/works/${work.id}`} className="flex-1 font-semibold text-inherit">
                {work.title}
              </Link>
              <span className={metaTextClass}>
                v{edition?.currentScriptVersion.versionNumber ?? "-"} ・{" "}
                {new Date(work.updatedAt).toLocaleString("ja-JP")}
              </span>
              <button
                type="button"
                className={buttonDangerClass}
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
