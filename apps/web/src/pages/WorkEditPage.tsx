import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { ScriptVersion } from "@kakeai/contracts";
import { useCurrentScriptVersion, useUpdateWork, useWork } from "../api/hooks";
import { PreviewSection } from "../components/PreviewSection";
import { RenderSection } from "../components/RenderSection";
import { SceneEditor } from "../components/SceneEditor";
import { errorMessage } from "../lib/errorMessage";
import { buttonPrimaryClass, errorTextClass, textFieldClass } from "../ui";

export function WorkEditPage() {
  const { workId } = useParams<{ workId: string }>();
  const work = useWork(workId);
  const editionId = work.data?.languageEditions[0]?.id;
  const current = useCurrentScriptVersion(editionId);
  const updateWork = useUpdateWork(workId);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitleDraft(null);
    setPreviewVersionId(null);
  }, [workId, editionId]);

  const onSaved = (scriptVersion: ScriptVersion, options: { focusPreview: boolean }) => {
    setPreviewVersionId(scriptVersion.id);
    if (options.focusPreview) {
      requestAnimationFrame(() => {
        previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  };

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
      <p className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-brand-700 hover:underline dark:text-brand-400">
          ← 作品一覧
        </Link>
      </p>

      {work.isLoading && <p>読み込み中…</p>}
      {work.isError && <p className={errorTextClass}>{errorMessage(work.error)}</p>}

      {work.data && (
        <>
          <form onSubmit={onRename} className="my-3 flex flex-wrap items-center gap-2">
            <input
              value={title}
              onChange={(event) => setTitleDraft(event.target.value)}
              className={`min-w-[200px] flex-1 ${textFieldClass}`}
            />
            <button type="submit" className={buttonPrimaryClass} disabled={updateWork.isPending}>
              作品名を保存
            </button>
          </form>
          {updateWork.isError && (
            <p className={errorTextClass}>{errorMessage(updateWork.error)}</p>
          )}

          {current.isLoading && <p>台本を読み込み中…</p>}
          {current.isError && <p className={errorTextClass}>{errorMessage(current.error)}</p>}
          {editionId === undefined && <p>この作品には言語版がありません。</p>}
          {current.data && editionId !== undefined && workId !== undefined && (
            <>
              <SceneEditor
                key={editionId}
                base={current.data.content}
                editionId={editionId}
                scriptVersionId={previewVersionId ?? current.data.id}
                onSaved={onSaved}
              />
              <div ref={previewRef}>
                <PreviewSection scriptVersionId={previewVersionId ?? current.data.id} />
              </div>
              <RenderSection
                workId={workId}
                scriptVersionId={previewVersionId ?? current.data.id}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
