const FALLBACK_CUE_DURATION_MS = 1000;
const WATCHDOG_MARGIN_MS = 5000;
const MIN_WATCHDOG_MS = 10_000;
const MAX_WATCHDOG_DURATION_MS = 24 * 60 * 60 * 1000;

const CUT_IN_WATCHDOG_MARGIN_MS = 1500;
const MIN_CUT_IN_WATCHDOG_MS = 3000;

/**
 * Watchdog delay for one CutIn attempt: duration + 1500ms, never below 3000ms
 * and capped like cue watchdogs. A missing `cut_in_ended` must not hold the
 * spine longer than this.
 */
export function cutInWatchdogTimeoutMs(durationMs: number): number {
  const duration =
    Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(durationMs, MAX_WATCHDOG_DURATION_MS)
      : 0;
  return Math.max(MIN_CUT_IN_WATCHDOG_MS, duration + CUT_IN_WATCHDOG_MARGIN_MS);
}

/** Watchdog delay for one attempt: duration + margin, never below ten seconds. */
export function watchdogTimeoutMs(durationMs: number | null): number {
  const duration =
    durationMs !== null && Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(durationMs, MAX_WATCHDOG_DURATION_MS)
      : FALLBACK_CUE_DURATION_MS;
  return Math.max(MIN_WATCHDOG_MS, duration + WATCHDOG_MARGIN_MS);
}
