import "@hyperframes/player";
import { memo, type RefObject } from "react";
import { useScriptVersionPreview } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { buttonNeutralClass, errorTextClass, metaTextClass } from "../ui";

export const PreviewSection = memo(function PreviewSection({
  scriptVersionId,
  playerRef,
}: {
  scriptVersionId: string;
  playerRef?: RefObject<HTMLElement | null>;
}) {
  const preview = useScriptVersionPreview(scriptVersionId);

  return (
    <section>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">プレビュー</h2>
        <button
          type="button"
          className={buttonNeutralClass}
          disabled={preview.isFetching}
          onClick={() => preview.refetch()}
        >
          更新
        </button>
      </div>

      {preview.isLoading && <p className={metaTextClass}>プレビューを生成中…</p>}
      {preview.isError && <p className={errorTextClass}>{errorMessage(preview.error)}</p>}

      {preview.data && (
        <>
          <div className="mt-3 aspect-video w-full overflow-hidden rounded border border-border bg-black">
            <hyperframes-player
              key={preview.data.scriptVersionId}
              ref={playerRef}
              srcdoc={preview.data.compositionHtml}
              controls
              className="h-full w-full"
            />
          </div>
          <p className={metaTextClass}>
            版 {preview.data.scriptVersionId} / 素材 {preview.data.assets.length} 件
          </p>
        </>
      )}
    </section>
  );
});
