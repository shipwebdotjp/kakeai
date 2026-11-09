import { z } from "zod";
import { idSchema, nonNegativeInt, positiveInt, timestampSchema } from "../content/primitives";
import { visualThemeRefSchema } from "../content/theme";

/** Live Program packages with typed cards. */
export const LIVE_PROGRAM_PACKAGE_SCHEMA_VERSION = 2 as const;
export const LIVE_CARD_SCHEMA_VERSION = 1 as const;
export const LIVE_EXPORTER_VERSION = "0.1.0" as const;

/**
 * A path inside a live package. It is always POSIX-style and never escapes
 * the package root. Absolute paths and `..` segments are rejected rather than
 * normalized, so a malformed package cannot silently point outside its root.
 */
export const livePackageRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes("\0") &&
      !/%(?:2e|2f|5c)/i.test(value) &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !value.split("/").some((segment) => segment === "" || segment === "." || segment === ".."),
    { message: "パッケージ内の相対パスを指定してください" },
  );
export type LivePackageRelativePath = z.infer<typeof livePackageRelativePathSchema>;

/**
 * Reserved URL prefix for audio generated during a run. The server maps it to
 * `<runDir>/generated/<file>`; it never resolves inside the package.
 */
export const LIVE_RUN_AUDIO_PREFIX = "run:generated/";

const GENERATED_AUDIO_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:wav|mp3)$/u;

/** A flat file name under `generated/`: no separators, no `..`, no leading dot. */
export function isSafeGeneratedAudioFileName(fileName: string): boolean {
  return (
    fileName.length > 0 &&
    fileName.length <= 200 &&
    GENERATED_AUDIO_FILE_PATTERN.test(fileName) &&
    !fileName.includes("..")
  );
}

export type LiveAudioLocation =
  | { kind: "package"; path: string }
  | { kind: "run"; fileName: string };

/**
 * Parses either a package-relative path or `run:generated/<file>`. Returns
 * null for anything else, including path traversal and unsupported extensions.
 */
export function parseLiveAudioUrl(value: string): LiveAudioLocation | null {
  if (value.startsWith(LIVE_RUN_AUDIO_PREFIX)) {
    const fileName = value.slice(LIVE_RUN_AUDIO_PREFIX.length);
    if (!isSafeGeneratedAudioFileName(fileName)) {
      return null;
    }
    return { kind: "run", fileName };
  }
  // `run:` is reserved. Never let an unknown run prefix fall through as a
  // package path.
  if (value.startsWith("run:")) {
    return null;
  }
  const parsed = livePackageRelativePathSchema.safeParse(value);
  return parsed.success ? { kind: "package", path: parsed.data } : null;
}

export const liveAudioUrlSchema = z
  .string()
  .min(1)
  .refine((value) => parseLiveAudioUrl(value) !== null, {
    message:
      "パッケージ内の相対パス、または run:generated/<ファイル名>.wav|mp3 を指定してください",
  });
export type LiveAudioUrl = z.infer<typeof liveAudioUrlSchema>;

export const liveMediaTypeSchema = z.enum([
  "text/css",
  "application/json",
  "text/html",
  "image/png",
  "image/jpeg",
  "image/webp",
  "video/mp4",
  "audio/wav",
  "audio/mpeg",
]);
export type LiveMediaType = z.infer<typeof liveMediaTypeSchema>;

export function liveExtensionForMediaType(mediaType: LiveMediaType): string {
  switch (mediaType) {
    case "text/css":
      return "css";
    case "application/json":
      return "json";
    case "text/html":
      return "html";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "video/mp4":
      return "mp4";
    case "audio/wav":
      return "wav";
    case "audio/mpeg":
      return "mp3";
    default: {
      const exhaustive: never = mediaType;
      throw new Error(`Unsupported live media type: ${String(exhaustive)}`);
    }
  }
}

export const liveFileKindSchema = z.enum([
  "theme",
  "show",
  "characters",
  "asset",
  "material",
  "card-asset",
  "cut-in",
  "voice-ref",
  "prepared-audio",
  "fixture",
]);
export type LiveFileKind = z.infer<typeof liveFileKindSchema>;

export const livePackageFileSchema = z.strictObject({
  path: livePackageRelativePathSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: nonNegativeInt,
  mediaType: liveMediaTypeSchema,
  kind: liveFileKindSchema,
  durationMs: nonNegativeInt.nullable(),
  width: positiveInt.nullable(),
  height: positiveInt.nullable(),
  hasAudio: z.boolean(),
});
export type LivePackageFile = z.infer<typeof livePackageFileSchema>;

export const liveManifestFontSchema = z.strictObject({
  role: z.string().min(1),
  family: z.string().min(1),
  found: z.boolean(),
  fallback: z.string().min(1),
  required: z.boolean(),
});
export type LiveManifestFont = z.infer<typeof liveManifestFontSchema>;

export const liveManifestVoiceSchema = z
  .strictObject({
    speakerId: z.string().min(1),
    characterId: z.string().min(1).nullable(),
    adapterId: z.string().min(1),
    voiceId: z.string().min(1),
    refAudio: livePackageRelativePathSchema.nullable(),
    refAudioSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    testSynthesis: z.literal("ok"),
  })
  .superRefine((voice, ctx) => {
    if ((voice.refAudio === null) !== (voice.refAudioSha256 === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["refAudio"],
        message: "refAudio と refAudioSha256 は両方nullか両方指定にしてください。",
      });
    }
  });
export type LiveManifestVoice = z.infer<typeof liveManifestVoiceSchema>;

export const liveProgramPackageSourceSchema = z.strictObject({
  programId: idSchema,
  programVersionId: idSchema,
  programVersionNumber: positiveInt,
  programDocumentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  resolutionSnapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  theme: visualThemeRefSchema,
});
export type LiveProgramPackageSource = z.infer<typeof liveProgramPackageSourceSchema>;

export const livePackageManifestSchema = z
  .strictObject({
    packageSchemaVersion: z.literal(LIVE_PROGRAM_PACKAGE_SCHEMA_VERSION),
    exporterVersion: z.string().min(1),
    packageId: z.string().min(1),
    createdAt: timestampSchema,
    source: liveProgramPackageSourceSchema,
    cardSchemaVersion: z.literal(LIVE_CARD_SCHEMA_VERSION).default(LIVE_CARD_SCHEMA_VERSION),
    files: z.array(livePackageFileSchema),
    fonts: z.array(liveManifestFontSchema),
    voices: z.array(liveManifestVoiceSchema),
  })
  .superRefine((manifest, ctx) => {
    const files = new Set<string>();
    for (const file of manifest.files) {
      if (files.has(file.path)) {
        ctx.addIssue({
          code: "custom",
          path: ["files"],
          message: `ファイルパスが重複しています: ${file.path}`,
        });
      }
      files.add(file.path);
    }
    const speakers = new Set<string>();
    for (const voice of manifest.voices) {
      if (speakers.has(voice.speakerId)) {
        ctx.addIssue({
          code: "custom",
          path: ["voices"],
          message: `話者 ID が重複しています: ${voice.speakerId}`,
        });
      }
      speakers.add(voice.speakerId);
    }
  });
export type LivePackageManifest = z.infer<typeof livePackageManifestSchema>;
