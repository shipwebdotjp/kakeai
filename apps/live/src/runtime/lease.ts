import { randomUUID } from "node:crypto";
import type { LiveStageConnection, StageLease, StageLeaseRole } from "@kakeai/contracts";

interface StageSession {
  sessionId: string;
  role: StageLeaseRole;
  connectedAt: string;
  lease: StageLease;
}

export interface StageLeaseManagerOptions {
  ttlMs?: number;
  now?: () => Date;
  onProgramExpired?: (sessionId: string) => void;
}

export type TakeoverResult =
  | { ok: true; previousProgramSessionId: string | null }
  | { ok: false; reason: "unknown_session" };

/**
 * Owns the single program lease. A second stage becomes preview; when the
 * program disconnects or its lease expires, no connected preview is promoted
 * automatically. `takeover` is the only path that moves program.
 */
export class StageLeaseManager {
  private readonly sessions = new Map<string, StageSession>();
  private readonly ttlMs: number;
  private readonly now: () => Date;
  private readonly onProgramExpired: ((sessionId: string) => void) | undefined;

  constructor(
    readonly runId: string,
    options: StageLeaseManagerOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
    this.onProgramExpired = options.onProgramExpired;
  }

  connect(sessionId: string): StageLease {
    this.expireIfNeeded();
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return this.touch(sessionId) ?? existing.lease;
    }
    const role: StageLeaseRole = this.program() === null ? "program" : "preview";
    const session: StageSession = {
      sessionId,
      role,
      connectedAt: this.now().toISOString(),
      lease: this.issue(sessionId, role),
    };
    this.sessions.set(sessionId, session);
    return session.lease;
  }

  disconnect(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  roleOf(sessionId: string): StageLeaseRole | null {
    this.expireIfNeeded();
    return this.sessions.get(sessionId)?.role ?? null;
  }

  leaseOf(sessionId: string): StageLease | null {
    this.expireIfNeeded();
    return this.sessions.get(sessionId)?.lease ?? null;
  }

  program(): StageSession | null {
    for (const session of this.sessions.values()) {
      if (session.role === "program") {
        return session;
      }
    }
    return null;
  }

  /** Refreshes the lease after a heartbeat, keeping the same lease id. */
  touch(sessionId: string): StageLease | null {
    this.expireIfNeeded();
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return null;
    }
    const expiresAt = new Date(this.now().getTime() + this.ttlMs).toISOString();
    session.lease = { ...session.lease, expiresAt };
    return session.lease;
  }

  takeover(sessionId: string): TakeoverResult {
    this.expireIfNeeded();
    const target = this.sessions.get(sessionId);
    if (target === undefined) {
      return { ok: false, reason: "unknown_session" };
    }
    const current = this.program();
    if (current === null || current.sessionId === sessionId) {
      target.role = "program";
      target.lease = this.issue(sessionId, "program");
      return { ok: true, previousProgramSessionId: current?.sessionId ?? null };
    }
    current.role = "preview";
    current.lease = this.issue(current.sessionId, "preview");
    target.role = "program";
    target.lease = this.issue(sessionId, "program");
    return { ok: true, previousProgramSessionId: current.sessionId };
  }

  list(): LiveStageConnection[] {
    this.expireIfNeeded();
    return [...this.sessions.values()]
      .sort((a, b) => (a.connectedAt < b.connectedAt ? -1 : a.connectedAt > b.connectedAt ? 1 : 0))
      .map((session) => ({
        sessionId: session.sessionId,
        role: session.role,
        connectedAt: session.connectedAt,
        leaseExpiresAt: session.lease.expiresAt,
      }));
  }

  /**
   * Expired programs become preview; nobody is promoted into program.
   * Expired previews are dropped so a stale session cannot take over later.
   */
  expireIfNeeded(): void {
    const now = this.now().getTime();
    let expiredProgramSessionId: string | null = null;
    for (const session of [...this.sessions.values()]) {
      if (Date.parse(session.lease.expiresAt) > now) {
        continue;
      }
      if (session.role === "program") {
        expiredProgramSessionId = session.sessionId;
        session.role = "preview";
        session.lease = this.issue(session.sessionId, "preview");
      } else {
        this.sessions.delete(session.sessionId);
      }
    }
    if (expiredProgramSessionId !== null) {
      this.onProgramExpired?.(expiredProgramSessionId);
    }
  }

  private issue(sessionId: string, role: StageLeaseRole): StageLease {
    return {
      leaseId: `lease-${randomUUID()}`,
      runId: this.runId,
      sessionId,
      role,
      expiresAt: new Date(this.now().getTime() + this.ttlMs).toISOString(),
    };
  }
}
