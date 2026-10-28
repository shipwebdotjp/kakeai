-- Work-wide thumbnail appearance replaces the Edition-scoped column.
ALTER TABLE "Work" ADD COLUMN "thumbnailAppearanceJson" TEXT;

-- The new appearance contract replaces the single Font Face with locale
-- entries. Existing candidates, selection pointers and appearance presets are
-- old-contract data, so they are discarded rather than migrated. Works,
-- Editions, ScriptVersions and Assets are kept.
UPDATE "LanguageEdition" SET "primaryThumbnailId" = NULL;
DELETE FROM "Thumbnail";
DELETE FROM "ThumbnailAppearancePreset";

ALTER TABLE "LanguageEdition" DROP COLUMN "thumbnailAppearanceJson";
