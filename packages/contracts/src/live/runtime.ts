import { z } from "zod";
import { positiveInt } from "../content/primitives";
import { voiceAdapterIdSchema } from "../voice-profile";

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") {
    return true;
  }
  const parts = host.split(".");
  return (
    parts.length === 4 &&
    parts[0] === "127" &&
    parts.slice(1).every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

const liveHttpUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        if (url.username.length > 0 || url.password.length > 0) {
          return false;
        }
        if (url.protocol === "https:") {
          return true;
        }
        return url.protocol === "http:" && isLoopbackHostname(url.hostname);
      } catch {
        return false;
      }
    },
    { message: "https、またはループバックのhttp URLを指定してください" },
  );

export const liveLlmModeSchema = z.enum(["local", "external"]);
export type LiveLlmMode = z.infer<typeof liveLlmModeSchema>;

export const liveLlmConfigSchema = z.strictObject({
  mode: liveLlmModeSchema,
  baseUrl: liveHttpUrlSchema,
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(1000).optional(),
  /** Shared LLM timeout for the analyst and the director. */
  timeoutMs: positiveInt.default(15_000),
});
export type LiveLlmConfig = z.infer<typeof liveLlmConfigSchema>;

export const liveTtsAdapterConfigSchema = z.strictObject({
  baseUrl: liveHttpUrlSchema,
  apiKey: z.string().min(1).max(1000).optional(),
});
export type LiveTtsAdapterConfig = z.infer<typeof liveTtsAdapterConfigSchema>;

/**
 * Read-only authentication for the YouTube comment source. An API key is the
 * first choice because `videos.list` and `liveChatMessages.list` can read
 * public data with it. The OAuth client pair is optional; when both values are
 * present it is used as a fallback for permission errors. Without an API key,
 * the OAuth client pair is required and `live auth` saves a token. A run needs
 * `videoUrl` or a manual `liveChatId`; that is checked by the factory and CLI
 * because the same config is used for `live auth`.
 */
export const liveYouTubeConfigSchema = z
  .strictObject({
    apiKey: z.string().trim().min(1).max(1000).optional(),
    clientId: z.string().trim().min(1).max(1000).optional(),
    clientSecret: z.string().trim().min(1).max(1000).optional(),
    videoUrl: z.string().trim().min(1).max(2000).optional(),
    liveChatId: z.string().trim().min(1).max(500).optional(),
    /**
     * Lower bound for the polling interval. The API's `pollingIntervalMillis` is
     * used when it is longer; this value wins when it is longer than the API's.
     */
    pollingIntervalMs: positiveInt.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.apiKey === undefined) {
      if (value.clientId === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["clientId"],
          message: "apiKey が無い場合は clientId が必要です",
        });
      }
      if (value.clientSecret === undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["clientSecret"],
          message: "apiKey が無い場合は clientSecret が必要です",
        });
      }
      return;
    }
    const hasClientId = value.clientId !== undefined;
    const hasClientSecret = value.clientSecret !== undefined;
    if (hasClientId !== hasClientSecret) {
      ctx.addIssue({
        code: "custom",
        path: [hasClientId ? "clientSecret" : "clientId"],
        message: "OAuth フォールバックには clientId と clientSecret の両方が必要です",
      });
    }
  });
export type LiveYouTubeConfig = z.infer<typeof liveYouTubeConfigSchema>;

export const DEFAULT_LIVE_COMMENTS_CONFIG = {
  ngWords: [],
  maxLength: 300,
  maxPerAuthorPerMinute: 3,
  analysisBatchSize: 20,
  analysisTimeoutMs: 15_000,
  cornerHoldMs: 4_000,
} as const;

export const liveCommentsConfigSchema = z.strictObject({
  ngWords: z.array(z.string().trim().min(1)).default(() => []),
  maxLength: positiveInt.default(DEFAULT_LIVE_COMMENTS_CONFIG.maxLength),
  maxPerAuthorPerMinute: positiveInt.default(
    DEFAULT_LIVE_COMMENTS_CONFIG.maxPerAuthorPerMinute,
  ),
  analysisBatchSize: positiveInt.default(DEFAULT_LIVE_COMMENTS_CONFIG.analysisBatchSize),
  analysisTimeoutMs: positiveInt.default(DEFAULT_LIVE_COMMENTS_CONFIG.analysisTimeoutMs),
  cornerHoldMs: positiveInt.default(DEFAULT_LIVE_COMMENTS_CONFIG.cornerHoldMs),
});
export type LiveCommentsConfig = z.infer<typeof liveCommentsConfigSchema>;

export const liveRuntimeConfigSchema = z.strictObject({
  llm: liveLlmConfigSchema,
  tts: z.strictObject({
    adapters: z.partialRecord(voiceAdapterIdSchema, liveTtsAdapterConfigSchema),
    /** Per-synthesis timeout for generated responses. */
    timeoutMs: positiveInt.default(20_000),
    /** Shared limit for concurrent generated-response TTS calls. */
    maxConcurrentTts: positiveInt.default(2),
  }),
  youtube: liveYouTubeConfigSchema.optional(),
  comments: liveCommentsConfigSchema.default(() => ({
    ...DEFAULT_LIVE_COMMENTS_CONFIG,
    ngWords: [],
  })),
  port: positiveInt.max(65535),
  dataDir: z
    .string()
    .min(1)
    .refine(
      (value) =>
        value.startsWith("/") &&
        !value.includes("\0") &&
        !value.includes("\\") &&
        !value.split("/").includes(".."),
      { message: "dataDir には .. を含まない絶対パスを指定してください" },
    ),
});
export type LiveRuntimeConfig = z.infer<typeof liveRuntimeConfigSchema>;
