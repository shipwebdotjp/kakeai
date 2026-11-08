import {
  YouTubeTokenProvider,
  type YouTubeAccessTokenProvider,
  type YouTubeTokenProviderOptions,
} from "./youtube-token.ts";

export type YouTubeAuthMode = "apiKey" | "oauth";

/**
 * Console-facing authentication state. It never contains the API key or an
 * access token; only the mode and the OAuth expiry are exposed.
 */
export interface YouTubeAuthState {
  mode: YouTubeAuthMode;
  authExpiresAt: string | null;
  needsReauth: boolean;
  fallbackAvailable: boolean;
}

export interface YouTubeAuthProvider {
  getAuthState(): YouTubeAuthState;
  /** Adds either `key=<apiKey>` or `Authorization: Bearer <token>` to the request. */
  authorize(url: URL): Promise<{ headers: Record<string, string> }>;
  /** Called after a 401/403 auth/permission failure. Returns true when a retry with new credentials is possible. */
  handleAuthFailure(): Promise<boolean>;
  /** Invalidates a cached OAuth access token (for 401 refresh). */
  invalidate?(): void;
}

/** OAuth-only provider. Used when no API key is configured and as the fallback. */
export class OAuthYouTubeAuthProvider implements YouTubeAuthProvider {
  constructor(private readonly tokenProvider: YouTubeAccessTokenProvider) {}

  static async load(options: YouTubeTokenProviderOptions): Promise<OAuthYouTubeAuthProvider> {
    return new OAuthYouTubeAuthProvider(await YouTubeTokenProvider.load(options));
  }

  getAuthState(): YouTubeAuthState {
    const state = this.tokenProvider.getAuthState();
    return {
      mode: "oauth",
      authExpiresAt: state.authExpiresAt,
      needsReauth: state.needsReauth,
      fallbackAvailable: false,
    };
  }

  async authorize(url: URL): Promise<{ headers: Record<string, string> }> {
    const token = await this.tokenProvider.getAccessToken();
    // A retried API-key request still carries `key=` in its URL. Remove it so
    // the request is authenticated only by the bearer token.
    url.searchParams.delete("key");
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  async handleAuthFailure(): Promise<boolean> {
    this.tokenProvider.invalidateAccessToken?.();
    return true;
  }

  invalidate(): void {
    this.tokenProvider.invalidateAccessToken?.();
  }
}

export interface OAuthFallbackOptions {
  clientId: string;
  clientSecret: string;
  dataDir: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface ApiKeyYouTubeAuthProviderOptions {
  apiKey: string;
  /** OAuth client and token store used only after an API-key auth failure. */
  fallback?: OAuthFallbackOptions;
  /** Test seam; wins over `fallback` when set. */
  loadFallback?: () => Promise<YouTubeAuthProvider>;
  now?: () => Date;
}

/**
 * API-key-first provider. The OAuth token store is read lazily on the first
 * auth failure so a normal public-chat run never touches OAuth state. Once the
 * fallback is selected, later requests use OAuth until the process exits.
 */
export class ApiKeyYouTubeAuthProvider implements YouTubeAuthProvider {
  private mode: YouTubeAuthMode = "apiKey";
  private oauth: YouTubeAuthProvider | null = null;
  private fallbackLoad: Promise<YouTubeAuthProvider | null> | null = null;
  private readonly now: () => Date;

  constructor(private readonly options: ApiKeyYouTubeAuthProviderOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private get hasFallback(): boolean {
    return this.options.fallback !== undefined || this.options.loadFallback !== undefined;
  }

  getAuthState(): YouTubeAuthState {
    if (this.mode === "oauth" && this.oauth !== null) {
      const state = this.oauth.getAuthState();
      return {
        mode: "oauth",
        authExpiresAt: state.authExpiresAt,
        needsReauth: state.needsReauth,
        fallbackAvailable: this.hasFallback,
      };
    }
    return {
      mode: "apiKey",
      authExpiresAt: null,
      needsReauth: false,
      fallbackAvailable: this.hasFallback,
    };
  }

  async authorize(url: URL): Promise<{ headers: Record<string, string> }> {
    if (this.mode === "oauth") {
      if (this.oauth === null) {
        throw new Error("OAuth フォールバックの認証情報がありません。");
      }
      return this.oauth.authorize(url);
    }
    url.searchParams.set("key", this.options.apiKey);
    return { headers: {} };
  }

  async handleAuthFailure(): Promise<boolean> {
    if (this.mode === "oauth" && this.oauth !== null) {
      return this.oauth.handleAuthFailure();
    }
    if (!this.hasFallback) {
      return false;
    }
    if (this.fallbackLoad === null) {
      this.fallbackLoad = this.loadOAuthFallback();
    }
    const provider = await this.fallbackLoad;
    if (provider === null) {
      // Allow a later auth failure to retry after the operator runs `live auth`.
      this.fallbackLoad = null;
      return false;
    }
    this.oauth = provider;
    this.mode = "oauth";
    return true;
  }

  invalidate(): void {
    this.oauth?.invalidate?.();
  }

  private async loadOAuthFallback(): Promise<YouTubeAuthProvider | null> {
    try {
      const provider =
        this.options.loadFallback !== undefined
          ? await this.options.loadFallback()
          : await OAuthYouTubeAuthProvider.load(this.options.fallback!);
      const state = provider.getAuthState();
      if (state.needsReauth) {
        return null;
      }
      if (state.authExpiresAt !== null) {
        const expiresAt = Date.parse(state.authExpiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime()) {
          return null;
        }
      }
      return provider;
    } catch {
      // A missing or unreadable token store means OAuth is not available. The
      // caller keeps the original API-key failure; no secret is surfaced.
      return null;
    }
  }
}

export interface CreateYouTubeAuthProviderOptions {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  dataDir: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

export async function createYouTubeAuthProvider(
  options: CreateYouTubeAuthProviderOptions,
): Promise<YouTubeAuthProvider> {
  const hasClientId = options.clientId !== undefined;
  const hasClientSecret = options.clientSecret !== undefined;
  if (hasClientId !== hasClientSecret) {
    throw new Error(
      "OAuth フォールバックには clientId と clientSecret の両方が必要です。",
    );
  }
  const fallback =
    options.clientId !== undefined && options.clientSecret !== undefined
      ? {
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          dataDir: options.dataDir,
          ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
          ...(options.now === undefined ? {} : { now: options.now }),
        }
      : undefined;

  if (options.apiKey !== undefined) {
    return new ApiKeyYouTubeAuthProvider({
      apiKey: options.apiKey,
      ...(fallback === undefined ? {} : { fallback }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  if (options.clientId === undefined || options.clientSecret === undefined) {
    throw new Error(
      "YouTube の認証設定がありません。apiKey、または clientId と clientSecret を指定してください。",
    );
  }
  return OAuthYouTubeAuthProvider.load({
    dataDir: options.dataDir,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
