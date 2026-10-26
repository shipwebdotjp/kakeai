import { z } from "zod";
import { errorCodeSchema } from "../error";
import { SCRIPT_EDIT_ERROR_CODES } from "../script-operation";

/** Version of the local socket request/response envelope. */

export const AGENT_PROTOCOL_VERSION = 1 as const;

/**
 * Oldest protocol version this build still accepts. A handshake is accepted
 * when its version is inside `[AGENT_PROTOCOL_MIN_VERSION,
 * AGENT_PROTOCOL_VERSION]`. The range exists so a future breaking change can
 * raise the maximum while old clients are still told which minimum they need;
 * a compatible addition never moves either bound.
 */
export const AGENT_PROTOCOL_MIN_VERSION = 1 as const;

/**
 * True when `version` is a protocol version this build can talk. Used by the
 * local socket handshake and by clients that want to fail early.
 */
export function isAgentProtocolVersionSupported(version: number): boolean {
  return (
    Number.isInteger(version) &&
    version >= AGENT_PROTOCOL_MIN_VERSION &&
    version <= AGENT_PROTOCOL_VERSION
  );
}

/** Directory (under the app data root) that holds the local control socket. */
export const AGENT_SOCKET_DIRECTORY = "agent" as const;
export const AGENT_SOCKET_FILENAME = "agent.sock" as const;

/** One NDJSON request may not exceed this size, including the trailing newline. */
export const AGENT_MAX_REQUEST_BYTES = 32 * 1024 * 1024;
/** Timeouts shared by the client and the resident server. */
export const AGENT_READ_TIMEOUT_MS = 10_000;
/**
 * Image previews compile a composition, wait for assets/fonts and rasterize a
 * frame. Typical calls finish in about a second, but a long script with many
 * video stills may take longer than the standard read budget. The extension is
 * limited to image-returning operations.
 */
export const AGENT_PREVIEW_READ_TIMEOUT_MS = 30_000;
/** Byte budget for an asset image before base64 expansion. */
export const AGENT_PREVIEW_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
/** Base64 length budget (4/3 expansion plus padding). */
export const AGENT_PREVIEW_IMAGE_BASE64_MAX =
  Math.ceil((AGENT_PREVIEW_IMAGE_MAX_BYTES * 4) / 3) + 16;
export const AGENT_MUTATION_TIMEOUT_MS = 120_000;
/** A connection that sends nothing for this long is closed by the server. */
export const AGENT_IDLE_TIMEOUT_MS = 300_000;

/**
 * Maximum number of request frames one connection may hold unprocessed. A
 * frame received while the limit is reached is not executed: it is answered
 * with `AGENT_BACKPRESSURE` and skipped, and the connection stays open.
 */
export const AGENT_MAX_PENDING_FRAMES_PER_CONNECTION = 64;

/**
 * Maximum number of concurrent connections the local control socket accepts.
 * A connection above the cap is closed before the handshake.
 */
export const AGENT_MAX_CONNECTIONS = 16;

export function agentSocketPath(dataRoot: string): string {
  const normalized = dataRoot.replace(/[\\/]+$/u, "");
  // Keep the separator style of the caller's platform path without importing
  // `node:path` into a module that is also bundled for the browser.
  const separator = normalized.includes("\\") ? "\\" : "/";
  return `${normalized}${separator}${AGENT_SOCKET_DIRECTORY}${separator}${AGENT_SOCKET_FILENAME}`;
}

/**
 * Error codes that cross the Agent Access binding boundary. Operation-core
 * errors are included here so MCP, CLI and the local socket share one list.
 */
export const AGENT_ERROR_CODES = {
  ...SCRIPT_EDIT_ERROR_CODES,
  APP_UNAVAILABLE: "AGENT_APP_UNAVAILABLE",
  PROTOCOL_MISMATCH: "AGENT_PROTOCOL_MISMATCH",
  OPERATION_UNKNOWN: "AGENT_OPERATION_UNKNOWN",
  PAYLOAD_TOO_LARGE: "AGENT_PAYLOAD_TOO_LARGE",
  REQUEST_TIMEOUT: "AGENT_REQUEST_TIMEOUT",
  /**
   * The connection already holds the maximum number of unprocessed request
   * frames. The frame is skipped instead of executed, and the connection
   * stays open so the client can slow down and retry.
   */
  BACKPRESSURE: "AGENT_BACKPRESSURE",
  SCRIPT_BASE_STALE: "SCRIPT_BASE_STALE",
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  IDEMPOTENCY_IN_PROGRESS: "AGENT_IDEMPOTENCY_IN_PROGRESS",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  ASSET_UNAVAILABLE: "ASSET_UNAVAILABLE",
  COMPOSITION_UNAVAILABLE: "COMPOSITION_UNAVAILABLE",
  WORK_NOT_FOUND: "WORK_NOT_FOUND",
} as const;

export type AgentSpecificErrorCode =
  (typeof AGENT_ERROR_CODES)[keyof typeof AGENT_ERROR_CODES];

export const agentSpecificErrorCodeSchema = z.enum(
  Object.values(AGENT_ERROR_CODES) as [
    AgentSpecificErrorCode,
    ...AgentSpecificErrorCode[],
  ],
);

/**
 * Wire errors accept the Agent Access codes plus the stable HTTP API codes, so
 * a service error keeps its meaning instead of collapsing into INTERNAL_ERROR.
 */
export const agentErrorCodeSchema = z.union([
  agentSpecificErrorCodeSchema,
  errorCodeSchema,
]);
export type AgentErrorCode = z.infer<typeof agentErrorCodeSchema>;

export function isAgentErrorCode(value: string): value is AgentErrorCode {
  return agentErrorCodeSchema.safeParse(value).success;
}

export const agentErrorIssueSchema = z.strictObject({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string().min(1),
  message: z.string(),
});
export type AgentErrorIssue = z.infer<typeof agentErrorIssueSchema>;

export const agentErrorSchema = z.strictObject({
  code: agentErrorCodeSchema,
  issues: z.array(agentErrorIssueSchema).optional(),
});
export type AgentError = z.infer<typeof agentErrorSchema>;
