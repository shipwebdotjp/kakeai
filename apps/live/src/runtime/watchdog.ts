const FALLBACK_CUE_DURATION_MS = 1000;
const WATCHDOG_MARGIN_MS = 5000;
const MIN_WATCHDOG_MS = 10_000;
const MAX_CUE_DURATION_MS = 24 * 60 * 60 * 1000;

/** Watchdog delay for one attempt: duration + margin, never below ten seconds. */
export function watchdogTimeoutMs(durationMs: number | null): number {
  const duration =
    durationMs !== null && Number.isFinite(durationMs) && durationMs > 0
      ? Math.min(durationMs, MAX_CUE_DURATION_MS)
      : FALLBACK_CUE_DURATION_MS;
  return Math.max(MIN_WATCHDOG_MS, duration + WATCHDOG_MARGIN_MS);
}
