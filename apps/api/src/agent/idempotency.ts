import { setTimeout as delay } from "node:timers/promises";
import { AGENT_ERROR_CODES } from "@kakeai/contracts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { logger } from "../logger.ts";
import {
  AGENT_REQUEST_IN_FLIGHT_POLL_MS,
  AGENT_REQUEST_IN_FLIGHT_WAIT_MS,
  claimAgentRequest,
  completeAgentRequest,
  findAgentRequest,
  normalizeLedgerAgentId,
  releaseAgentRequest,
  releaseStaleAgentRequest,
  type AgentRequestKey,
} from "../services/agent-requests.ts";
import { computeAgentRequestHash } from "../services/agent-request-hash.ts";
import { AgentOperationError, agentIssue } from "./errors.ts";

/** How many times a duplicate may take over a released slot before giving up. */
const MAX_CLAIM_ATTEMPTS = 3;

export interface AgentRequestRun<Output> {
  /** Runs the operation. It must not run twice for one claim. */
  run: () => Promise<Output>;
  /**
   * The reference stored when the run succeeded. It points at the created
   * resource(s), never at a response snapshot.
   */
  resultRef: (output: Output) => string;
  /**
   * Rebuilds the response from the stored reference and the current state of
   * the referenced resource.
   */
  replay: (resultRef: string) => Promise<Output>;
}

export interface RunWithAgentRequestParams<Output> {
  prisma: PrismaClient;
  /** The operation name; it is part of the ledger key and of the hash. */
  operation: string;
  /** The handshake agent id; an omitted id becomes the reserved default. */
  agentId: string | undefined;
  /** The caller supplied idempotency key. */
  requestId: string;
  /**
   * The input the request hash is computed over. It is hashed without its
   * `requestId`, so the same logical request hashes identically.
   */
  input: unknown;
  idempotent: AgentRequestRun<Output>;
}

function conflictError(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.IDEMPOTENCY_CONFLICT, [
    agentIssue(
      ["requestId"],
      "idempotency_conflict",
      "同じ requestId が異なる入力で使われました。",
    ),
  ]);
}

function inProgressError(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.IDEMPOTENCY_IN_PROGRESS, [
    agentIssue(
      ["requestId"],
      "in_progress",
      "同じ requestId の処理が実行中です。完了を確認してから再送してください。",
    ),
  ]);
}

type WaitOutcome =
  | { kind: "completed"; resultRef: string }
  | { kind: "released" }
  | { kind: "timeout" };

/**
 * Waits a bounded time for the request that owns the claim to finish. The
 * wait never blocks longer than the local socket's mutation budget, and the
 * polling backs off so a duplicate does not hammer the database.
 */
async function waitForCompletion(
  prisma: PrismaClient,
  key: AgentRequestKey,
): Promise<WaitOutcome> {
  const deadline = Date.now() + AGENT_REQUEST_IN_FLIGHT_WAIT_MS;
  let interval = AGENT_REQUEST_IN_FLIGHT_POLL_MS;
  for (;;) {
    const row = await findAgentRequest(prisma, key);
    if (row === null) {
      // The owner released the claim, so it failed and created nothing.
      return { kind: "released" };
    }
    if (row.resultRef !== null) {
      return { kind: "completed", resultRef: row.resultRef };
    }
    if (Date.now() >= deadline) {
      return { kind: "timeout" };
    }
    await delay(interval);
    interval = Math.min(interval * 2, 500);
  }
}

async function executeClaimed<Output>(
  params: RunWithAgentRequestParams<Output>,
  claimId: string,
): Promise<Output> {
  try {
    const output = await params.idempotent.run();
    try {
      await completeAgentRequest(
        params.prisma,
        claimId,
        params.idempotent.resultRef(output),
      );
    } catch (error) {
      // The operation itself succeeded. Without a stored reference a retry
      // would run it again, so the claim is released and the failure is logged.
      logger.error("agent_request_complete_failed", {
        operation: params.operation,
        message: error instanceof Error ? error.message : String(error),
      });
      await releaseAgentRequest(params.prisma, claimId).catch(() => undefined);
    }
    return output;
  } catch (error) {
    // A failed operation leaves nothing behind: the claim is released so a
    // genuine retry can run again.
    await releaseAgentRequest(params.prisma, claimId).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs a high-cost operation under the idempotency ledger.
 *
 * - The claim is taken before the operation runs, so a concurrent duplicate
 *   cannot create a second Job or Version.
 * - The same request id with the same input replays the stored reference and
 *   rebuilds the response from the current resource state.
 * - The same request id with a different input is an `IDEMPOTENCY_CONFLICT`.
 * - A duplicate that arrives while the first run is still in flight waits for
 *   it and reports `AGENT_IDEMPOTENCY_IN_PROGRESS` when it does not finish.
 */
export async function runWithAgentRequest<Output>(
  params: RunWithAgentRequestParams<Output>,
): Promise<Output> {
  const agentId = normalizeLedgerAgentId(params.agentId);
  const requestHash = computeAgentRequestHash(params.operation, params.input);
  const key: AgentRequestKey = {
    operation: params.operation,
    agentId,
    requestId: params.requestId,
  };

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const claim = await claimAgentRequest(params.prisma, key, requestHash);
    if (claim.kind === "claimed") {
      return await executeClaimed(params, claim.id);
    }

    const row = claim.row;
    if (row.resultRef !== null) {
      // A finished request is replayed from its stored reference.
      if (row.requestHash !== requestHash) {
        throw conflictError();
      }
      return await params.idempotent.replay(row.resultRef);
    }

    if (await releaseStaleAgentRequest(params.prisma, row)) {
      // The previous owner died before storing a result. Take the slot over,
      // even when the new input differs: the abandoned claim must not poison
      // the key forever.
      continue;
    }

    if (row.requestHash !== requestHash) {
      throw conflictError();
    }

    const waited = await waitForCompletion(params.prisma, key);
    if (waited.kind === "completed") {
      return await params.idempotent.replay(waited.resultRef);
    }
    if (waited.kind === "released") {
      // The owner failed and released the claim; the slot is free again.
      continue;
    }
    throw inProgressError();
  }

  throw inProgressError();
}
