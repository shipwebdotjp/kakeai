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
 * OAuth client for the read-only YouTube comment source. `clientSecret` is
 * required for the installed-app loopback flow, and `live auth` needs only the
 * client pair. A run needs `videoUrl` or a manual `liveChatId`; that is checked
 * by the factory and CLI because the same config is used for `live auth`.
 */
export const liveYouTubeConfigSchema = z.strictObject({
  clientId: z.string().min(1).max(1000),
  clientSecret: z.string().min(1).max(1000),
  videoUrl: z.string().trim().min(1).max(2000).optional(),
  liveChatId: z.string().trim().min(1).max(500).optional(),
  /**
   * Lower bound for the polling interval. The API's `pollingIntervalMillis` is
   * used when it is longer; this value wins when it is longer than the API's.
   */
  pollingIntervalMs: positiveInt.optional(),
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
