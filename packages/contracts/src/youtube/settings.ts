import { z } from "zod";
import { idSchema, timestampSchema } from "../content/primitives";

export const YOUTUBE_SETTINGS_SCHEMA_VERSION = 1 as const;

export const youtubeCategorySchema = z.enum([
  "film_and_animation",
  "autos_and_vehicles",
  "music",
  "pets_and_animals",
  "sports",
  "travel_and_events",
  "gaming",
  "people_and_blogs",
  "comedy",
  "entertainment",
  "news_and_politics",
  "howto_and_style",
  "education",
  "science_and_technology",
  "nonprofits_and_activism",
]);
export type YouTubeCategory = z.infer<typeof youtubeCategorySchema>;

export const youtubeCaptionCertificationSchema = z.enum([
  "none",
  "has_never_aired",
  "has_aired_without_captions",
  "exempt_from_captions",
  "not_required",
]);
export type YouTubeCaptionCertification = z.infer<typeof youtubeCaptionCertificationSchema>;

export const youtubeAudienceDeclarationSchema = z.enum([
  "not_applicable",
  "made_for_kids",
  "not_made_for_kids",
]);
export type YouTubeAudienceDeclaration = z.infer<typeof youtubeAudienceDeclarationSchema>;

export const youtubeAgeRestrictionDeclarationSchema = z.enum([
  "not_applicable",
  "restrict_over_18",
  "do_not_restrict",
]);
export type YouTubeAgeRestrictionDeclaration = z.infer<typeof youtubeAgeRestrictionDeclarationSchema>;

export const youtubePaidPromotionDeclarationSchema = z.enum([
  "not_applicable",
  "contains_paid_promotion",
  "no_paid_promotion",
]);
export type YouTubePaidPromotionDeclaration = z.infer<typeof youtubePaidPromotionDeclarationSchema>;

export const youtubeSyntheticContentDeclarationSchema = z.enum([
  "not_applicable",
  "altered_or_synthetic",
  "none",
]);
export type YouTubeSyntheticContentDeclaration = z.infer<typeof youtubeSyntheticContentDeclarationSchema>;

export const youtubeVisibilitySchema = z.enum(["public", "unlisted", "private"]);
export type YouTubeVisibility = z.infer<typeof youtubeVisibilitySchema>;

export const youtubeLicenseSchema = z.enum(["youtube", "creative_commons"]);
export type YouTubeLicense = z.infer<typeof youtubeLicenseSchema>;

export const youtubeCommentModeSchema = z.enum([
  "allow_all",
  "hold_potentially_inappropriate",
  "hold_all",
  "disabled",
]);
export type YouTubeCommentMode = z.infer<typeof youtubeCommentModeSchema>;

export const youtubeShortsRemixSchema = z.enum([
  "allow_video_and_audio",
  "allow_audio_only",
  "dont_allow",
]);
export type YouTubeShortsRemix = z.infer<typeof youtubeShortsRemixSchema>;

export const youtubeDeclarationsSchema = z.strictObject({
  audience: youtubeAudienceDeclarationSchema,
  ageRestriction: youtubeAgeRestrictionDeclarationSchema,
  paidPromotion: youtubePaidPromotionDeclarationSchema,
  syntheticContent: youtubeSyntheticContentDeclarationSchema,
});
export type YouTubeDeclarations = z.infer<typeof youtubeDeclarationsSchema>;

export const youtubeRecordingDetailsSchema = z.strictObject({
  recordingDate: z.string().nullable(),
  location: z.string().nullable(),
});
export type YouTubeRecordingDetails = z.infer<typeof youtubeRecordingDetailsSchema>;

export const youtubeEducationDetailsSchema = z.strictObject({
  type: z.string().nullable(),
  academicSystem: z.string().nullable(),
});
export type YouTubeEducationDetails = z.infer<typeof youtubeEducationDetailsSchema>;

export const youtubeCommentsSchema = z.strictObject({
  mode: youtubeCommentModeSchema,
});
export type YouTubeComments = z.infer<typeof youtubeCommentsSchema>;

export const youtubeChaptersSettingsSchema = z.strictObject({
  automaticChapters: z.boolean(),
  automaticKeyMoments: z.boolean(),
});
export type YouTubeChaptersSettings = z.infer<typeof youtubeChaptersSettingsSchema>;

export function countCodePoints(str: string): number {
  return [...str].length;
}

export function safeTruncateTitle(title: string, maxLength = 100): string {
  return [...title].slice(0, maxLength).join("");
}

export function isValidIsoDateTime(str: string): boolean {
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/u);
  if (!match) {
    return false;
  }
  const [, yearStr, monthStr, dayStr, hourStr, minStr, secStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minStr);
  const second = Number(secStr);

  if (hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const date = new Date(str);
  if (isNaN(date.getTime())) {
    return false;
  }
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return false;
  }
  return true;
}

export const youtubeVideoSettingsDocumentSchema = z
  .strictObject({
    schemaVersion: z.literal(YOUTUBE_SETTINGS_SCHEMA_VERSION),
    title: z
      .string()
      .min(1, "タイトルは必須です")
      .refine((v) => countCodePoints(v) <= 100, { message: "タイトルは最大100文字です" }),
    description: z
      .string()
      .refine((val) => countCodePoints(val) <= 5000, {
        message: "説明は最大5,000文字（コードポイント）までです",
      }),
    tags: z
      .array(
        z
          .string()
          .min(1)
          .refine((v) => countCodePoints(v.trim()) <= 500, {
            message: "各タグは最大500文字です",
          }),
      )
      .max(50, "タグは最大50個までです")
      .refine(
        (tags) => {
          const normalized = tags.map((t) => t.trim().toLowerCase());
          return normalized.length === new Set(normalized).size;
        },
        {
          message: "タグに重複があります",
        },
      ),
    category: youtubeCategorySchema.nullable(),
    language: z.string().nullable(),
    captionCertification: youtubeCaptionCertificationSchema.nullable(),
    recordingDetails: youtubeRecordingDetailsSchema.nullable(),
    educationDetails: youtubeEducationDetailsSchema.nullable(),
    shortsRelatedVideo: z.string().nullable(),
    declarations: youtubeDeclarationsSchema,
    visibility: youtubeVisibilitySchema,
    publishAt: z
      .string()
      .nullable()
      .refine((val) => val === null || isValidIsoDateTime(val), {
        message: "publishAt は有効な日時形式（ISO 8601, UTC 'Z'のみ）である必要があります",
      }),
    premiere: z.boolean(),
    license: youtubeLicenseSchema,
    embeddable: z.boolean(),
    notifySubscribers: z.boolean(),
    statisticsVisibility: z.boolean(),
    comments: youtubeCommentsSchema,
    ratings: z.boolean(),
    chapters: youtubeChaptersSettingsSchema,
    location: z.string().nullable(),
    shortsRemix: youtubeShortsRemixSchema,
  })
  .superRefine((doc, ctx) => {
    if (doc.declarations.audience === "made_for_kids" && doc.comments.mode === "allow_all") {
      ctx.addIssue({
        code: "custom",
        message: "子ども向けの動画ではコメントを全許可にできません",
        path: ["comments", "mode"],
      });
    }
  });

export type YouTubeVideoSettingsDocument = z.infer<typeof youtubeVideoSettingsDocumentSchema>;

export const updateYouTubeVideoSettingsRequestSchema = youtubeVideoSettingsDocumentSchema;
export type UpdateYouTubeVideoSettingsRequest = z.infer<typeof updateYouTubeVideoSettingsRequestSchema>;

export const youtubeVideoSettingsViewSchema = z.strictObject({
  languageEditionId: idSchema,
  document: youtubeVideoSettingsDocumentSchema,
  updatedAt: timestampSchema,
});
export type YouTubeVideoSettingsView = z.infer<typeof youtubeVideoSettingsViewSchema>;

export const youtubeSettingsTemplateSummarySchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(100),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type YouTubeSettingsTemplateSummary = z.infer<typeof youtubeSettingsTemplateSummarySchema>;

export const youtubeSettingsTemplateSchema = youtubeSettingsTemplateSummarySchema.extend({
  document: youtubeVideoSettingsDocumentSchema,
});
export type YouTubeSettingsTemplate = z.infer<typeof youtubeSettingsTemplateSchema>;

export const createYouTubeSettingsTemplateRequestSchema = z.strictObject({
  name: z.string().min(1, "テンプレート名は必須です").max(100, "テンプレート名は最大100文字です"),
  document: youtubeVideoSettingsDocumentSchema,
});
export type CreateYouTubeSettingsTemplateRequest = z.infer<
  typeof createYouTubeSettingsTemplateRequestSchema
>;

export const updateYouTubeSettingsTemplateRequestSchema = z.strictObject({
  name: z.string().min(1, "テンプレート名は必須です").max(100, "テンプレート名は最大100文字です"),
  document: youtubeVideoSettingsDocumentSchema,
});
export type UpdateYouTubeSettingsTemplateRequest = z.infer<
  typeof updateYouTubeSettingsTemplateRequestSchema
>;

/** Derive default YouTubeVideoSettings document for a given work title and edition locale */
export function createDefaultYouTubeVideoSettingsDocument(
  workTitle: string,
  locale: string,
): YouTubeVideoSettingsDocument {
  const derivedLanguage = (locale.split("-")[0] ?? "").trim().toLowerCase() || "ja";
  const title = safeTruncateTitle(workTitle || "Untitled", 100);
  return {
    schemaVersion: YOUTUBE_SETTINGS_SCHEMA_VERSION,
    title,
    description: "",
    tags: [],
    category: null,
    language: derivedLanguage,
    captionCertification: "none",
    recordingDetails: null,
    educationDetails: null,
    shortsRelatedVideo: null,
    declarations: {
      audience: "not_applicable",
      ageRestriction: "not_applicable",
      paidPromotion: "not_applicable",
      syntheticContent: "not_applicable",
    },
    visibility: "public",
    publishAt: null,
    premiere: false,
    license: "youtube",
    embeddable: true,
    notifySubscribers: true,
    statisticsVisibility: true,
    comments: {
      mode: "hold_potentially_inappropriate",
    },
    ratings: true,
    chapters: {
      automaticChapters: true,
      automaticKeyMoments: true,
    },
    location: null,
    shortsRemix: "allow_video_and_audio",
  };
}

export const youtubeChapterWarningCodeSchema = z.enum([
  "less_than_3_chapters",
  "first_chapter_not_zero",
  "scene_under_10_seconds",
]);
export type YouTubeChapterWarningCode = z.infer<typeof youtubeChapterWarningCodeSchema>;

export const youtubeChapterWarningSchema = z.strictObject({
  code: youtubeChapterWarningCodeSchema,
  message: z.string(),
  sceneId: idSchema.optional(),
});
export type YouTubeChapterWarning = z.infer<typeof youtubeChapterWarningSchema>;

export const youtubeChaptersResultSchema = z.strictObject({
  scriptVersionId: idSchema,
  chaptersText: z.string(),
  warnings: z.array(youtubeChapterWarningSchema),
});
export type YouTubeChaptersResult = z.infer<typeof youtubeChaptersResultSchema>;
