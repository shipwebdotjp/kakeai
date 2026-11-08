import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ApiKeyYouTubeAuthProvider,
  createYouTubeAuthProvider,
  OAuthYouTubeAuthProvider,
} from "./youtube-auth.ts";
import {
  YouTubeTokenMissingError,
  type YouTubeAccessTokenProvider,
  type YouTubeTokenStore,
} from "./youtube-token.ts";

const API_KEY = "api-key-secret";
const TOKEN = "access-token-secret";
const AUTH_EXPIRES_AT = "2026-11-14T12:00:00.000Z";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kakeai-live-auth-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function tokenProvider(
  overrides: Partial<YouTubeAccessTokenProvider> = {},
): YouTubeAccessTokenProvider & { store: YouTubeTokenStore } {
  const store: YouTubeTokenStore = {
    accessToken: TOKEN,
    refreshToken: "refresh-token",
    expiresAt: "2026-11-07T13:00:00.000Z",
    scope: "https://www.googleapis.com/auth/youtube.readonly",
    obtainedAt: "2026-11-07T12:00:00.000Z",
    authExpiresAt: AUTH_EXPIRES_AT,
  };
  return {
    store,
    getAccessToken: async () => TOKEN,
    getAuthState: () => ({ authExpiresAt: AUTH_EXPIRES_AT, needsReauth: false }),
    ...overrides,
  };
}

describe("YouTube auth providers", () => {
  it("adds the API key to the query and no Authorization header", async () => {
    const provider = new ApiKeyYouTubeAuthProvider({ apiKey: API_KEY });
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChatMessages");
    const authorized = await provider.authorize(url);

    expect(url.searchParams.get("key")).toBe(API_KEY);
    expect(authorized.headers).toEqual({});
    expect(provider.getAuthState()).toEqual({
      mode: "apiKey",
      authExpiresAt: null,
      needsReauth: false,
      fallbackAvailable: false,
    });
    expect(JSON.stringify(provider.getAuthState())).not.toContain(API_KEY);
  });

  it("adds a bearer token and removes a previous API key", async () => {
    const provider = new OAuthYouTubeAuthProvider(tokenProvider());
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChatMessages");
    url.searchParams.set("key", API_KEY);
    const authorized = await provider.authorize(url);

    expect(url.searchParams.get("key")).toBeNull();
    expect(authorized.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(provider.getAuthState()).toEqual({
      mode: "oauth",
      authExpiresAt: AUTH_EXPIRES_AT,
      needsReauth: false,
      fallbackAvailable: false,
    });
  });

  it("switches to OAuth on the first API-key auth failure", async () => {
    const fallback = new OAuthYouTubeAuthProvider(tokenProvider());
    let loadCalls = 0;
    const provider = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      loadFallback: async () => {
        loadCalls += 1;
        return fallback;
      },
    });

    expect(provider.getAuthState()).toMatchObject({
      mode: "apiKey",
      fallbackAvailable: true,
      authExpiresAt: null,
    });
    expect(loadCalls).toBe(0);

    expect(await provider.handleAuthFailure()).toBe(true);
    expect(loadCalls).toBe(1);
    expect(provider.getAuthState()).toMatchObject({
      mode: "oauth",
      fallbackAvailable: true,
      authExpiresAt: AUTH_EXPIRES_AT,
      needsReauth: false,
    });

    const url = new URL("https://www.googleapis.com/youtube/v3/liveChatMessages");
    url.searchParams.set("key", API_KEY);
    const authorized = await provider.authorize(url);
    expect(url.searchParams.get("key")).toBeNull();
    expect(authorized.headers.Authorization).toBe(`Bearer ${TOKEN}`);

    // The lazy OAuth load is reused, not repeated.
    expect(await provider.handleAuthFailure()).toBe(true);
    expect(loadCalls).toBe(1);
  });

  it("reports fallback unavailable when no token is saved", async () => {
    const provider = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      loadFallback: async () => {
        throw new YouTubeTokenMissingError();
      },
    });

    expect(await provider.handleAuthFailure()).toBe(false);
    expect(provider.getAuthState()).toMatchObject({
      mode: "apiKey",
      fallbackAvailable: true,
    });
  });

  it("can load the fallback later after live auth saves a token", async () => {
    const fallback = new OAuthYouTubeAuthProvider(tokenProvider());
    let loadCalls = 0;
    const provider = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      loadFallback: async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          throw new YouTubeTokenMissingError();
        }
        return fallback;
      },
    });

    expect(await provider.handleAuthFailure()).toBe(false);
    expect(provider.getAuthState().mode).toBe("apiKey");
    expect(await provider.handleAuthFailure()).toBe(true);
    expect(provider.getAuthState().mode).toBe("oauth");
    expect(loadCalls).toBe(2);
  });

  it("does not fall back when OAuth already needs reauthentication", async () => {
    const provider = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      loadFallback: async () =>
        new OAuthYouTubeAuthProvider(
          tokenProvider({
            getAuthState: () => ({ authExpiresAt: AUTH_EXPIRES_AT, needsReauth: true }),
          }),
        ),
    });

    expect(await provider.handleAuthFailure()).toBe(false);
    expect(provider.getAuthState().mode).toBe("apiKey");
  });

  it("does not fall back when the OAuth token expiry has passed", async () => {
    const provider = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      now: () => new Date("2026-11-15T00:00:00.000Z"),
      loadFallback: async () => new OAuthYouTubeAuthProvider(tokenProvider()),
    });

    expect(await provider.handleAuthFailure()).toBe(false);
    expect(provider.getAuthState().mode).toBe("apiKey");
  });

  it("does not fall back when the OAuth expiry is unparseable", async () => {
    const provider = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      loadFallback: async () =>
        new OAuthYouTubeAuthProvider(
          tokenProvider({
            getAuthState: () => ({ authExpiresAt: "not-a-date", needsReauth: false }),
          }),
        ),
    });

    expect(await provider.handleAuthFailure()).toBe(false);
    expect(provider.getAuthState().mode).toBe("apiKey");
  });

  it("invalidates the cached OAuth token on auth failure", async () => {
    let invalidated = 0;
    const provider = new OAuthYouTubeAuthProvider(
      tokenProvider({
        invalidateAccessToken: () => {
          invalidated += 1;
        },
      }),
    );

    expect(await provider.handleAuthFailure()).toBe(true);
    expect(invalidated).toBe(1);
    provider.invalidate();
    expect(invalidated).toBe(2);
  });

  it("creates an API-key provider with an OAuth fallback from config values", async () => {
    const provider = await createYouTubeAuthProvider({
      apiKey: API_KEY,
      clientId: "client",
      clientSecret: "secret",
      dataDir: "/tmp/unused",
    });
    expect(provider.getAuthState()).toMatchObject({
      mode: "apiKey",
      fallbackAvailable: true,
    });
  });

  it("creates an API-key-only provider without OAuth", async () => {
    const provider = await createYouTubeAuthProvider({
      apiKey: API_KEY,
      dataDir: "/tmp/unused",
    });
    expect(provider.getAuthState()).toMatchObject({
      mode: "apiKey",
      fallbackAvailable: false,
    });
  });

  it("requires a saved token for an OAuth-only provider", async () => {
    const dataDir = await tempDir();
    await expect(
      createYouTubeAuthProvider({
        clientId: "client",
        clientSecret: "secret",
        dataDir,
      }),
    ).rejects.toBeInstanceOf(YouTubeTokenMissingError);
  });

  it("rejects provider creation without any credentials", async () => {
    await expect(
      createYouTubeAuthProvider({ dataDir: "/tmp/unused" }),
    ).rejects.toThrow(/apiKey/);
  });

  it("rejects a one-sided OAuth client pair even with an API key", async () => {
    await expect(
      createYouTubeAuthProvider({
        apiKey: API_KEY,
        clientId: "client",
        dataDir: "/tmp/unused",
      }),
    ).rejects.toThrow(/clientSecret/);
  });
});
