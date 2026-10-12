import "@hyperframes/player";
import { memo, useState, type KeyboardEvent } from "react";
import { usePreviewActions, usePreviewTime } from "../lib/PreviewController";
import { errorMessage } from "../lib/errorMessage";
import { formatTime } from "../lib/player";
import { previewKeyAction } from "../lib/previewNavigation";
import { buttonNeutralClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";

const TIME_PRESETS = [1, 5, 10] as const;

export const PreviewSection = memo(function PreviewSection({
  sceneLabels,
}: {
  sceneLabels?: ReadonlyMap<string, string>;
}) {
  const actions = usePreviewActions();
  const time = usePreviewTime();
  const saved = time.savedPreview;
  const draftView = time.draft;
  const active = time.active;
  const [stepSeconds, setStepSeconds] = useState(5);

  const timeline = time.timeline;
  const currentTime = time.currentTime;
  const paused = time.paused;
  const durationSeconds = time.totalSeconds;

  const onPreviewKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = previewKeyAction(
      {
        key: event.key,
        shiftKey: event.shiftKey,
        target: event.target instanceof HTMLElement ? event.target : null,
      },
      stepSeconds,
    );
    if (action === null) {
      return;
    }
    event.preventDefault();
    switch (action.kind) {
      case "toggle-play":
        actions.togglePlay();
        break;
      case "step-seconds":
        actions.stepBySeconds(action.seconds);
        break;
      case "frame-step":
        actions.frameBy(action.frames);
        break;
      case "line":
        actions.moveToLine(action.direction);
        break;
      case "scene":
        actions.moveToScene(action.direction);
        break;
    }
  };

  return (
    <section>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">プレビュー</h2>
        {active === undefined && saved.isError && (
          <button type="button" className={buttonNeutralClass} onClick={() => saved.refetch()}>
            再試行
          </button>
        )}
        {draftView.error !== null && (
          <button
            type="button"
            className={buttonNeutralClass}
            disabled={!draftView.canRetry}
            onClick={draftView.retry}
          >
            再試行
          </button>
        )}
      </div>

      {active === undefined && saved.isLoading && (
        <p className={metaTextClass}>プレビューを生成中…</p>
      )}
      {active === undefined && saved.isError && (
        <p className={errorTextClass}>{errorMessage(saved.error)}</p>
      )}
      {draftView.isPending && <p className={metaTextClass}>プレビューを更新中…</p>}
      {draftView.error !== null && (
        <p className={errorTextClass}>{errorMessage(draftView.error)}</p>
      )}

      {active !== undefined && (
        <div
          tabIndex={0}
          role="group"
          aria-label="プレビュー操作"
          onKeyDown={onPreviewKeyDown}
          className="rounded focus:outline-2 focus:outline-brand-500"
        >
          <div className="mt-3 aspect-video w-full overflow-hidden rounded border border-border bg-black">
            <hyperframes-player
              key={active.identity}
              ref={actions.playerRef}
              srcdoc={active.compositionHtml}
              controls
              className="h-full w-full"
            />
          </div>

          {active.source === "draft" && !draftView.unreflected && (
            <p className={metaTextClass}>未保存の変更を反映しています。</p>
          )}
          {draftView.unreflected && (
            <p className={metaTextClass}>未保存の変更が未反映です。</p>
          )}

          {timeline !== undefined && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button type="button" className={buttonNeutralClass} onClick={actions.togglePlay}>
                  {paused ? "再生" : "一時停止"}
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.frameBy(-1)}
                >
                  コマ戻し
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.frameBy(1)}
                >
                  コマ送り
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.moveToLine(-1)}
                >
                  前のセリフ
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.moveToLine(1)}
                >
                  次のセリフ
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.moveToScene(-1)}
                >
                  前のシーン
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.moveToScene(1)}
                >
                  次のシーン
                </button>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.stepBySeconds(-stepSeconds)}
                >
                  −{stepSeconds}秒
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => actions.stepBySeconds(stepSeconds)}
                >
                  ＋{stepSeconds}秒
                </button>
                <label className="inline-flex items-center gap-1.5">
                  移動量
                  <select
                    className={textFieldClass}
                    value={stepSeconds}
                    onChange={(event) => setStepSeconds(Number(event.target.value))}
                  >
                    {TIME_PRESETS.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}秒
                      </option>
                    ))}
                  </select>
                </label>
                <span className={metaTextClass}>
                  {formatTime(currentTime)} / {formatTime(durationSeconds)}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1">
                {timeline.scenes.map((scene, index) => (
                  <button
                    key={scene.sceneId}
                    type="button"
                    className="rounded border border-border px-2 py-0.5 text-xs hover:bg-border/50"
                    onClick={() => actions.jumpToScene(scene.sceneId)}
                  >
                    {sceneLabels?.get(scene.sceneId) ?? `シーン ${index + 1}`}
                  </button>
                ))}
              </div>

              <details className={`mt-2 text-xs ${metaTextClass}`}>
                <summary className="cursor-pointer select-none">ショートカット</summary>
                <ul className="m-0 mt-1 list-none p-0">
                  <li>Space: 再生／一時停止</li>
                  <li>← / →: 移動量だけ戻る／進む</li>
                  <li>Shift+← / Shift+→: コマ戻し／送り</li>
                  <li>J / L: 前／次のセリフ</li>
                  <li>Shift+J / Shift+L: 前／次のシーン</li>
                </ul>
                <p className="m-0 mt-1">
                  プレビュー表示の背景部分にフォーカスがあるときだけ有効です。ボタンや入力欄にフォーカスがあるときはそちらが優先されます。
                </p>
              </details>
            </>
          )}

          <p className={metaTextClass}>
            {active.source === "draft"
              ? `ドラフト（未保存） / 素材 ${active.assetsCount} 件`
              : `版 ${saved.data?.scriptVersionId} / 素材 ${active.assetsCount} 件`}
          </p>
        </div>
      )}
    </section>
  );
});
