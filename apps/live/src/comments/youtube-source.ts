import type {
  CommentEvent,
  CommentSourceState,
  CommentSourceStatus,
  LiveCommentKind,
} from "@kakeai/contracts";
import type { YouTubeAuthProvider, YouTubeAuthState } from "../auth/youtube-auth.ts";
import {
  CommentSourceBase,
  realCommentScheduler,
  type CommentSourceScheduler,
} from "./source.ts";
import { YouTubeHttpClient } from "./youtube-http.ts";

const DEFAULT_API_BASE_URL = "https://www.googleapis.com/youtube/v3";
const DEFAULT_POLLING_INTERVAL_MS = 5_000;
const MIN_POLLING_INTERVAL_MS = 1_000;
const INITIAL_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;
const MESSAGES_LIST_UNITS = 5;
const VIDEOS_LIST_UNITS = 1;
const MAX_SEEN_COMMENT_IDS = 5_000;

export interface YouTubeCommentSourceOptions {
  auth: YouTubeAuthProvider;
  /** Manual chat ID. When set, `videos.list` resolution is skipped. */
  liveChatId?: string;
  videoUrl?: string;
  /** Lower bound for polling; the API interval wins when it is longer. */
  pollingIntervalMs?: number;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
  scheduler?: CommentSourceScheduler;
  now?: () => Date;
  requestTimeoutMs?: number;
  maxResults?: number;
}

interface YouTubeListResponse {
  items?: unknown;
  nextPageToken?: unknown;
  pollingIntervalMillis?: unknown;
  offlineAt?: unknown;
}

function parseVideoIdFromUrl(value: string): string | null {
  const trimmed = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/u.test(trimmed)) {
    return trimmed;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const allowedHost =
    host === "youtu.be" ||
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "www.youtube-nocookie.com";
  if (!allowedHost) {
    return null;
  }
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
  }
  const fromQuery = url.searchParams.get("v");
  if (fromQuery !== null && /^[A-Za-z0-9_-]{11}$/u.test(fromQuery)) {
    return fromQuery;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && ["live", "shorts", "embed"].includes(segments[0]!)) {
    const id = segments[1]!;
    return /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
  }
  return null;
}

export const parseYouTubeVideoId = parseVideoIdFromUrl;

function mapCommentKind(type: unknown): LiveCommentKind | null {
  switch (type) {
    case "textMessageEvent":
      return "normal";
    case "superChatEvent":
    case "superStickerEvent":
      return "superchat";
    case "memberMilestoneChatEvent":
    case "newSponsorEvent":
    case "memberChatPaidMessageEvent":
      return "member";
    default:
      return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseCommentItem(item: unknown, receivedAt: string): CommentEvent | null {
  if (typeof item !== "object" || item === null) {
    return null;
  }
  const record = item as {
    id?: unknown;
    snippet?: { type?: unknown; displayMessage?: unknown; publishedAt?: unknown };
    authorDetails?: { displayName?: unknown };
  };
  const id = asString(record.id);
  const text = asString(record.snippet?.displayMessage);
  const kind = mapCommentKind(record.snippet?.type);
  if (id === null || text === null || kind === null) {
    return null;
  }
  const publishedAt = asString(record.snippet?.publishedAt);
  const published =
    publishedAt !== null && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : receivedAt;
  const authorName = asString(record.authorDetails?.displayName) ?? "匿名";
  return {
    id,
    authorName,
    text,
    publishedAt: published,
    receivedAt,
    kind,
  };
}

/**
 * Read-only YouTube comment source. It calls `videos.list` once to resolve the
 * live chat and then polls `liveChatMessages.list`; no write endpoint or
 * moderation method is ever constructed. Comment bodies are kept in memory
 * only and never logged by this module.
 */
export class YouTubeCommentSource extends CommentSourceBase {
  private readonly auth: YouTubeAuthProvider;
  private readonly http: YouTubeHttpClient;
  private readonly scheduler: CommentSourceScheduler;
  private readonly now: () => Date;
  private readonly apiBaseUrl: string;
  private readonly configuredPollingIntervalMs: number;
  private readonly maxResults: number;
  private readonly videoUrl: string | undefined;
  private readonly quotaStartedAt: string;
  private state: CommentSourceState = "idle";
  private running = false;
  private liveChatId: string | null;
  private videoId: string | null = null;
  private manualChatId: boolean;
  private pageToken: string | null = null;
  private effectivePollingIntervalMs: number;
  private lastPolledAt: string | null = null;
  private lastError: string | null = null;
  private backoffAttempt = 0;
  private requestCount = 0;
  private unitCount = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private repollRequested = false;
  private chatGeneration = 0;
  private readonly seenCommentIds = new Set<string>();

  constructor(options: YouTubeCommentSourceOptions) {
    super();
    this.auth = options.auth;
    this.http = new YouTubeHttpClient({
      auth: options.auth,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
    });
    this.scheduler = options.scheduler ?? realCommentScheduler;
    this.now = options.now ?? (() => new Date());
    this.apiBaseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/u, "");
    this.configuredPollingIntervalMs = options.pollingIntervalMs ?? 0;
    this.effectivePollingIntervalMs =
      this.configuredPollingIntervalMs > 0
        ? Math.max(this.configuredPollingIntervalMs, MIN_POLLING_INTERVAL_MS)
        : DEFAULT_POLLING_INTERVAL_MS;
    this.maxResults = Math.min(Math.max(options.maxResults ?? 200, 200), 2000);
    this.videoUrl = options.videoUrl;
    const trimmedChatId = options.liveChatId?.trim() ?? "";
    this.liveChatId = trimmedChatId.length > 0 ? trimmedChatId : null;
    this.manualChatId = this.liveChatId !== null;
    this.quotaStartedAt = this.now().toISOString();
    if (this.videoUrl !== undefined) {
      this.videoId = parseVideoIdFromUrl(this.videoUrl);
    }
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.setState("connecting");

    if (this.liveChatId === null) {
      if (this.videoUrl === undefined) {
        this.running = false;
        this.failConfig(
          "YouTube の liveChatId か videoUrl を設定してください。",
        );
        throw new Error("YouTube の liveChatId か videoUrl を設定してください。");
      }
      if (this.videoId === null) {
        this.running = false;
        this.failConfig("YouTube の動画 URL を解釈できませんでした。");
        throw new Error("YouTube の動画 URL を解釈できませんでした。");
      }
      try {
        await this.resolveLiveChatId();
      } catch (error) {
        this.handleFailure(error);
        return;
      }
    }

    if (!this.running) {
      return;
    }
    this.setState("polling");
    await this.pollOnce();
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    this.setState("stopped");
  }

  setLiveChatId(liveChatId: string): void {
    const next = liveChatId.trim();
    if (next.length === 0) {
      return;
    }
    this.liveChatId = next;
    this.manualChatId = true;
    this.chatGeneration += 1;
    this.seenCommentIds.clear();
    this.pageToken = null;
    this.lastError = null;
    this.backoffAttempt = 0;
    this.emitStatus();
    if (this.running) {
      this.clearTimer();
      this.setState("polling");
      void this.pollOnce();
    }
  }

  getStatus(): CommentSourceStatus {
    const auth = this.readAuthState();
    return {
      kind: "youtube",
      state: this.state,
      liveChatId: this.liveChatId,
      pollingIntervalMs: this.effectivePollingIntervalMs,
      lastPolledAt: this.lastPolledAt,
      lastError: this.lastError,
      quota: {
        requests: this.requestCount,
        units: this.unitCount,
        startedAt: this.quotaStartedAt,
        windowStartedAt: this.quotaStartedAt,
      },
      authMode: auth?.mode ?? null,
      fallbackAvailable: auth?.fallbackAvailable ?? false,
      authExpiresAt: auth?.authExpiresAt ?? null,
      needsReauth: auth?.needsReauth ?? false,
    };
  }

  private readAuthState(): YouTubeAuthState | null {
    try {
      return this.auth.getAuthState();
    } catch {
      return null;
    }
  }

  private setState(state: CommentSourceState): void {
    this.state = state;
    this.emitStatus();
  }

  private failConfig(message: string): void {
    this.lastError = message;
    this.setState("error");
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    this.clearTimer();
    if (!this.running) {
      return;
    }
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = null;
      void this.pollOnce();
    }, delayMs);
  }

  private countRequest(units: number): void {
    this.requestCount += 1;
    this.unitCount += units;
  }

  private rememberComment(id: string): boolean {
    if (this.seenCommentIds.has(id)) {
      return false;
    }
    this.seenCommentIds.add(id);
    if (this.seenCommentIds.size > MAX_SEEN_COMMENT_IDS) {
      const oldest = this.seenCommentIds.values().next().value;
      if (oldest !== undefined) {
        this.seenCommentIds.delete(oldest);
      }
    }
    return true;
  }

  private async resolveLiveChatId(): Promise<void> {
    if (this.videoId === null) {
      throw new Error("YouTube の動画 URL を解釈できませんでした。");
    }
    const url = new URL(`${this.apiBaseUrl}/videos`);
    url.searchParams.set("part", "liveStreamingDetails");
    url.searchParams.set("id", this.videoId);
    const response = await this.http.get(url, () => this.countRequest(VIDEOS_LIST_UNITS));
    if (!response.ok) {
      const failure = await this.http.readFailure(response, "動画情報");
      if (failure.terminal) {
        // A disabled/ended/missing chat is not fixed by retrying the same ID.
        this.running = false;
        this.clearTimer();
        this.lastError = failure.message;
        this.setState("stopped");
      }
      throw new Error(failure.message);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("YouTube の動画情報を JSON として読めませんでした。");
    }
    const items = (payload as { items?: unknown }).items;
    const first = Array.isArray(items) ? (items[0] as { liveStreamingDetails?: unknown }) : null;
    const details = first?.liveStreamingDetails as
      | { activeLiveChatId?: unknown }
      | undefined;
    const chatId = asString(details?.activeLiveChatId);
    if (chatId === null) {
      throw new Error("ライブチャットが見つかりません。配信中か、liveChatId を確認してください。");
    }
    if (chatId !== this.liveChatId) {
      this.liveChatId = chatId;
      this.chatGeneration += 1;
      this.seenCommentIds.clear();
      this.pageToken = null;
    }
    this.lastError = null;
    this.emitStatus();
  }

  private async pollOnce(): Promise<void> {
    if (!this.running) {
      return;
    }
    if (this.inFlight) {
      this.repollRequested = true;
      return;
    }
    this.clearTimer();
    this.inFlight = true;
    try {
      await this.pollOnceInternal();
    } finally {
      this.inFlight = false;
      if (this.repollRequested) {
        this.repollRequested = false;
        if (this.running) {
          void this.pollOnce();
        }
      }
    }
  }

  private async pollOnceInternal(): Promise<void> {
    if (!this.running) {
      return;
    }
    if (this.liveChatId === null) {
      try {
        await this.resolveLiveChatId();
      } catch (error) {
        this.handleFailure(error);
        return;
      }
    }
    const chatId = this.liveChatId;
    const generation = this.chatGeneration;
    if (chatId === null) {
      this.handleFailure(new Error("ライブチャット ID がありません。"));
      return;
    }

    const url = new URL(`${this.apiBaseUrl}/liveChatMessages`);
    url.searchParams.set("liveChatId", chatId);
    url.searchParams.set("part", "snippet,authorDetails");
    url.searchParams.set("maxResults", String(this.maxResults));
    if (this.pageToken !== null) {
      url.searchParams.set("pageToken", this.pageToken);
    }

    let response: Response;
    try {
      response = await this.http.get(url, () => this.countRequest(MESSAGES_LIST_UNITS));
    } catch (error) {
      this.handleFailure(error);
      return;
    }
    if (!this.running || generation !== this.chatGeneration) {
      return;
    }

    if (!response.ok) {
      const failure = await this.http.readFailure(response);
      if (!this.running || generation !== this.chatGeneration) {
        return;
      }
      if (failure.terminal) {
        await this.stopForEndedChat(chatId);
        return;
      }
      this.handleFailure(new Error(failure.message));
      return;
    }

    let payload: YouTubeListResponse;
    try {
      payload = (await response.json()) as YouTubeListResponse;
    } catch {
      this.handleFailure(new Error("YouTube のコメント応答を JSON として読めませんでした。"));
      return;
    }
    if (!this.running || generation !== this.chatGeneration) {
      return;
    }

    if (payload.offlineAt !== undefined && payload.offlineAt !== null) {
      await this.stopForEndedChat(chatId);
      return;
    }

    const receivedAt = this.now().toISOString();
    const items = Array.isArray(payload.items) ? payload.items : [];
    for (const item of items) {
      const comment = parseCommentItem(item, receivedAt);
      if (comment !== null && this.rememberComment(comment.id)) {
        this.emitComment(comment);
      }
    }

    this.pageToken = asString(payload.nextPageToken);
    const apiInterval =
      typeof payload.pollingIntervalMillis === "number" &&
      Number.isFinite(payload.pollingIntervalMillis) &&
      payload.pollingIntervalMillis > 0
        ? payload.pollingIntervalMillis
        : 0;
    const resolvedInterval = Math.max(this.configuredPollingIntervalMs, apiInterval);
    this.effectivePollingIntervalMs =
      resolvedInterval > 0
        ? Math.max(resolvedInterval, MIN_POLLING_INTERVAL_MS)
        : DEFAULT_POLLING_INTERVAL_MS;
    this.lastPolledAt = receivedAt;
    this.lastError = null;
    this.backoffAttempt = 0;
    this.setState("polling");
    this.schedule(this.effectivePollingIntervalMs);
  }

  private async stopForEndedChat(endedChatId: string): Promise<void> {
    // When a video URL is configured, the stream may have restarted with a new
    // active chat. Re-resolve once before declaring the source stopped.
    if (!this.manualChatId && this.videoId !== null) {
      try {
        await this.resolveLiveChatId();
        if (this.liveChatId !== null && this.liveChatId !== endedChatId) {
          this.lastError = null;
          this.backoffAttempt = 0;
          this.setState("polling");
          this.schedule(0);
          return;
        }
      } catch {
        // Fall through to stopped; the operator can set a new liveChatId.
      }
    }
    this.running = false;
    this.clearTimer();
    this.lastError = null;
    this.setState("stopped");
  }

  private handleFailure(error: unknown): void {
    if (!this.running) {
      return;
    }
    this.lastError = error instanceof Error ? error.message : String(error);
    this.backoffAttempt += 1;
    const delayMs = Math.min(
      INITIAL_BACKOFF_MS * 2 ** (this.backoffAttempt - 1),
      MAX_BACKOFF_MS,
    );
    this.setState("error");
    this.schedule(delayMs);
  }
}
