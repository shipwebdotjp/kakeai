import type { CommentEvent } from "@kakeai/contracts";
import { describe, expect, it } from "vitest";
import {
  ApiKeyYouTubeAuthProvider,
  OAuthYouTubeAuthProvider,
  type YouTubeAuthProvider,
} from "../auth/youtube-auth.ts";
import type { YouTubeAccessTokenProvider } from "../auth/youtube-token.ts";
import { FakeCommentScheduler, flushMicrotasks } from "../testing/fake-scheduler.ts";
import {
  parseYouTubeVideoId,
  YouTubeCommentSource,
  type YouTubeCommentSourceOptions,
} from "./youtube-source.ts";

const BASE_TIME = Date.parse("2026-11-07T12:00:00.000Z");
const TOKEN = "access-token";
const AUTH_EXPIRES_AT = "2026-11-14T12:00:00.000Z";
const API_KEY = "api-key-1";

interface RecordedCall {
  url: URL;
  method: string;
  headers: Record<string, string>;
}

type Route = (url: URL) => Response | Promise<Response>;

function fakeTokenProvider(
  overrides: Partial<YouTubeAccessTokenProvider> = {},
): YouTubeAccessTokenProvider {
  return {
    getAccessToken: async () => TOKEN,
    getAuthState: () => ({ authExpiresAt: AUTH_EXPIRES_AT, needsReauth: false }),
    ...overrides,
  };
}

function oauthAuth(overrides: Partial<YouTubeAuthProvider> = {}): YouTubeAuthProvider {
  return {
    getAuthState: () => ({
      mode: "oauth",
      authExpiresAt: AUTH_EXPIRES_AT,
      needsReauth: false,
      fallbackAvailable: false,
    }),
    authorize: async () => ({ headers: { Authorization: `Bearer ${TOKEN}` } }),
    handleAuthFailure: async () => false,
    ...overrides,
  };
}

function apiKeyAuth(): YouTubeAuthProvider {
  return {
    getAuthState: () => ({
      mode: "apiKey",
      authExpiresAt: null,
      needsReauth: false,
      fallbackAvailable: false,
    }),
    authorize: async (url) => {
      url.searchParams.set("key", API_KEY);
      return { headers: {} };
    },
    handleAuthFailure: async () => false,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(options: {
  route: Route;
  sourceOptions?: Partial<YouTubeCommentSourceOptions>;
}) {
  const scheduler = new FakeCommentScheduler();
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    for (const [key, value] of Object.entries(rawHeaders)) {
      headers[key.toLowerCase()] = value;
    }
    calls.push({ url, method: init?.method ?? "GET", headers });
    return options.route(url);
  };
  const hasChatSelector =
    options.sourceOptions?.liveChatId !== undefined || options.sourceOptions?.videoUrl !== undefined;
  const source = new YouTubeCommentSource({
    auth: oauthAuth(),
    apiBaseUrl: "https://youtube.test/youtube/v3",
    scheduler,
    now: () => new Date(BASE_TIME + scheduler.currentTimeMs),
    fetch: fetchImpl,
    ...(hasChatSelector ? {} : { liveChatId: "chat-1" }),
    ...options.sourceOptions,
  });
  const received: CommentEvent[] = [];
  source.onComment((comment) => received.push(comment));
  return { scheduler, calls, source, received };
}

describe("YouTubeCommentSource", () => {
  it("parses supported YouTube URL forms", () => {
    expect(parseYouTubeVideoId("https://www.youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
    expect(parseYouTubeVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
    expect(parseYouTubeVideoId("https://www.youtube.com/live/abcdefghijk")).toBe("abcdefghijk");
    expect(parseYouTubeVideoId("https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
    expect(parseYouTubeVideoId("abcdefghijk")).toBe("abcdefghijk");
    expect(parseYouTubeVideoId("https://example.com/watch?v=abcdefghijk")).toBeNull();
    expect(parseYouTubeVideoId("not a url")).toBeNull();
  });

  it("resolves the live chat from a video URL and maps comment kinds", async () => {
    const { source, received, calls, scheduler } = setup({
      route: (url) => {
        if (url.pathname.endsWith("/videos")) {
          return jsonResponse({
            items: [{ liveStreamingDetails: { activeLiveChatId: "chat-1" } }],
          });
        }
        return jsonResponse({
          items: [
            {
              id: "yt-1",
              snippet: {
                type: "textMessageEvent",
                displayMessage: "こんにちは",
                publishedAt: "2026-11-07T12:00:01.000Z",
              },
              authorDetails: { displayName: "みかん" },
            },
            {
              id: "yt-2",
              snippet: { type: "superChatEvent", displayMessage: "応援", publishedAt: "2026-11-07T12:00:02.000Z" },
              authorDetails: { displayName: "ゆず" },
            },
            {
              id: "yt-3",
              snippet: { type: "newSponsorEvent", displayMessage: "加入", publishedAt: "2026-11-07T12:00:03.000Z" },
              authorDetails: { displayName: "もも" },
            },
            {
              id: "yt-4",
              snippet: { type: "messageDeletedEvent", displayMessage: "削除", publishedAt: "2026-11-07T12:00:04.000Z" },
            },
          ],
          nextPageToken: "page-2",
          pollingIntervalMillis: 7_000,
        });
      },
      sourceOptions: { videoUrl: "https://www.youtube.com/watch?v=abcdefghijk" },
    });

    await source.start();

    expect(calls.map((call) => call.url.pathname)).toEqual([
      "/youtube/v3/videos",
      "/youtube/v3/liveChatMessages",
    ]);
    expect(calls[0]!.url.searchParams.get("part")).toBe("liveStreamingDetails");
    expect(calls[0]!.url.searchParams.get("id")).toBe("abcdefghijk");
    expect(calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[1]!.url.searchParams.get("liveChatId")).toBe("chat-1");
    expect(calls[1]!.url.searchParams.get("part")).toBe("snippet,authorDetails");
    expect(calls[1]!.url.searchParams.get("maxResults")).toBe("200");

    expect(received.map((comment) => comment.kind)).toEqual(["normal", "superchat", "member"]);
    expect(received[0]).toMatchObject({ id: "yt-1", authorName: "みかん", text: "こんにちは" });

    const status = source.getStatus();
    expect(status).toMatchObject({
      kind: "youtube",
      state: "polling",
      liveChatId: "chat-1",
      pollingIntervalMs: 7_000,
      authMode: "oauth",
      fallbackAvailable: false,
      authExpiresAt: AUTH_EXPIRES_AT,
      needsReauth: false,
    });
    expect(status.quota).toMatchObject({ requests: 2, units: 6 });
    expect(status.lastPolledAt).toBe(new Date(BASE_TIME).toISOString());
    expect(scheduler.pendingDelaysMs).toEqual([7_000]);
  });

  it("reads both endpoints with an API key and no Authorization header", async () => {
    const { source, calls, received } = setup({
      route: (url) =>
        url.pathname.endsWith("/videos")
          ? jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat-1" } }] })
          : jsonResponse({
              items: [
                {
                  id: "yt-1",
                  snippet: { type: "textMessageEvent", displayMessage: "こんにちは" },
                  authorDetails: { displayName: "みかん" },
                },
              ],
              pollingIntervalMillis: 5_000,
            }),
      sourceOptions: {
        auth: apiKeyAuth(),
        videoUrl: "https://youtu.be/abcdefghijk",
      },
    });

    await source.start();

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.searchParams.get("key")).toBe(API_KEY);
      expect(call.headers.authorization).toBeUndefined();
    }
    expect(received.map((comment) => comment.id)).toEqual(["yt-1"]);
    expect(source.getStatus()).toMatchObject({
      state: "polling",
      authMode: "apiKey",
      fallbackAvailable: false,
      authExpiresAt: null,
      needsReauth: false,
    });
  });

  it("uses nextPageToken and honors a longer configured interval", async () => {
    let round = 0;
    const { source, calls, scheduler } = setup({
      route: (url) => {
        if (url.pathname.endsWith("/videos")) {
          return jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat-1" } }] });
        }
        round += 1;
        return jsonResponse({
          items: [],
          ...(round === 1 ? { nextPageToken: "page-2" } : {}),
          pollingIntervalMillis: 3_000,
        });
      },
      sourceOptions: {
        videoUrl: "https://youtu.be/abcdefghijk",
        pollingIntervalMs: 12_000,
      },
    });

    await source.start();
    expect(scheduler.pendingDelaysMs).toEqual([12_000]);
    await scheduler.runNext();
    expect(calls[1]!.url.searchParams.get("pageToken")).toBeNull();
    expect(calls[2]!.url.searchParams.get("pageToken")).toBe("page-2");
  });

  it("backs off exponentially from 5s to 60s", async () => {
    const { source, scheduler, calls } = setup({
      route: (url) =>
        url.pathname.endsWith("/videos")
          ? jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat-1" } }] })
          : jsonResponse({ error: { errors: [{ reason: "backendError" }] } }, 500),
      sourceOptions: { videoUrl: "https://youtu.be/abcdefghijk" },
    });

    await source.start();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      delays.push(scheduler.pendingDelaysMs[0]!);
      expect(source.getStatus().state).toBe("error");
      await scheduler.runNext();
    }
    expect(delays).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(source.getStatus().lastError).toContain("HTTP 500");
  });

  it("never calls a write endpoint", async () => {
    const { source, calls } = setup({
      route: (url) =>
        url.pathname.endsWith("/videos")
          ? jsonResponse({ items: [{ liveStreamingDetails: { activeLiveChatId: "chat-1" } }] })
          : jsonResponse({ items: [], pollingIntervalMillis: 5_000 }),
      sourceOptions: { videoUrl: "https://youtu.be/abcdefghijk" },
    });
    await source.start();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(call.url.pathname).not.toMatch(/(insert|delete|update|transition|moderate)/u);
    }
  });

  it("stops at offlineAt", async () => {
    const { source, scheduler } = setup({
      route: () => jsonResponse({ items: [], offlineAt: "2026-11-07T12:30:00.000Z" }),
    });
    await source.start();
    expect(source.getStatus().state).toBe("stopped");
    expect(scheduler.pendingCount).toBe(0);
  });

  it("switches to a new activeLiveChatId after the old one ends", async () => {
    let videosCalls = 0;
    const { source, scheduler } = setup({
      route: (url) => {
        if (url.pathname.endsWith("/videos")) {
          videosCalls += 1;
          return jsonResponse({
            items: [
              {
                liveStreamingDetails: {
                  activeLiveChatId: videosCalls === 1 ? "chat-old" : "chat-new",
                },
              },
            ],
          });
        }
        return jsonResponse({ items: [], offlineAt: "2026-11-07T12:30:00.000Z" });
      },
      sourceOptions: { videoUrl: "https://youtu.be/abcdefghijk" },
    });

    await source.start();
    expect(source.getStatus().liveChatId).toBe("chat-new");
    expect(source.getStatus().state).toBe("polling");
    expect(scheduler.pendingDelaysMs).toEqual([0]);
  });

  it("accepts a manual liveChatId without resolving the video", async () => {
    const { source, calls, scheduler } = setup({
      route: () => jsonResponse({ items: [], pollingIntervalMillis: 5_000 }),
    });
    await source.start();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get("liveChatId")).toBe("chat-1");
    source.setLiveChatId("chat-2");
    await scheduler.advance(0);
    expect(calls.at(-1)!.url.searchParams.get("liveChatId")).toBe("chat-2");
    expect(calls.every((call) => !call.url.pathname.endsWith("/videos"))).toBe(true);
  });

  it("deduplicates comment ids across overlapping pages", async () => {
    let round = 0;
    const { source, received, scheduler } = setup({
      route: () => {
        round += 1;
        return jsonResponse({
          items: [
            {
              id: "yt-1",
              snippet: { type: "textMessageEvent", displayMessage: "同じ" },
              authorDetails: { displayName: "みかん" },
            },
            ...(round === 2
              ? [
                  {
                    id: "yt-2",
                    snippet: { type: "textMessageEvent", displayMessage: "新しい" },
                    authorDetails: { displayName: "ゆず" },
                  },
                ]
              : []),
          ],
          pollingIntervalMillis: 1_000,
        });
      },
    });
    await source.start();
    await scheduler.runNext();
    expect(received.map((comment) => comment.id)).toEqual(["yt-1", "yt-2"]);
  });

  it("falls back from an API-key 403 auth error to OAuth and retries once", async () => {
    let messagesCalls = 0;
    const auth = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      loadFallback: async () => new OAuthYouTubeAuthProvider(fakeTokenProvider()),
    });
    const { source, calls, scheduler } = setup({
      route: (url) => {
        if (url.pathname.endsWith("/liveChatMessages")) {
          messagesCalls += 1;
          if (messagesCalls === 1) {
            return jsonResponse({ error: { errors: [{ reason: "authError" }] } }, 403);
          }
          return jsonResponse({ items: [], pollingIntervalMillis: 5_000 });
        }
        return jsonResponse({ items: [] });
      },
      sourceOptions: { auth, liveChatId: "chat-1" },
    });

    await source.start();

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("key")).toBe(API_KEY);
    expect(calls[0]!.headers.authorization).toBeUndefined();
    expect(calls[1]!.url.searchParams.get("key")).toBeNull();
    expect(calls[1]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(source.getStatus()).toMatchObject({
      state: "polling",
      authMode: "oauth",
      fallbackAvailable: true,
      needsReauth: false,
    });
    expect(source.getStatus().quota).toMatchObject({ requests: 2, units: 10 });
    expect(scheduler.pendingDelaysMs).toEqual([5_000]);
  });

  it("does not retry more than once when both credentials fail", async () => {
    const auth = new ApiKeyYouTubeAuthProvider({
      apiKey: API_KEY,
      fallback: { clientId: "client", clientSecret: "secret", dataDir: "/tmp/unused" },
      loadFallback: async () => new OAuthYouTubeAuthProvider(fakeTokenProvider()),
    });
    const { source, calls } = setup({
      route: () => jsonResponse({ error: { errors: [{ reason: "authError" }] } }, 401),
      sourceOptions: { auth, liveChatId: "chat-1" },
    });

    await source.start();

    expect(calls).toHaveLength(2);
    expect(source.getStatus().state).toBe("error");
    expect(source.getStatus().authMode).toBe("oauth");
  });

  it("treats liveChatDisabled as terminal without OAuth fallback", async () => {
    let fallbackCalls = 0;
    const auth = oauthAuth({
      handleAuthFailure: async () => {
        fallbackCalls += 1;
        return true;
      },
    });
    const { source, calls } = setup({
      route: () =>
        jsonResponse({ error: { errors: [{ reason: "liveChatDisabled" }] } }, 403),
      sourceOptions: { auth, liveChatId: "chat-1" },
    });

    await source.start();

    expect(calls).toHaveLength(1);
    expect(fallbackCalls).toBe(0);
    expect(source.getStatus().state).toBe("stopped");
  });

  it("treats a 400 keyInvalid as an auth failure", async () => {
    let fallbackCalls = 0;
    const auth = apiKeyAuth();
    const { source, calls } = setup({
      route: () => jsonResponse({ error: { errors: [{ reason: "keyInvalid" }] } }, 400),
      sourceOptions: {
        auth: {
          ...auth,
          handleAuthFailure: async () => {
            fallbackCalls += 1;
            return false;
          },
        },
        liveChatId: "chat-1",
      },
    });

    await source.start();

    expect(calls).toHaveLength(1);
    expect(fallbackCalls).toBe(1);
    expect(source.getStatus().state).toBe("error");
    expect(source.getStatus().lastError).toContain("keyInvalid");
  });

  it("retries an OAuth request once after a 401", async () => {
    let authFailures = 0;
    let messagesCalls = 0;
    const auth = oauthAuth({
      handleAuthFailure: async () => {
        authFailures += 1;
        return true;
      },
    });
    const { source, calls } = setup({
      route: () => {
        messagesCalls += 1;
        if (messagesCalls === 1) {
          return jsonResponse({ error: { errors: [{ reason: "authError" }] } }, 401);
        }
        return jsonResponse({ items: [], pollingIntervalMillis: 5_000 });
      },
      sourceOptions: { auth, liveChatId: "chat-1" },
    });

    await source.start();

    expect(authFailures).toBe(1);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(source.getStatus().state).toBe("polling");
  });

  it("does not fall back when no OAuth credentials are configured", async () => {
    const { source, calls } = setup({
      route: () => jsonResponse({ error: { errors: [{ reason: "authError" }] } }, 401),
      sourceOptions: { auth: apiKeyAuth(), liveChatId: "chat-1" },
    });

    await source.start();

    expect(calls).toHaveLength(1);
    expect(source.getStatus().state).toBe("error");
    expect(source.getStatus().authMode).toBe("apiKey");
    expect(source.getStatus().fallbackAvailable).toBe(false);
  });

  it("marks needsReauth when the auth provider reports it", async () => {
    const scheduler = new FakeCommentScheduler();
    const source = new YouTubeCommentSource({
      auth: oauthAuth({
        getAuthState: () => ({
          mode: "oauth",
          authExpiresAt: AUTH_EXPIRES_AT,
          needsReauth: true,
          fallbackAvailable: false,
        }),
      }),
      liveChatId: "chat-1",
      scheduler,
      fetch: async () => jsonResponse({ items: [] }),
      now: () => new Date(BASE_TIME),
    });
    await source.start();
    expect(source.getStatus().needsReauth).toBe(true);
    expect(source.getStatus().state).toBe("polling");
  });

  it("does not emit comments or revive polling after stop during a request", async () => {
    const scheduler = new FakeCommentScheduler();
    let release: ((response: Response) => void) | null = null;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const received: CommentEvent[] = [];
    const source = new YouTubeCommentSource({
      auth: oauthAuth(),
      liveChatId: "chat-1",
      scheduler,
      fetch: async () => pending,
      now: () => new Date(BASE_TIME),
    });
    source.onComment((comment) => received.push(comment));

    const starting = source.start();
    await flushMicrotasks();
    source.stop();
    release!(
      jsonResponse({
        items: [
          {
            id: "yt-1",
            snippet: { type: "textMessageEvent", displayMessage: "こんにちは" },
            authorDetails: { displayName: "みかん" },
          },
        ],
        pollingIntervalMillis: 5_000,
      }),
    );
    await starting;

    expect(received).toHaveLength(0);
    expect(source.getStatus().state).toBe("stopped");
    expect(scheduler.pendingCount).toBe(0);
  });
});
