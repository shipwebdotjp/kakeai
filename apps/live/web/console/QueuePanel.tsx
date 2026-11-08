import type { ConsoleSnapshot, LiveSide } from "@kakeai/contracts";

const SIDE_LABELS: Record<LiveSide, string> = { left: "左", right: "右" };

function rowClass(isCurrent: boolean, isPast: boolean): string | undefined {
  if (isCurrent) {
    return "current";
  }
  if (isPast) {
    return "past";
  }
  return undefined;
}

interface QueuePanelProps {
  snapshot: ConsoleSnapshot;
  onSkip: () => void;
}

/**
 * Current cue, queue list and the operator skip. The skip is enabled only
 * while a playback instruction is active; prepared cues stay untouched.
 */
export function QueuePanel({ snapshot, onSkip }: QueuePanelProps) {
  const currentIndex =
    snapshot.queuePosition ??
    (snapshot.currentCueId === null
      ? -1
      : snapshot.queue.findIndex((cue) => cue.id === snapshot.currentCueId));
  const current =
    currentIndex >= 0 && currentIndex < snapshot.queue.length
      ? (snapshot.queue[currentIndex] ?? null)
      : null;
  const canSkip =
    snapshot.playback !== null &&
    snapshot.phase !== "paused" &&
    snapshot.phase !== "cut_in";
  const currentPlayback =
    snapshot.playback !== null && snapshot.playback.cueId === current?.id
      ? snapshot.playback
      : null;

  return (
    <section className="block">
      <div className="block-head">
        <h2>キュー</h2>
        {currentIndex >= 0 ? (
          <span className="queue-position">
            {currentIndex + 1} / {snapshot.queue.length}
          </span>
        ) : (
          <span className="queue-position">{snapshot.queue.length} 件</span>
        )}
        <button
          type="button"
          className="skip"
          disabled={!canSkip}
          title={
            canSkip ? "現在のキューをスキップ" : "再生中のキューだけスキップできます"
          }
          onClick={onSkip}
        >
          スキップ
        </button>
      </div>

      <div className={`current-cue${current === null ? " empty" : ""}`}>
        {current === null ? (
          <p className="muted">再生中のキューはありません。</p>
        ) : (
          <>
            <div className="current-cue-head">
              <span className="current-speaker">{SIDE_LABELS[current.speaker]}</span>
              <span className={`cue-status cue-status-${current.status}`}>{current.status}</span>
              <span className="muted">{current.source}</span>
            </div>
            <p className="current-caption">{current.caption}</p>
            <p className="muted mono">
              {current.id}
              {currentPlayback === null
                ? ""
                : ` / attempt ${currentPlayback.attempt} / sequence ${currentPlayback.sequence}`}
            </p>
          </>
        )}
      </div>

      <div className="queue-scroll">
        <table className="queue">
          <thead>
            <tr>
              <th className="index-cell">#</th>
              <th>ID</th>
              <th>話者</th>
              <th>字幕</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.queue.map((cue, index) => {
              const isCurrent = cue.id === snapshot.currentCueId;
              const isPast = currentIndex >= 0 && index < currentIndex;
              return (
                <tr
                  key={cue.id}
                  className={rowClass(isCurrent, isPast)}
                >
                  <td className="mono index-cell">{index + 1}</td>
                  <td className="mono">{cue.id}</td>
                  <td>{SIDE_LABELS[cue.speaker]}</td>
                  <td className="caption-cell">{cue.caption}</td>
                  <td>
                    <span className={`cue-status cue-status-${cue.status}`}>{cue.status}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
