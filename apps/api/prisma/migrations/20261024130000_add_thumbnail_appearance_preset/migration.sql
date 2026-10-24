-- CreateTable
CREATE TABLE "ThumbnailAppearancePreset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "appearanceJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ThumbnailAppearancePreset_updatedAt_idx" ON "ThumbnailAppearancePreset"("updatedAt");
