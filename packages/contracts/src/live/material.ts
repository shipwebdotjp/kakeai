import { z } from "zod";
import { idSchema, positiveInt, timestampSchema } from "../content/primitives";
import { sceneSchema } from "../content/scene";
import { liveAssetSnapshotSchema } from "./snapshot";

export const LIVE_MATERIAL_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const LIVE_MATERIAL_DEFAULT_DURATION_MS = 4_000;
export const LIVE_MATERIAL_MAX_DURATION_MS = 30_000;

export const liveMaterialFormatSchema = z.enum(["png", "html", "mp4"]);
export type LiveMaterialFormat = z.infer<typeof liveMaterialFormatSchema>;

export const liveMaterialDurationMsSchema = positiveInt.max(
  LIVE_MATERIAL_MAX_DURATION_MS,
);
export type LiveMaterialDurationMs = z.infer<typeof liveMaterialDurationMsSchema>;

/**
 * A program-owned Live Material. The scene, every image it renders and the
 * selected output format are copied at import time; the document only keeps
 * `materials[].id`. Work and Scene ids live in provenance and are never
 * resolved again.
 */
export const liveMaterialSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(LIVE_MATERIAL_SNAPSHOT_SCHEMA_VERSION),
    format: liveMaterialFormatSchema,
    durationMs: liveMaterialDurationMsSchema,
    scene: sceneSchema,
    assets: z.array(liveAssetSnapshotSchema),
  })
  .superRefine((snapshot, ctx) => {
    const assetIds = new Set<string>();
    for (const [index, asset] of snapshot.assets.entries()) {
      if (assetIds.has(asset.assetId)) {
        ctx.addIssue({
          code: "custom",
          path: ["assets", index, "assetId"],
          message: `素材 Asset が重複しています: ${asset.assetId}`,
        });
      }
      assetIds.add(asset.assetId);
    }
  });
export type LiveMaterialSnapshot = z.infer<typeof liveMaterialSnapshotSchema>;

export const liveMaterialProvenanceSchema = z.strictObject({
  workId: idSchema,
  sceneId: idSchema,
  importedAt: timestampSchema,
});
export type LiveMaterialProvenance = z.infer<typeof liveMaterialProvenanceSchema>;
