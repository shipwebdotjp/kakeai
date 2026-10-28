import { logger } from "../logger.ts";

/**
 * Tracks the render Jobs that are executing in this API process so a running
 * render can be stopped with an AbortSignal. The app runs a single in-process
 * worker, so an in-memory map is enough; no cross-process coordination is
 * attempted.
 */
const activeRenders = new Map<string, AbortController>();

/** Registers a render and returns the signal to pass to the render engine. */
export function registerRenderCancellation(jobId: string): AbortSignal {
  const existing = activeRenders.get(jobId);
  if (existing !== undefined) {
    // A duplicate registration means a stale render is still alive. Stop it so
    // its controller cannot be leaked behind the new one.
    logger.warn("render_cancellation_replaced", { jobId });
    existing.abort();
  }
  const controller = new AbortController();
  activeRenders.set(jobId, controller);
  return controller.signal;
}

/** Removes a render registration once the Job finishes or fails. */
export function unregisterRenderCancellation(jobId: string, signal: AbortSignal): void {
  const controller = activeRenders.get(jobId);
  if (controller !== undefined && controller.signal === signal) {
    activeRenders.delete(jobId);
  }
}

/** Returns true when a live render was signalled to stop. */
export function abortActiveRender(jobId: string): boolean {
  const controller = activeRenders.get(jobId);
  if (controller === undefined) {
    return false;
  }
  controller.abort();
  return true;
}
