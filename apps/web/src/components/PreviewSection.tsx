import "@hyperframes/player";
import { memo, useEffect, useMemo, useState, type RefObject } from "react";
import type { ScriptVersionPreview } from "@kakeai/contracts";
import { useScriptVersionPreview } from "../api/hooks";
import { errorMessage } from "../lib/errorMessage";
import { asSeekablePlayer, formatTime, seekTo } from "../lib/player";
import { buttonNeutralClass, errorTextClass, metaTextClass, textFieldClass } from "../ui";

type PreviewTimeline = ScriptVersionPreview["timeline"];

const TIME_PRESETS = [1, 5, 10] as const;

function nextTime(times: number[], current: number, direction: 1 | -1): number | null {
  if (direction === 1) {
    return times.find((value) => value > current + 0.001) ?? null;
  }
  for (let index = times.length - 1; index >= 0; index -= 1) {
    if (times[index]! < current - 0.001) {
      return times[index]!;
    }
  }
  return null;
}

export const PreviewSection = memo(function PreviewSection({
  scriptVersionId,
  playerRef,
  sceneLabels,
}: {
  scriptVersionId: string;
  playerRef?: RefObject<HTMLElement | null>;
  sceneLabels?: ReadonlyMap<string, string>;
}) {
  const preview = useScriptVersionPreview(scriptVersionId);
  const [currentTime, setCurrentTime] = useState(0);
  const [paused, setPaused] = useState(true);
  const [stepSeconds, setStepSeconds] = useState(5);

  const timeline: PreviewTimeline | undefined = preview.data?.timeline;

  useEffect(() => {
    setCurrentTime(0);
    setPaused(true);
  }, [scriptVersionId]);

  useEffect(() => {
    const timer = setInterval(() => {
      const player = asSeekablePlayer(playerRef?.current ?? null);
      if (player === null) {
        return;
      }
      if (typeof player.currentTime === "number") {
        setCurrentTime(player.currentTime);
      }
      if (typeof player.paused === "boolean") {
        setPaused(player.paused);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [playerRef, scriptVersionId]);

  const lineTimes = useMemo(
    () =>
      (timeline?.scenes ?? []).flatMap((scene) =>
        scene.lines.map((line) => line.startMs / 1000),
      ),
    [timeline],
  );
  const sceneTimes = useMemo(
    () => (timeline?.scenes ?? []).map((scene) => scene.startMs / 1000),
    [timeline],
  );

  const durationSeconds = (timeline?.totalDurationMs ?? 0) / 1000;
  const frameStep = 1 / (timeline?.fps ?? 30);

  const player = () => asSeekablePlayer(playerRef?.current ?? null);
  const now = () => {
    const value = player()?.currentTime;
    return typeof value === "number" && Number.isFinite(value) ? value : currentTime;
  };
  const seek = (timeInSeconds: number) => {
    seekTo(player(), timeInSeconds);
    setCurrentTime(Math.min(Math.max(0, timeInSeconds), durationSeconds));
  };
  const togglePlay = () => {
    const target = player();
    if (target === null) {
      return;
    }
    if (paused) {
      Promise.resolve(target.play?.()).catch(() => {
        // playback can be rejected before the user interacts with the page
      });
      setPaused(false);
    } else {
      target.pause?.();
      setPaused(true);
    }
  };

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
              className="h-full w-full"
            />
          </div>

          {timeline !== undefined && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button type="button" className={buttonNeutralClass} onClick={togglePlay}>
                  {paused ? "再生" : "一時停止"}
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => seek(now() - frameStep)}
                >
                  コマ戻し
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => seek(now() + frameStep)}
                >
                  コマ送り
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => {
                    const next = nextTime(lineTimes, now(), -1);
                    if (next !== null) seek(next);
                  }}
                >
                  前のセリフ
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => {
                    const next = nextTime(lineTimes, now(), 1);
                    if (next !== null) seek(next);
                  }}
                >
                  次のセリフ
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => {
                    const next = nextTime(sceneTimes, now(), -1);
                    if (next !== null) seek(next);
                  }}
                >
                  前のシーン
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => {
                    const next = nextTime(sceneTimes, now(), 1);
                    if (next !== null) seek(next);
                  }}
                >
                  次のシーン
                </button>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => seek(now() - stepSeconds)}
                >
                  −{stepSeconds}秒
                </button>
                <button
                  type="button"
                  className={buttonNeutralClass}
                  onClick={() => seek(now() + stepSeconds)}
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
                    onClick={() => seek(scene.startMs / 1000)}
                  >
                    {sceneLabels?.get(scene.sceneId) ?? `シーン ${index + 1}`}
                  </button>
                ))}
              </div>
            </>
          )}

          <p className={metaTextClass}>
            版 {preview.data.scriptVersionId} / 素材 {preview.data.assets.length} 件
          </p>
        </>
      )}
    </section>
  );
});
