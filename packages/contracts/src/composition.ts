import { z } from "zod";
import { idSchema } from "./content/primitives.ts";

export const canvasProfileSchema = z.enum(["landscape", "portrait"]);

export type CanvasProfile = z.infer<typeof canvasProfileSchema>;

export const DEFAULT_CANVAS_PROFILE: CanvasProfile = "landscape";

export const CANVAS_PROFILE_DIMENSIONS: Record<CanvasProfile, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export const CANVAS_PROFILE_LABELS: Record<CanvasProfile, string> = {
  landscape: "横長 (1920×1080)",
  portrait: "縦長 (1080×1920)",
};

export function canvasProfileDimensions(profile: CanvasProfile): { width: number; height: number } {
  return CANVAS_PROFILE_DIMENSIONS[profile];
}

export function canvasProfileOf(manifest: { canvasProfile?: CanvasProfile | undefined }): CanvasProfile {
  return manifest.canvasProfile ?? DEFAULT_CANVAS_PROFILE;
}

export const compositionManifestSchema = z
  .strictObject({
    entrypoint: z.string().min(1),
    contentHash: z.string().min(1).optional(),
    runtimeCompositionId: z.string().min(1),
    canvasProfile: canvasProfileSchema.optional(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationMs: z.number().int().positive(),
    dependencies: z.array(z.string().min(1)),
  })
  .superRefine((manifest, ctx) => {
    const expected = CANVAS_PROFILE_DIMENSIONS[canvasProfileOf(manifest)];
    if (manifest.width !== expected.width || manifest.height !== expected.height) {
      ctx.addIssue({
        code: "custom",
        path: ["width"],
        message: `寸法は ${expected.width}x${expected.height} (${canvasProfileOf(manifest)}) である必要があります（現在 ${manifest.width}x${manifest.height}）`,
      });
    }
  });

export type CompositionManifest = z.infer<typeof compositionManifestSchema>;

export const compositionDraftFilesSchema = z.strictObject({
  entrypoint: z.string().min(1),
  files: z.record(z.string(), z.string()),
  binaryFiles: z.record(z.string(), z.string()).optional(),
});

export type CompositionDraftFiles = z.infer<typeof compositionDraftFilesSchema>;

export const compositionDraftSchema = z.strictObject({
  id: idSchema,
  compositionId: idSchema,
  entrypoint: z.string().min(1),
  storageKey: z.string().min(1),
  updatedAt: z.string(),
});

export type CompositionDraft = z.infer<typeof compositionDraftSchema>;

export const compositionVersionSchema = z.strictObject({
  id: idSchema,
  compositionId: idSchema,
  versionNumber: z.number().int().positive(),
  bundleHash: z.string().min(1),
  storageKey: z.string().min(1),
  manifest: compositionManifestSchema,
  createdAt: z.string(),
});

export type CompositionVersion = z.infer<typeof compositionVersionSchema>;

export const compositionSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  runtimeCompositionId: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  draft: compositionDraftSchema.nullable().optional(),
  versions: z.array(compositionVersionSchema).optional(),
});

export type Composition = z.infer<typeof compositionSchema>;
