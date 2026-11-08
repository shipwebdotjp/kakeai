import { useEffect, useState } from "react";
import type { ConsoleSnapshot } from "@kakeai/contracts";
import { formatTime } from "./format";

interface CutInPanelProps {
  snapshot: ConsoleSnapshot;
  onSkip: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * The playing CutIn and its dedicated skip. `skip_cue` never applies here:
 * the button sends only `skip_cut_in` and stays disabled outside the cut_in
 * phase, while the cue skip disables itself during a CutIn.
 */
export function CutInPanel({ snapshot, onSkip }: CutInPanelProps) {
  const cutIn = snapshot.cutIn;
  const occurrenceKey =
    cutIn === null
      ? null
      : `${cutIn.cutInId}:${cutIn.segmentId}:${cutIn.attempt}:${cutIn.sequence}:${cutIn.startedAt}`;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (occurrenceKey === null) {
      return;
    }
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [occurrenceKey]);

  if (cutIn === null) {
    return (
      <section className="block cut-in-panel">
        <h2>カットイン</h2>
        <p className="muted cut-in-empty">再生中のCutInはありません。</p>
      </section>
    );
  }

  const startedMs = Date.parse(cutIn.startedAt);
  const hasValidStart = !Number.isNaN(startedMs);
  const elapsedMs = hasValidStart ? clamp(now - startedMs, 0, cutIn.durationMs) : 0;
  const percent =
    hasValidStart && cutIn.durationMs > 0
      ? Math.min(100, Math.round((elapsedMs / cutIn.durationMs) * 100))
      : 0;
  const canSkip = snapshot.phase === "cut_in";

  return (
    <section className="block cut-in-panel">
      <div className="block-head">
        <h2>カットイン</h2>
        <span className="cut-in-label">{cutIn.label}</span>
        <button
          type="button"
          className="cut-in-skip"
          disabled={!canSkip}
          title={
            canSkip
              ? "再生中のCutInをスキップして次のセグメントへ進みます"
              : "CutInの再生中だけスキップできます"
          }
          onClick={onSkip}
        >
          CutInをスキップ
        </button>
      </div>

      <div className="cut-in-body">
        <div
          className="cut-in-progress"
          role="progressbar"
          aria-label="CutInの再生位置"
          aria-valuemin={0}
          aria-valuemax={cutIn.durationMs}
          aria-valuenow={hasValidStart ? elapsedMs : 0}
        >
          <div className="cut-in-progress-fill" style={{ width: `${percent}%` }} />
        </div>

        <p className="cut-in-times">
          <span className="cut-in-elapsed">{hasValidStart ? formatTime(elapsedMs) : "—"}</span>
          <span className="cut-in-total">/ {formatTime(cutIn.durationMs)}</span>
          <span className="cut-in-percent">{hasValidStart ? `${percent}%` : "—"}</span>
        </p>

        <div className="cut-in-meta">
          <span className="mono">cutInId: {cutIn.cutInId}</span>
          <span className="mono">segmentId: {cutIn.segmentId}</span>
          <span className="mono">
            attempt {cutIn.attempt} / sequence {cutIn.sequence}
          </span>
        </div>
      </div>
    </section>
  );
}
