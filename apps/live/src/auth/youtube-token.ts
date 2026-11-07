import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  isInvalidGrantError,
  refreshAccessToken,
  YOUTUBE_READONLY_SCOPE,
  type OAuthClientOptions,
  type OAuthTokenResponse,
} from "./oauth.ts";

export const YOUTUBE_TOKEN_STORE_FILE = "youtube.json";

export const youtubeTokenStoreSchema = z.strictObject({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().datetime(),
  scope: z.string().min(1),
  obtainedAt: z.string().datetime(),
  /** Expiry of the Testing-mode refresh token (obtainedAt + 7 days). */
  authExpiresAt: z.string().datetime(),
});
export type YouTubeTokenStore = z.infer<typeof youtubeTokenStoreSchema>;

export interface YouTubeAuthState {
  authExpiresAt: string | null;
  needsReauth: boolean;
}

export interface YouTubeAccessTokenProvider {
  getAccessToken(): Promise<string>;
  getAuthState(): YouTubeAuthState;
  /** Drops the cached access token so the next read refreshes it (401/403). */
  invalidateAccessToken?(): void;
}

export class YouTubeTokenMissingError extends Error {
  constructor(message = "YouTube の認証情報がありません。`npm run live -- auth --config <file>` を実行してください。") {
    super(message);
    this.name = "YouTubeTokenMissingError";
  }
}

export class YouTubeReauthRequiredError extends Error {
  constructor(message = "YouTube の再認証が必要です。`npm run live -- auth --config <file>` を実行してください。") {
    super(message);
    this.name = "YouTubeReauthRequiredError";
  }
}

const AUTH_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export function computeAuthExpiresAt(obtainedAt: Date): string {
  return new Date(obtainedAt.getTime() + AUTH_TOKEN_LIFETIME_MS).toISOString();
}

export function youtubeAuthDir(dataDir: string): string {
  return join(dataDir, "auth");
}

export function youtubeTokenStorePath(dataDir: string): string {
  return join(youtubeAuthDir(dataDir), YOUTUBE_TOKEN_STORE_FILE);
}

export function tokenStoreFromResponse(response: OAuthTokenResponse): YouTubeTokenStore {
  if (response.refreshToken === null) {
    throw new YouTubeReauthRequiredError(
      "OAuth の応答に refresh_token がありません。再認証してください。",
    );
  }
  return {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: response.expiresAt,
    scope: YOUTUBE_READONLY_SCOPE,
    obtainedAt: response.obtainedAt,
    authExpiresAt: computeAuthExpiresAt(new Date(response.obtainedAt)),
  };
}

export async function loadTokenStore(dataDir: string): Promise<YouTubeTokenStore | null> {
  let text: string;
  try {
    text = await readFile(youtubeTokenStorePath(dataDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("YouTube のトークン保存ファイルが JSON ではありません。再認証してください。");
  }
  const parsed = youtubeTokenStoreSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("YouTube のトークン保存ファイルが不正です。再認証してください。");
  }
  return parsed.data;
}

export async function saveTokenStore(
  dataDir: string,
  store: YouTubeTokenStore,
): Promise<void> {
  const validated = youtubeTokenStoreSchema.parse(store);
  const dir = youtubeAuthDir(dataDir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const path = youtubeTokenStorePath(dataDir);
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await chmod(path, 0o600);
}

export async function clearTokenStore(dataDir: string): Promise<void> {
  await rm(youtubeTokenStorePath(dataDir), { force: true });
}

export interface YouTubeTokenProviderOptions extends OAuthClientOptions {
  dataDir: string;
}

/**
 * Refreshes the access token when it is close to expiry. `invalid_grant` flips
 * the provider into `needsReauth` instead of retrying forever; the console
 * shows that state and the operator runs `live auth` again.
 */
export class YouTubeTokenProvider implements YouTubeAccessTokenProvider {
  private store: YouTubeTokenStore;
  private needsReauth = false;
  private forceRefresh = false;
  private refreshing: Promise<string> | null = null;

  private constructor(
    private readonly options: YouTubeTokenProviderOptions,
    store: YouTubeTokenStore,
  ) {
    this.store = store;
  }

  static async load(options: YouTubeTokenProviderOptions): Promise<YouTubeTokenProvider> {
    const store = await loadTokenStore(options.dataDir);
    if (store === null) {
      throw new YouTubeTokenMissingError();
    }
    return new YouTubeTokenProvider(options, store);
  }

  /** Test seam; production code uses `load`. */
  static fromStore(
    options: YouTubeTokenProviderOptions,
    store: YouTubeTokenStore,
  ): YouTubeTokenProvider {
    return new YouTubeTokenProvider(options, youtubeTokenStoreSchema.parse(store));
  }

  getAuthState(): YouTubeAuthState {
    return {
      authExpiresAt: this.store.authExpiresAt,
      needsReauth: this.needsReauth,
    };
  }

  getStore(): YouTubeTokenStore {
    return { ...this.store };
  }

  invalidateAccessToken(): void {
    this.forceRefresh = true;
  }

  async getAccessToken(): Promise<string> {
    if (this.needsReauth) {
      throw new YouTubeReauthRequiredError();
    }
    if (this.forceRefresh) {
      this.forceRefresh = false;
      return this.refresh();
    }
    const now = this.options.now ?? (() => new Date());
    const expiresAt = Date.parse(this.store.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt - now().getTime() > 60_000) {
      return this.store.accessToken;
    }
    return this.refresh();
  }

  private refresh(): Promise<string> {
    if (this.refreshing !== null) {
      return this.refreshing;
    }
    this.refreshing = this.refreshInternal().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async refreshInternal(): Promise<string> {
    try {
      const response = await refreshAccessToken(
        { refreshToken: this.store.refreshToken },
        this.options,
      );
      const next: YouTubeTokenStore = {
        ...this.store,
        accessToken: response.accessToken,
        refreshToken: response.refreshToken ?? this.store.refreshToken,
        expiresAt: response.expiresAt,
        obtainedAt: response.obtainedAt,
        scope: YOUTUBE_READONLY_SCOPE,
        // Refreshing does not extend the Testing-mode refresh token.
        authExpiresAt: this.store.authExpiresAt,
      };
      await saveTokenStore(this.options.dataDir, next);
      this.store = next;
      return this.store.accessToken;
    } catch (error) {
      if (isInvalidGrantError(error)) {
        this.needsReauth = true;
        throw new YouTubeReauthRequiredError();
      }
      throw error;
    }
  }
}
