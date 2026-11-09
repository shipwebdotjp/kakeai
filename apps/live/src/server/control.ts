import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import {
  liveControlStatusSchema,
  liveControlStopResponseSchema,
  type LiveControlStatus,
  type LiveRunFailure,
  type StagePhase,
} from "@kakeai/contracts";

export interface LiveControlOptions {
  token: string;
  runId: string | null;
  stageUrl: string;
  consoleUrl: string;
  startedAt: string | null;
  lifecycle: () => { phase: StagePhase; started: boolean; ended: boolean };
  isStopping: () => boolean;
  failure: () => LiveRunFailure | null;
  requestStop: () => void;
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const match = /^Bearer (.+)$/u.exec(header.trim());
  return match?.[1] ?? null;
}

/** Constant-time compare; length differences are folded into the result. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Still compare a same-length buffer so the timing does not reveal the
    // expected length beyond what the response already does.
    timingSafeEqual(a, Buffer.alloc(a.length));
    return false;
  }
  return timingSafeEqual(a, b);
}

export function createControlStatus(options: LiveControlOptions): LiveControlStatus {
  const lifecycle = options.lifecycle();
  const failure = options.failure();
  const status: LiveControlStatus["status"] = failure !== null
    ? "failed"
    : options.isStopping()
      ? "stopped"
      : lifecycle.ended
        ? "ended"
        : lifecycle.started
          ? "running"
          : "ready";
  return liveControlStatusSchema.parse({
    ok: true,
    runId: options.runId,
    ready: true,
    stageUrl: options.stageUrl,
    consoleUrl: options.consoleUrl,
    status,
    phase: lifecycle.phase,
    showStarted: lifecycle.started,
    showEnded: lifecycle.ended,
    startedAt: options.startedAt,
    failure,
  });
}

/**
 * Loopback-only control plane. The access guard already rejects non-loopback
 * Host headers; this router adds a one-time bearer token so another local
 * process cannot stop or inspect the show.
 */
export function createControlRouter(options: LiveControlOptions): Router {
  const router = Router();
  router.use((req, res, next) => {
    const provided = bearerToken(req);
    if (provided === null || !tokenMatches(provided, options.token)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  router.get("/status", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(createControlStatus(options));
  });

  router.post("/stop", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(
      liveControlStopResponseSchema.parse({ ok: true, status: "stopped" }),
    );
    // Let the response flush before the HTTP server starts closing.
    setImmediate(() => options.requestStop());
  });

  return router;
}
