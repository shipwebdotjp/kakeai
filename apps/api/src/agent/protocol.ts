import type { Socket } from "node:net";
import {
  AGENT_ERROR_CODES,
  AGENT_IDLE_TIMEOUT_MS,
  AGENT_MAX_REQUEST_BYTES,
  AGENT_MUTATION_TIMEOUT_MS,
  AGENT_PROTOCOL_VERSION,
  AGENT_READ_TIMEOUT_MS,
  agentHandshakeSchema,
  agentRequestEnvelopeSchema,
  agentSuccessResponseSchema,
  type AgentErrorCode,
  type AgentResponse,
} from "@kakeai/contracts";
import { logger } from "../logger.ts";
import { AgentOperationError, toAgentError } from "./errors.ts";
import type { AgentOperationKind } from "./operations.ts";

export type AgentDispatch = (
  operation: string,
  input: unknown,
  agentId: string | undefined,
) => Promise<unknown>;

export interface AgentProtocolOptions {
  dispatch: AgentDispatch;
  operationKind: (operation: string) => AgentOperationKind | undefined;
  maxRequestBytes?: number;
  readTimeoutMs?: number;
  mutationTimeoutMs?: number;
  idleTimeoutMs?: number;
}

function requestTimeoutError(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.REQUEST_TIMEOUT);
}

/**
 * Attaches the NDJSON protocol to one accepted connection.
 *
 * Frames are processed sequentially even when a single chunk carries several
 * lines, so a mutation cannot overlap with the next request on the connection.
 */
export function attachAgentProtocol(socket: Socket, options: AgentProtocolOptions): void {
  const maxRequestBytes = options.maxRequestBytes ?? AGENT_MAX_REQUEST_BYTES;
  const readTimeoutMs = options.readTimeoutMs ?? AGENT_READ_TIMEOUT_MS;
  const mutationTimeoutMs = options.mutationTimeoutMs ?? AGENT_MUTATION_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? AGENT_IDLE_TIMEOUT_MS;

  let pending = "";
  let pendingBytes = 0;
  let handshakeDone = false;
  let agentId: string | undefined;
  let closing = false;
  let queue: Promise<void> = Promise.resolve();

  socket.setEncoding("utf8");
  socket.setTimeout(idleTimeoutMs, () => {
    socket.destroy();
  });
  socket.on("error", () => {
    // A client reset is not an application error.
  });

  function write(response: AgentResponse): void {
    if (closing || !socket.writable) {
      return;
    }
    socket.write(`${JSON.stringify(response)}\n`);
  }

  function writeError(requestId: string, code: AgentErrorCode): void {
    write({
      requestId,
      ok: false,
      error: { code },
    });
  }

  function protocolFailure(code: AgentErrorCode): void {
    if (closing) {
      return;
    }
    writeError("", code);
    closing = true;
    socket.end();
  }

  function parseFrame(line: string): unknown {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  }

  async function dispatchWithTimeout(
    operation: string,
    input: unknown,
  ): Promise<unknown> {
    const timeoutMs =
      options.operationKind(operation) === "mutation" ? mutationTimeoutMs : readTimeoutMs;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(requestTimeoutError());
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([
        options.dispatch(operation, input, agentId),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async function handleRequest(line: string): Promise<void> {
    if (closing) {
      return;
    }
    const parsed = parseFrame(line);
    if (parsed === undefined) {
      protocolFailure(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      return;
    }
    const envelope = agentRequestEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      protocolFailure(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      return;
    }
    const { requestId, operation, input } = envelope.data;

    let result: unknown;
    try {
      result = await dispatchWithTimeout(operation, input);
    } catch (error) {
      const wireError = toAgentError(error);
      logger.warn("agent_operation_failed", {
        operation,
        code: wireError.code,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      write({ requestId, ok: false, error: wireError });
      if (wireError.code === AGENT_ERROR_CODES.REQUEST_TIMEOUT) {
        closing = true;
        socket.end();
      }
      return;
    }

    try {
      const response = agentSuccessResponseSchema.parse({
        requestId,
        ok: true,
        data: result,
      });
      write(response);
    } catch {
      logger.error("agent_response_invalid", { operation });
      write({ requestId, ok: false, error: { code: "INTERNAL_ERROR" } });
    }
  }

  async function handleLine(line: string): Promise<void> {
    if (closing) {
      return;
    }
    if (!handshakeDone) {
      const parsed = parseFrame(line);
      if (parsed === undefined) {
        protocolFailure(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
        return;
      }
      const handshake = agentHandshakeSchema.safeParse(parsed);
      if (
        !handshake.success ||
        handshake.data.protocolVersion !== AGENT_PROTOCOL_VERSION
      ) {
        protocolFailure(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
        return;
      }
      handshakeDone = true;
      agentId = handshake.data.agentId;
      return;
    }
    await handleRequest(line);
  }

  function overflow(): void {
    pending = "";
    pendingBytes = 0;
    socket.pause();
    protocolFailure(AGENT_ERROR_CODES.PAYLOAD_TOO_LARGE);
  }

  socket.on("data", (chunk: string) => {
    if (closing) {
      return;
    }
    pending += chunk;
    pendingBytes += Buffer.byteLength(chunk, "utf8");
    for (;;) {
      const newline = pending.indexOf("\n");
      if (newline < 0) {
        if (pendingBytes > maxRequestBytes) {
          overflow();
        }
        return;
      }
      const segment = pending.slice(0, newline);
      const segmentBytes = Buffer.byteLength(segment, "utf8") + 1;
      pending = pending.slice(newline + 1);
      pendingBytes -= segmentBytes;
      if (segmentBytes > maxRequestBytes) {
        overflow();
        return;
      }
      const line = segment.endsWith("\r") ? segment.slice(0, -1) : segment;
      if (line.trim().length === 0) {
        continue;
      }
      queue = queue
        .then(() => handleLine(line))
        .catch(() => {
          protocolFailure(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
        });
    }
  });

  socket.on("close", () => {
    closing = true;
    pending = "";
  });
}
