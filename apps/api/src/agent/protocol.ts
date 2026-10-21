import type { Socket } from "node:net";
import {
  AGENT_ERROR_CODES,
  AGENT_IDLE_TIMEOUT_MS,
  AGENT_MAX_PENDING_FRAMES_PER_CONNECTION,
  AGENT_MAX_REQUEST_BYTES,
  AGENT_MUTATION_TIMEOUT_MS,
  AGENT_READ_TIMEOUT_MS,
  agentHandshakeSchema,
  agentRequestEnvelopeSchema,
  agentSuccessResponseSchema,
  isAgentProtocolVersionSupported,
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

/**
 * How long the reader stays paused after a frame was rejected. A rejected
 * frame is not queued, so the queue does not drain on its own and nothing
 * would release the reader again.
 */
const REJECTED_FRAME_RESUME_DELAY_MS = 50;

export interface AgentProtocolOptions {
  dispatch: AgentDispatch;
  operationKind: (operation: string) => AgentOperationKind | undefined;
  maxRequestBytes?: number;
  readTimeoutMs?: number;
  mutationTimeoutMs?: number;
  idleTimeoutMs?: number;
  /**
   * Maximum number of request frames one connection may hold unprocessed. A
   * frame received while the limit is reached is answered with
   * `AGENT_BACKPRESSURE` and skipped; the connection stays open.
   */
  maxPendingFramesPerConnection?: number;
  /**
   * Maximum number of bytes one connection may hold unprocessed. Defaults to
   * the maximum size of a single request.
   */
  maxPendingBytesPerConnection?: number;
}

function requestTimeoutError(): AgentOperationError {
  return new AgentOperationError(AGENT_ERROR_CODES.REQUEST_TIMEOUT);
}

/**
 * Attaches the NDJSON protocol to one accepted connection.
 *
 * Frames are processed sequentially even when a single chunk carries several
 * lines, so a mutation cannot overlap with the next request on the connection.
 *
 * The request frames that are received but not yet processed are bounded, both
 * in number and in bytes. A frame above the limit is not executed: it is
 * answered with `AGENT_BACKPRESSURE` and skipped, and the connection stays
 * open. The reader is paused while the limit is reached so a fast writer
 * cannot grow the server's memory without bound.
 */
export function attachAgentProtocol(socket: Socket, options: AgentProtocolOptions): void {
  const maxRequestBytes = options.maxRequestBytes ?? AGENT_MAX_REQUEST_BYTES;
  const readTimeoutMs = options.readTimeoutMs ?? AGENT_READ_TIMEOUT_MS;
  const mutationTimeoutMs = options.mutationTimeoutMs ?? AGENT_MUTATION_TIMEOUT_MS;
  const idleTimeoutMs = options.idleTimeoutMs ?? AGENT_IDLE_TIMEOUT_MS;
  const maxPendingFrames = Math.max(
    1,
    options.maxPendingFramesPerConnection ?? AGENT_MAX_PENDING_FRAMES_PER_CONNECTION,
  );
  // The number of pending frames alone does not bound the memory a
  // connection can pin, because one frame may be as large as
  // `AGENT_MAX_REQUEST_BYTES`. The pending bytes of one connection are
  // therefore bounded by the same budget as a single request.
  const maxPendingBytes = Math.max(
    1,
    options.maxPendingBytesPerConnection ?? maxRequestBytes,
  );
  // The reader starts again once the queue drained to this mark, so a burst
  // does not pause and resume the socket on every single frame.
  const resumeWatermark = Math.max(1, Math.floor(maxPendingFrames / 2));
  const resumeBytesWatermark = Math.max(1, Math.floor(maxPendingBytes / 2));

  let pending = "";
  let pendingBytes = 0;
  let handshakeDone = false;
  /** True once the first frame of the connection was received. */
  let firstFrameReceived = false;
  let agentId: string | undefined;
  let closing = false;
  let queue: Promise<void> = Promise.resolve();
  /** Request frames that were received but have not finished processing. */
  let pendingFrames = 0;
  /** Bytes of the request frames that were received but are not finished. */
  let pendingFrameBytes = 0;
  /** True while the socket is paused because the queue reached the limit. */
  let readerPaused = false;
  /** Releases the reader again after a frame was rejected. */
  let rejectionResumeTimer: NodeJS.Timeout | undefined;

  socket.setEncoding("utf8");
  socket.setTimeout(idleTimeoutMs, () => {
    socket.destroy();
  });
  socket.on("error", () => {
    // A client reset is not an application error.
  });
  socket.on("drain", () => {
    // The client read its answers again, so the reader may continue.
    updateReaderFlow();
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

  /**
   * Classifies one frame. Only the first frame of a connection may be the
   * handshake, so a burst of handshake-shaped frames cannot slip past the
   * pending-frame budget.
   */
  function classifyFrame(line: string): "handshake" | "request" {
    if (firstFrameReceived) {
      return "request";
    }
    const parsed = parseFrame(line);
    if (parsed === undefined) {
      return "request";
    }
    if (!agentHandshakeSchema.safeParse(parsed).success) {
      return "request";
    }
    return "handshake";
  }

  /**
   * The request id of a frame that could not be queued. A frame that does not
   * parse keeps the empty-request-id convention of the protocol failures.
   */
  function requestIdOf(line: string): string {
    const parsed = parseFrame(line);
    if (parsed === undefined) {
      return "";
    }
    const envelope = agentRequestEnvelopeSchema.safeParse(parsed);
    return envelope.success ? envelope.data.requestId : "";
  }

  /**
   * True while the client keeps up with the answers. A client that never
   * reads its answers must not be able to make the server buffer answers
   * without bound, so the reader stops until the write buffer drained.
   */
  function writeBufferDrained(): boolean {
    return socket.writableLength <= socket.writableHighWaterMark;
  }

  /**
   * Applies the reader-side backpressure. The socket stops reading while the
   * connection holds the maximum number of unprocessed request frames and
   * starts reading again once the queue drained to the resume watermark.
   */
  function updateReaderFlow(): void {
    if (closing || socket.destroyed) {
      return;
    }
    if (readerPaused) {
      if (
        rejectionResumeTimer === undefined &&
        pendingFrames <= resumeWatermark &&
        pendingFrameBytes <= resumeBytesWatermark &&
        writeBufferDrained()
      ) {
        readerPaused = false;
        socket.resume();
        socket.setTimeout(idleTimeoutMs);
      }
      return;
    }
    if (
      pendingFrames >= maxPendingFrames ||
      pendingFrameBytes >= maxPendingBytes ||
      !writeBufferDrained()
    ) {
      readerPaused = true;
      socket.pause();
    }
  }

  /**
   * Holds the reader back after a frame was rejected. The rejected frame is
   * not queued, so nothing would drain the queue and release the reader
   * again; the timer releases it so the connection cannot stall.
   */
  function pauseReaderAfterRejection(): void {
    if (readerPaused || closing || socket.destroyed) {
      return;
    }
    readerPaused = true;
    socket.pause();
    rejectionResumeTimer = setTimeout(() => {
      rejectionResumeTimer = undefined;
      updateReaderFlow();
    }, REJECTED_FRAME_RESUME_DELAY_MS);
    rejectionResumeTimer.unref?.();
  }

  /**
   * True when another frame would exceed the pending budget of the
   * connection. The budget counts the frames and the bytes they hold, so a
   * connection can neither queue an endless number of frames nor pin an
   * endless number of bytes.
   */
  function overPendingBudget(frameBytes: number): boolean {
    return (
      pendingFrames >= maxPendingFrames ||
      pendingFrameBytes + frameBytes > maxPendingBytes
    );
  }

  /**
   * Queues one frame behind the frames that were received earlier, so the
   * sequential-processing guarantee of the connection is kept.
   */
  function enqueueFrame(
    line: string,
    countsAsRequest: boolean,
    frameBytes: number,
  ): void {
    if (countsAsRequest) {
      pendingFrames += 1;
      pendingFrameBytes += frameBytes;
    }
    queue = queue
      .then(() => handleLine(line))
      .catch(() => {
        protocolFailure(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
      })
      .finally(() => {
        if (countsAsRequest) {
          pendingFrames -= 1;
          pendingFrameBytes -= frameBytes;
        }
        if (readerPaused && !closing) {
          // The connection is busy working through a burst, so the idle
          // timeout must not close it while frames are still pending.
          socket.setTimeout(idleTimeoutMs);
        }
        updateReaderFlow();
      });
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
        !isAgentProtocolVersionSupported(handshake.data.protocolVersion)
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
    try {
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
        const requestFrame = classifyFrame(line) === "request";
        // Only the first frame of a connection may be the handshake.
        firstFrameReceived = true;
        if (requestFrame) {
          if (overPendingBudget(segmentBytes)) {
            // Over the limit: the frame is not executed. The connection stays
            // open and the client learns that it has to slow down.
            writeError(requestIdOf(line), AGENT_ERROR_CODES.BACKPRESSURE);
            pauseReaderAfterRejection();
            continue;
          }
        }
        enqueueFrame(line, requestFrame, segmentBytes);
      }
    } finally {
      updateReaderFlow();
    }
  });

  socket.on("close", () => {
    closing = true;
    pending = "";
    if (rejectionResumeTimer !== undefined) {
      clearTimeout(rejectionResumeTimer);
      rejectionResumeTimer = undefined;
    }
  });
}
