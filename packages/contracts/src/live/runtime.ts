import { z } from "zod";
import { positiveInt } from "../content/primitives";
import { voiceAdapterIdSchema } from "../voice-profile";

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
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
});
export type LiveLlmConfig = z.infer<typeof liveLlmConfigSchema>;

export const liveTtsAdapterConfigSchema = z.strictObject({
  baseUrl: liveHttpUrlSchema,
  apiKey: z.string().min(1).max(1000).optional(),
});
export type LiveTtsAdapterConfig = z.infer<typeof liveTtsAdapterConfigSchema>;

export const liveRuntimeConfigSchema = z.strictObject({
  llm: liveLlmConfigSchema,
  tts: z.strictObject({
    adapters: z.partialRecord(voiceAdapterIdSchema, liveTtsAdapterConfigSchema),
  }),
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
