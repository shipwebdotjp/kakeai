import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const GOOGLE_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export class OAuthTokenError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly status: number | null = null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "OAuthTokenError";
  }
}

export function isInvalidGrantError(error: unknown): boolean {
  return error instanceof OAuthTokenError && error.code === "invalid_grant";
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
  obtainedAt: string;
  scope: string;
}

export interface OAuthClientOptions {
  clientId: string;
  clientSecret: string;
  tokenUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export interface BuildAuthorizationUrlOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}

/**
 * Builds the consent URL with the read-only scope only. Callers cannot widen
 * the scope: the live app never requests write access to YouTube.
 */
export function buildAuthorizationUrl(options: BuildAuthorizationUrlOptions): string {
  const url = new URL(GOOGLE_AUTHORIZATION_URL);
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_READONLY_SCOPE);
  url.searchParams.set("state", options.state);
  url.searchParams.set("access_type", "offline");
  // Force a refresh token even after a previous authorization.
  url.searchParams.set("prompt", "consent");
  if (options.codeChallenge !== undefined) {
    url.searchParams.set("code_challenge", options.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

interface TokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

async function postToken(
  body: URLSearchParams,
  options: OAuthClientOptions,
): Promise<OAuthTokenResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  let response: Response;
  try {
    response = await fetchImpl(options.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
  } catch (error) {
    throw new OAuthTokenError(
      "OAuth トークンエンドポイントに接続できません。",
      null,
      null,
      { cause: error },
    );
  }

  let payload: TokenPayload;
  try {
    payload = (await response.json()) as TokenPayload;
  } catch {
    throw new OAuthTokenError("OAuth トークンエンドポイントの応答を読めません。", null, response.status);
  }

  if (!response.ok) {
    const code = typeof payload.error === "string" ? payload.error : null;
    const description =
      typeof payload.error_description === "string" ? payload.error_description : null;
    throw new OAuthTokenError(
      description ?? code ?? `OAuth トークン取得に失敗しました (HTTP ${response.status})。`,
      code,
      response.status,
    );
  }
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new OAuthTokenError("OAuth のアクセストークンが空です。", null, response.status);
  }
  const parsedExpiresIn = Number(payload.expires_in);
  const expiresIn =
    Number.isFinite(parsedExpiresIn) && parsedExpiresIn > 0 ? parsedExpiresIn : 3600;
  const obtainedAt = now();
  return {
    accessToken: payload.access_token,
    refreshToken:
      typeof payload.refresh_token === "string" && payload.refresh_token.length > 0
        ? payload.refresh_token
        : null,
    expiresAt: new Date(obtainedAt.getTime() + expiresIn * 1000).toISOString(),
    obtainedAt: obtainedAt.toISOString(),
    scope:
      typeof payload.scope === "string" && payload.scope.length > 0
        ? payload.scope
        : YOUTUBE_READONLY_SCOPE,
  };
}

export interface ExchangeAuthorizationCodeInput {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export async function exchangeAuthorizationCode(
  input: ExchangeAuthorizationCodeInput,
  options: OAuthClientOptions,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });
  if (input.codeVerifier !== undefined) {
    body.set("code_verifier", input.codeVerifier);
  }
  return postToken(body, options);
}

export interface RefreshAccessTokenInput {
  refreshToken: string;
}

export async function refreshAccessToken(
  input: RefreshAccessTokenInput,
  options: OAuthClientOptions,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });
  return postToken(body, options);
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export interface RunLoopbackOAuthOptions extends OAuthClientOptions {
  /** Called with the consent URL; the CLI prints it for the operator. */
  onAuthorizationUrl?: (url: string) => void | Promise<void>;
  /** Whole-flow timeout, including the browser round trip. */
  flowTimeoutMs?: number;
}

const SUCCESS_HTML =
  "<!doctype html><meta charset=\"utf-8\"><title>Kakeai Live</title><p>認証が完了しました。このタブを閉じてください。</p>";

function respond(res: ServerResponse, status: number, body: string): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Connection", "close");
  res.end(body);
}

/**
 * Runs the installed-app loopback flow on 127.0.0.1 with a random port and
 * PKCE. The network exchange is the same pure function tested with an injected
 * fetch; only the listener and browser hand-off live here.
 */
export async function runLoopbackOAuthFlow(
  options: RunLoopbackOAuthOptions,
): Promise<OAuthTokenResponse> {
  const state = randomBytes(16).toString("hex");
  const pkce = createPkcePair();
  const server = createServer();
  let settleFail: ((error: unknown) => void) | null = null;
  let callbackUrl = "";
  let settled = false;

  const flow = new Promise<OAuthTokenResponse>((resolve, reject) => {
    const finish = (token: OAuthTokenResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(token);
    };
    const fail = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    settleFail = fail;

    const handle = async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== "GET") {
        respond(res, 405, "method not allowed");
        return;
      }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/callback") {
        respond(res, 404, "not found");
        return;
      }
      const oauthError = url.searchParams.get("error");
      if (oauthError !== null) {
        respond(res, 400, "認証がキャンセルされました。");
        fail(new OAuthTokenError("認証がキャンセルされました。", oauthError));
        return;
      }
      if (url.searchParams.get("state") !== state) {
        // Ignore stray loopback requests (scanner, double navigation) instead
        // of aborting a valid browser flow that may still be in progress.
        respond(res, 400, "認証リクエストを確認できませんでした。");
        return;
      }
      const code = url.searchParams.get("code");
      if (code === null || code.length === 0) {
        respond(res, 400, "認証コードがありません。");
        return;
      }
      try {
        const token = await exchangeAuthorizationCode(
          { code, redirectUri: callbackUrl, codeVerifier: pkce.verifier },
          options,
        );
        respond(res, 200, SUCCESS_HTML);
        finish(token);
      } catch (error) {
        respond(res, 500, "認証に失敗しました。");
        fail(error);
      }
    };

    server.on("request", (req, res) => {
      handle(req, res).catch(() => {
        try {
          respond(res, 400, "bad request");
        } catch {
          // The socket may already be closed.
        }
      });
    });
    server.once("error", (error) => {
      fail(error);
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        fail(new Error("OAuth コールバックのポートを取得できません。"));
        return;
      }
      callbackUrl = `http://127.0.0.1:${address.port}/callback`;
      const authUrl = buildAuthorizationUrl({
        clientId: options.clientId,
        redirectUri: callbackUrl,
        state,
        codeChallenge: pkce.challenge,
      });
      void Promise.resolve()
        .then(() => options.onAuthorizationUrl?.(authUrl))
        .catch(fail);
    });
  });

  const timeout = setTimeout(() => {
    settleFail?.(new OAuthTokenError("OAuth 認証がタイムアウトしました。", "timeout"));
  }, options.flowTimeoutMs ?? 300_000);

  try {
    return await flow;
  } finally {
    clearTimeout(timeout);
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      const closeTimer = setTimeout(resolve, 5_000);
      server.close(() => {
        clearTimeout(closeTimer);
        resolve();
      });
    });
  }
}
