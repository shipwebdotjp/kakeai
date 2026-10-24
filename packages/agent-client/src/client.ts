import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import {
  AGENT_ERROR_CODES,
  AGENT_MAX_REQUEST_BYTES,
  AGENT_MUTATION_TIMEOUT_MS,
  AGENT_PROTOCOL_VERSION,
  agentOperationOutputSchemas,
  agentResponseSchema,
  isAgentMutationOperation,
  isAgentOperationName,
  resolveAgentReadTimeoutMs,
  type AgentErrorCode,
  type AgentErrorIssue,
  type AgentOperationInputMap,
  type AgentOperationName,
  type AgentOperationOutputMap,
} from "@kakeai/contracts";
import { defaultAgentDataRoot, resolveAgentSocketPath } from "./paths.ts";

export class AgentClientError extends Error {
  readonly code: AgentErrorCode;
  readonly issues: AgentErrorIssue[];

  constructor(code: AgentErrorCode, issues: AgentErrorIssue[] = []) {
    super(code);
    this.name = "AgentClientError";
    this.code = code;
    this.issues = issues;
  }
}

export interface AgentClientOptions {
  /** Data root of the running app. Defaults to the platform data root. */
  dataRoot?: string;
  /** Explicit socket path; overrides `dataRoot`. */
  socketPath?: string;
  /** Identification sent during the handshake. */
  agentId?: string;
  readTimeoutMs?: number;
  mutationTimeoutMs?: number;
}

export interface AgentClient {
  socketPath: string;
  request<N extends AgentOperationName>(
    operation: N,
    input: AgentOperationInputMap[N],
  ): Promise<AgentOperationOutputMap[N]>;
}

function connectionFailure(): AgentClientError {
  // Missing socket, refused connection, permission denied and non-socket files
  // all mean the resident app is not reachable.
  return new AgentClientError(AGENT_ERROR_CODES.APP_UNAVAILABLE);
}

function protocolFailure(): AgentClientError {
  return new AgentClientError(AGENT_ERROR_CODES.PROTOCOL_MISMATCH);
}

export function createAgentClient(options: AgentClientOptions = {}): AgentClient {
  const socketPath =
    options.socketPath ??
    resolveAgentSocketPath(options.dataRoot ?? defaultAgentDataRoot());
  const readTimeoutOverrideMs = options.readTimeoutMs;
  const mutationTimeoutMs = options.mutationTimeoutMs ?? AGENT_MUTATION_TIMEOUT_MS;

  function request<N extends AgentOperationName>(
    operation: N,
    input: AgentOperationInputMap[N],
  ): Promise<AgentOperationOutputMap[N]> {
    if (!isAgentOperationName(operation)) {
      return Promise.reject(
        new AgentClientError(AGENT_ERROR_CODES.OPERATION_UNKNOWN),
      );
    }
    const timeoutMs = isAgentMutationOperation(operation)
      ? mutationTimeoutMs
      : resolveAgentReadTimeoutMs(operation, readTimeoutOverrideMs);
    const requestId = randomUUID();
    const frame = `${JSON.stringify({ requestId, operation, input })}\n`;
    if (Buffer.byteLength(frame, "utf8") > AGENT_MAX_REQUEST_BYTES) {
      return Promise.reject(
        new AgentClientError(AGENT_ERROR_CODES.PAYLOAD_TOO_LARGE),
      );
    }

    return new Promise<AgentOperationOutputMap[N]>((resolve, reject) => {
      let settled = false;
      let buffer = "";
      const socket = connect({ path: socketPath });
      const timer = setTimeout(() => {
        finish(() => reject(new AgentClientError(AGENT_ERROR_CODES.REQUEST_TIMEOUT)));
      }, timeoutMs);
      timer.unref?.();

      function finish(action: () => void): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        action();
      }

      socket.setEncoding("utf8");
      socket.once("connect", () => {
        socket.write(`${JSON.stringify({
          protocolVersion: AGENT_PROTOCOL_VERSION,
          ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
        })}\n`);
        socket.write(frame);
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          return;
        }
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let parsedLine: unknown;
        try {
          parsedLine = JSON.parse(line);
        } catch {
          finish(() => reject(protocolFailure()));
          return;
        }
        const response = agentResponseSchema.safeParse(parsedLine);
        if (!response.success || response.data.requestId !== requestId) {
          finish(() => reject(protocolFailure()));
          return;
        }
        if (!response.data.ok) {
          const error = new AgentClientError(
            response.data.error.code,
            response.data.error.issues ?? [],
          );
          finish(() => reject(error));
          return;
        }
        const parsedOutput = agentOperationOutputSchemas[operation].safeParse(
          response.data.data,
        );
        if (!parsedOutput.success) {
          finish(() => reject(protocolFailure()));
          return;
        }
        finish(() =>
          resolve(parsedOutput.data as AgentOperationOutputMap[N]),
        );
      });
      socket.once("error", () => {
        finish(() => reject(connectionFailure()));
      });
      socket.once("close", () => {
        finish(() => reject(protocolFailure()));
      });
    });
  }

  return { socketPath, request };
}

export async function requestAgentOperation<N extends AgentOperationName>(
  operation: N,
  input: AgentOperationInputMap[N],
  options: AgentClientOptions = {},
): Promise<AgentOperationOutputMap[N]> {
  return createAgentClient(options).request(operation, input);
}
