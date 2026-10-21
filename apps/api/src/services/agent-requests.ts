import type { AgentRequest, PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";

/**
 * Ledger agent id used when the client did not send one in the handshake. The
 * ledger key must stay stable, so an unidentified client shares one bucket
 * instead of writing a row per request.
 *
 * A client supplied id is stored with an `agent:` prefix, so a client cannot
 * impersonate this reserved value.
 */
export const DEFAULT_LEDGER_AGENT_ID = "none";

/**
 * A claim older than this is treated as abandoned: the process that owned it
 * died before it could store a result reference. It is far longer than the
 * mutation timeout of the local socket (120 s), so a slow but alive request is
 * not taken over while it still runs.
 */
export const AGENT_REQUEST_CLAIM_TTL_MS = 10 * 60_000;

/** How long a duplicate waits for the in-flight request to finish. */
export const AGENT_REQUEST_IN_FLIGHT_WAIT_MS = 2_000;
/** The first polling interval while waiting for an in-flight request. */
export const AGENT_REQUEST_IN_FLIGHT_POLL_MS = 25;

/**
 * How long a completed row is kept. The ledger only has to survive a retry
 * after a timeout, so a month is far beyond that; older rows are pruned
 * instead of letting the table grow forever.
 */
export const AGENT_REQUEST_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The shortest interval between two prune runs. */
const PRUNE_INTERVAL_MS = 5 * 60_000;
let lastPruneAt = 0;

/** The identity of one ledger entry. */
export interface AgentRequestKey {
  operation: string;
  agentId: string;
  requestId: string;
}

export type AgentRequestClaim =
  | { kind: "claimed"; id: string }
  | { kind: "existing"; row: AgentRequest };

function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  return (error as { code?: unknown }).code === "P2002";
}

/**
 * Normalises the handshake `agentId` into a stable ledger key. An omitted or
 * blank id becomes the reserved default, so the same client always lands on
 * the same ledger row. A supplied id is namespaced, so it can never collide
 * with the reserved default.
 */
export function normalizeLedgerAgentId(agentId: string | undefined): string {
  if (agentId === undefined) {
    return DEFAULT_LEDGER_AGENT_ID;
  }
  const trimmed = agentId.trim();
  return trimmed.length === 0 ? DEFAULT_LEDGER_AGENT_ID : `agent:${trimmed}`;
}

export async function findAgentRequest(
  prisma: PrismaClient,
  key: AgentRequestKey,
): Promise<AgentRequest | null> {
  return prisma.agentRequest.findUnique({
    where: {
      operation_agentId_requestId: {
        operation: key.operation,
        agentId: key.agentId,
        requestId: key.requestId,
      },
    },
  });
}

/**
 * Inserts the claim row. `null` means the slot is already taken by another
 * request; any other error is a real failure.
 */
async function insertAgentRequest(
  prisma: PrismaClient,
  key: AgentRequestKey,
  requestHash: string,
): Promise<AgentRequest | null> {
  try {
    return await prisma.agentRequest.create({
      data: {
        operation: key.operation,
        agentId: key.agentId,
        requestId: key.requestId,
        requestHash,
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    return null;
  }
}

/**
 * Claims the (operation, agentId, requestId) slot. The unique constraint is
 * the only thing that serialises two concurrent duplicates: exactly one caller
 * inserts the row and therefore runs the operation.
 */
export async function claimAgentRequest(
  prisma: PrismaClient,
  key: AgentRequestKey,
  requestHash: string,
): Promise<AgentRequestClaim> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await insertAgentRequest(prisma, key, requestHash);
    if (row !== null) {
      // Pruning is housekeeping. It must never fail a claim that was already
      // taken, otherwise the row would stay in flight without an owner.
      await pruneAgentRequests(prisma).catch((error: unknown) => {
        logger.warn("agent_request_prune_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
      });
      return { kind: "claimed", id: row.id };
    }
    const existing = await findAgentRequest(prisma, key);
    if (existing === null) {
      // The row was released between the failed insert and this read, so the
      // slot is free again.
      continue;
    }
    return { kind: "existing", row: existing };
  }
  throw new Error("冪等台帳の claim に失敗しました。");
}

/**
 * Stores the result reference of a finished request. A row that no longer
 * exists means the claim was taken over or released meanwhile, so the caller
 * has to treat it as an anomaly instead of silently storing nothing.
 */
export async function completeAgentRequest(
  prisma: PrismaClient,
  id: string,
  resultRef: string,
): Promise<void> {
  const updated = await prisma.agentRequest.updateMany({
    where: { id, resultRef: null },
    data: { resultRef },
  });
  if (updated.count === 0) {
    throw new Error(`冪等台帳の行 ${id} に結果参照を保存できません。`);
  }
}

/**
 * Removes the rows the ledger no longer needs: finished requests older than
 * the retention window and abandoned claims older than the claim TTL. The
 * prune runs at most once every few minutes, so it stays off the hot path.
 */
export async function pruneAgentRequests(
  prisma: PrismaClient,
  now: number = Date.now(),
): Promise<void> {
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = now;
  await prisma.agentRequest.deleteMany({
    where: {
      createdAt: { lt: new Date(now - AGENT_REQUEST_RETENTION_MS) },
    },
  });
  await prisma.agentRequest.deleteMany({
    where: {
      resultRef: null,
      createdAt: { lt: new Date(now - AGENT_REQUEST_CLAIM_TTL_MS) },
    },
  });
}
/**
 * Releases a claim without a result, so the request id can be used again.
 * Used when the operation failed: a failed run leaves nothing behind and a
 * genuine retry may run again.
 */
export async function releaseAgentRequest(
  prisma: PrismaClient,
  id: string,
): Promise<void> {
  await prisma.agentRequest.deleteMany({ where: { id, resultRef: null } });
}

/**
 * Removes an abandoned claim. Only a claim without a result reference and
 * older than the TTL is removed, so a live request is never taken over.
 */
export async function releaseStaleAgentRequest(
  prisma: PrismaClient,
  row: AgentRequest,
  now: number = Date.now(),
): Promise<boolean> {
  if (row.resultRef !== null) {
    return false;
  }
  if (now - row.createdAt.getTime() < AGENT_REQUEST_CLAIM_TTL_MS) {
    return false;
  }
  const removed = await prisma.agentRequest.deleteMany({
    where: { id: row.id, resultRef: null },
  });
  return removed.count > 0;
}
