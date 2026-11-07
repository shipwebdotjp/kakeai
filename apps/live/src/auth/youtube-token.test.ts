import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearTokenStore,
  computeAuthExpiresAt,
  loadTokenStore,
  saveTokenStore,
  tokenStoreFromResponse,
  youtubeAuthDir,
  youtubeTokenStorePath,
  YouTubeReauthRequiredError,
  YouTubeTokenProvider,
  type YouTubeTokenStore,
} from "./youtube-token.ts";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const BASE_STORE: YouTubeTokenStore = {
  accessToken: "old-access",
  refreshToken: "refresh-1",
  expiresAt: "2026-11-07T11:00:00.000Z",
  scope: "https://www.googleapis.com/auth/youtube.readonly",
  obtainedAt: "2026-11-07T10:00:00.000Z",
  authExpiresAt: "2026-11-14T10:00:00.000Z",
};

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kakeai-live-auth-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function refreshResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: "new-access",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/youtube.readonly",
      ...overrides,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("YouTube token store", () => {
  it("saves 0600 in a 0700 directory and loads it back", async () => {
    const dataDir = await tempDir();
    await saveTokenStore(dataDir, BASE_STORE);

    const dirMode = (await stat(youtubeAuthDir(dataDir))).mode & 0o777;
    const fileMode = (await stat(youtubeTokenStorePath(dataDir))).mode & 0o777;
    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);

    expect(await loadTokenStore(dataDir)).toEqual(BASE_STORE);
    const raw = await readFile(youtubeTokenStorePath(dataDir), "utf8");
    expect(raw).toContain("refresh-1");
  });

  it("returns null when no token exists, and clears it", async () => {
    const dataDir = await tempDir();
    expect(await loadTokenStore(dataDir)).toBeNull();
    await saveTokenStore(dataDir, BASE_STORE);
    await clearTokenStore(dataDir);
    expect(await loadTokenStore(dataDir)).toBeNull();
  });

  it("derives the 7-day Testing expiry", () => {
    expect(computeAuthExpiresAt(NOW)).toBe("2026-11-14T12:00:00.000Z");
    const store = tokenStoreFromResponse({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: "2026-11-07T13:00:00.000Z",
      obtainedAt: NOW.toISOString(),
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    });
    expect(store.authExpiresAt).toBe("2026-11-14T12:00:00.000Z");
  });
});

describe("YouTubeTokenProvider", () => {
  it("does not refresh a valid token", async () => {
    const dataDir = await tempDir();
    let calls = 0;
    const provider = YouTubeTokenProvider.fromStore(
      {
        dataDir,
        clientId: "client-1",
        clientSecret: "secret-1",
        now: () => NOW,
        fetch: async () => {
          calls += 1;
          return refreshResponse();
        },
      },
      {
        ...BASE_STORE,
        accessToken: "valid-access",
        expiresAt: "2026-11-07T13:00:00.000Z",
      },
    );
    expect(await provider.getAccessToken()).toBe("valid-access");
    expect(calls).toBe(0);
  });

  it("refreshes an expired token and persists it without extending the 7-day auth expiry", async () => {
    const dataDir = await tempDir();
    await saveTokenStore(dataDir, BASE_STORE);
    const bodies: URLSearchParams[] = [];
    const provider = YouTubeTokenProvider.fromStore(
      {
        dataDir,
        clientId: "client-1",
        clientSecret: "secret-1",
        tokenUrl: "https://oauth.test/token",
        now: () => NOW,
        fetch: async (_input, init) => {
          bodies.push(new URLSearchParams(String(init?.body)));
          return refreshResponse();
        },
      },
      BASE_STORE,
    );

    expect(await provider.getAccessToken()).toBe("new-access");
    expect(bodies[0]!.get("grant_type")).toBe("refresh_token");
    expect(bodies[0]!.get("refresh_token")).toBe("refresh-1");

    const saved = await loadTokenStore(dataDir);
    expect(saved).toMatchObject({
      accessToken: "new-access",
      refreshToken: "refresh-1",
      authExpiresAt: "2026-11-14T10:00:00.000Z",
    });
  });

  it("marks needsReauth on invalid_grant", async () => {
    const dataDir = await tempDir();
    const provider = YouTubeTokenProvider.fromStore(
      {
        dataDir,
        clientId: "client-1",
        clientSecret: "secret-1",
        tokenUrl: "https://oauth.test/token",
        now: () => NOW,
        fetch: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      },
      BASE_STORE,
    );

    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(YouTubeReauthRequiredError);
    expect(provider.getAuthState()).toEqual({
      authExpiresAt: "2026-11-14T10:00:00.000Z",
      needsReauth: true,
    });
    await expect(provider.getAccessToken()).rejects.toBeInstanceOf(YouTubeReauthRequiredError);
  });
});
