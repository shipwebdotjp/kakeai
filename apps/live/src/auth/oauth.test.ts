import { describe, expect, it } from "vitest";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  isInvalidGrantError,
  OAuthTokenError,
  refreshAccessToken,
  runLoopbackOAuthFlow,
  YOUTUBE_READONLY_SCOPE,
} from "./oauth.ts";

const NOW = new Date("2026-11-07T12:00:00.000Z");

function tokenResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: "access-1",
      refresh_token: "refresh-1",
      expires_in: 3600,
      scope: YOUTUBE_READONLY_SCOPE,
      ...overrides,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("YouTube OAuth", () => {
  it("builds an authorization URL with the readonly scope only", () => {
    const raw = buildAuthorizationUrl({
      clientId: "client-1",
      redirectUri: "http://127.0.0.1:5555/callback",
      state: "state-1",
      codeChallenge: "challenge-1",
    });
    const url = new URL(raw);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.getAll("scope")).toEqual([YOUTUBE_READONLY_SCOPE]);
    expect(raw).not.toContain("youtube.force-ssl");
    expect(raw).not.toContain("youtube.upload");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges an authorization code with PKCE", async () => {
    const requests: { url: string; body: URLSearchParams }[] = [];
    const token = await exchangeAuthorizationCode(
      {
        code: "code-1",
        redirectUri: "http://127.0.0.1:5555/callback",
        codeVerifier: "verifier-1",
      },
      {
        clientId: "client-1",
        clientSecret: "secret-1",
        tokenUrl: "https://oauth.test/token",
        now: () => NOW,
        fetch: async (input, init) => {
          requests.push({ url: String(input), body: new URLSearchParams(String(init?.body)) });
          return tokenResponse();
        },
      },
    );
    expect(token).toEqual({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: "2026-11-07T13:00:00.000Z",
      obtainedAt: "2026-11-07T12:00:00.000Z",
      scope: YOUTUBE_READONLY_SCOPE,
    });
    expect(requests[0]!.url).toBe("https://oauth.test/token");
    expect(requests[0]!.body.get("grant_type")).toBe("authorization_code");
    expect(requests[0]!.body.get("code_verifier")).toBe("verifier-1");
  });

  it("surfaces invalid_grant from refresh", async () => {
    const error = await refreshAccessToken(
      { refreshToken: "refresh-1" },
      {
        clientId: "client-1",
        clientSecret: "secret-1",
        tokenUrl: "https://oauth.test/token",
        fetch: async () =>
          new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(OAuthTokenError);
    expect(isInvalidGrantError(error)).toBe(true);
  });

  it("runs the loopback callback and saves nothing itself", async () => {
    let authorizationUrl: string | null = null;
    const token = await runLoopbackOAuthFlow({
      clientId: "client-1",
      clientSecret: "secret-1",
      tokenUrl: "https://oauth.test/token",
      now: () => NOW,
      flowTimeoutMs: 5_000,
      fetch: async () => tokenResponse(),
      onAuthorizationUrl: async (url) => {
        authorizationUrl = url;
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get("redirect_uri")!;
        const state = parsed.searchParams.get("state")!;
        const response = await globalThis.fetch(
          `${redirect}?code=code-1&state=${encodeURIComponent(state)}`,
        );
        expect(response.status).toBe(200);
      },
    });
    expect(authorizationUrl).not.toBeNull();
    expect(token.accessToken).toBe("access-1");
  });

  it("ignores a stray callback and still accepts the valid one", async () => {
    const token = await runLoopbackOAuthFlow({
      clientId: "client-1",
      clientSecret: "secret-1",
      tokenUrl: "https://oauth.test/token",
      flowTimeoutMs: 5_000,
      fetch: async () => tokenResponse(),
      onAuthorizationUrl: async (url) => {
        const parsed = new URL(url);
        const redirect = parsed.searchParams.get("redirect_uri")!;
        const state = parsed.searchParams.get("state")!;
        const stray = await globalThis.fetch(`${redirect}?code=code-1&state=wrong`);
        expect(stray.status).toBe(400);
        const valid = await globalThis.fetch(
          `${redirect}?code=code-1&state=${encodeURIComponent(state)}`,
        );
        expect(valid.status).toBe(200);
      },
    });
    expect(token.accessToken).toBe("access-1");
  });
});
