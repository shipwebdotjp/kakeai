-- CreateTable
CREATE TABLE "YouTubeVideoSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "languageEditionId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "settingsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "YouTubeVideoSettings_languageEditionId_fkey" FOREIGN KEY ("languageEditionId") REFERENCES "LanguageEdition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "YouTubeSettingsTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "settingsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeVideoSettings_languageEditionId_key" ON "YouTubeVideoSettings"("languageEditionId");

-- CreateIndex
CREATE UNIQUE INDEX "YouTubeSettingsTemplate_name_key" ON "YouTubeSettingsTemplate"("name");

-- CreateIndex
CREATE INDEX "YouTubeSettingsTemplate_updatedAt_idx" ON "YouTubeSettingsTemplate"("updatedAt");

-- Backfill initial settings for existing LanguageEdition rows
INSERT INTO "YouTubeVideoSettings" ("id", "languageEditionId", "schemaVersion", "settingsJson", "createdAt", "updatedAt")
SELECT
    'yvs_' || le.id,
    le.id,
    1,
    '{"schemaVersion":1,"title":' || json_quote(substr(w.title, 1, 100)) || ',"description":"","tags":[],"category":null,"language":' || json_quote(case when instr(le.locale, '-') > 0 then substr(le.locale, 1, instr(le.locale, '-') - 1) else le.locale end) || ',"captionCertification":"none","recordingDetails":null,"educationDetails":null,"shortsRelatedVideo":null,"declarations":{"audience":"not_applicable","ageRestriction":"not_applicable","paidPromotion":"not_applicable","syntheticContent":"not_applicable"},"visibility":"public","publishAt":null,"premiere":false,"license":"youtube","embeddable":true,"notifySubscribers":true,"statisticsVisibility":true,"comments":{"mode":"hold_potentially_inappropriate"},"ratings":true,"chapters":{"automaticChapters":true,"automaticKeyMoments":true},"location":null,"shortsRemix":"allow_video_and_audio"}',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "LanguageEdition" le
JOIN "Work" w ON w.id = le.workId;
