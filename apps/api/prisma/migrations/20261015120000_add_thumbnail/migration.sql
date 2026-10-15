-- CreateTable
CREATE TABLE "Thumbnail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "languageEditionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "inputJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Thumbnail_languageEditionId_fkey" FOREIGN KEY ("languageEditionId") REFERENCES "LanguageEdition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "LanguageEdition" ADD COLUMN "primaryThumbnailId" TEXT REFERENCES "Thumbnail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "LanguageEdition_primaryThumbnailId_key" ON "LanguageEdition"("primaryThumbnailId");

-- CreateIndex
CREATE INDEX "Thumbnail_languageEditionId_idx" ON "Thumbnail"("languageEditionId");
