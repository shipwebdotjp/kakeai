import type { YouTubeAuthProvider } from "../auth/youtube-auth.ts";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const AUTH_RETRY_LIMIT = 1;

export interface YouTubeHttpClientOptions {
  auth: YouTubeAuthProvider;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface YouTubeHttpFailure {
  message: string;
  terminal: boolean;
  authFailure: boolean;
}

interface YouTubeErrorPayload {
  error?: { errors?: Array<{ reason?: unknown }> };
}

async function readErrorReason(response: Response): Promise<string | null> {
  try {
    const payload = (await response.clone().json()) as YouTubeErrorPayload;
    const value = payload.error?.errors?.[0]?.reason;
    return typeof value === "string" ? value : null;
  } catch {
    // The status code is enough for classification and the console.
    return null;
  }
}

/** 401 and the auth/permission/key reasons that can be fixed by OAuth. */
function isAuthFailure(status: number, reason: string | null): boolean {
  if (status === 401) {
    return true;
  }
  if (status === 400) {
    return reason === "keyInvalid" || reason === "API_KEY_INVALID";
  }
  if (status === 403) {
    return (
      reason === "authError" ||
      reason === "forbidden" ||
      reason === "insufficientPermissions" ||
      reason === "keyInvalid" ||
      reason === "API_KEY_INVALID"
    );
  }
  return false;
}

function isTerminalReason(reason: string | null): boolean {
  return (
    reason === "liveChatEnded" ||
    reason === "liveChatNotFound" ||
    reason === "liveChatDisabled"
  );
}

/**
 * Authorized read-only GETs for the YouTube comment source. An API-key request
 * is retried exactly once with the provider's fallback credentials when the
 * API reports an auth/permission error. Every actual request is counted, so a
 * retry consumes quota too.
 */
export class YouTubeHttpClient {
  private readonly auth: YouTubeAuthProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  /** Reuses the reason already read for classification; avoids a second body parse. */
  private readonly failureReasons = new WeakMap<Response, string | null>();

  constructor(options: YouTubeHttpClientOptions) {
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async get(url: URL, countRequest: () => void): Promise<Response> {
    let retries = 0;
    for (;;) {
      const authorized = await this.auth.authorize(url);
      countRequest();
      const response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: authorized.headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
      if (response.ok) {
        return response;
      }
      const reason = await readErrorReason(response);
      this.failureReasons.set(response, reason);
      if (!isAuthFailure(response.status, reason) || retries >= AUTH_RETRY_LIMIT) {
        return response;
      }
      const canRetry = await this.auth.handleAuthFailure();
      if (!canRetry) {
        return response;
      }
      retries += 1;
    }
  }

  async readFailure(
    response: Response,
    label = "コメント",
  ): Promise<YouTubeHttpFailure> {
    const cached = this.failureReasons.get(response);
    const reason = cached === undefined ? await readErrorReason(response) : cached;
    return {
      message: `YouTube の${label}取得に失敗しました (HTTP ${response.status}${reason === null ? "" : `, ${reason}`})。`,
      terminal: isTerminalReason(reason),
      authFailure: isAuthFailure(response.status, reason),
    };
  }
}
