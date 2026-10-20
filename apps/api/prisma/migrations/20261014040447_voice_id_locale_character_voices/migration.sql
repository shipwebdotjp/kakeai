-- CreateTable
CREATE TABLE "CharacterVoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterVoice_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CharacterVoice_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId") REFERENCES "VoiceProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Backfill CharacterVoice rows from the previous Character.voiceProfileId column.
INSERT INTO "CharacterVoice" ("id", "characterId", "locale", "voiceProfileId", "position", "createdAt")
SELECT lower(hex(randomblob(12))), "id", 'ja-JP', "voiceProfileId", 0, CURRENT_TIMESTAMP
FROM "Character" WHERE "voiceProfileId" IS NOT NULL;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Character" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Character" ("createdAt", "id", "name", "updatedAt") SELECT "createdAt", "id", "name", "updatedAt" FROM "Character";
DROP TABLE "Character";
ALTER TABLE "new_Character" RENAME TO "Character";
CREATE TABLE "new_VoiceProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "adapterId" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'ja-JP',
    "settingsJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_VoiceProfile" ("adapterId", "createdAt", "id", "name", "settingsJson", "updatedAt") SELECT "adapterId", "createdAt", "id", "name", "settingsJson", "updatedAt" FROM "VoiceProfile";
DROP TABLE "VoiceProfile";
ALTER TABLE "new_VoiceProfile" RENAME TO "VoiceProfile";
CREATE INDEX "VoiceProfile_adapterId_idx" ON "VoiceProfile"("adapterId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill VoiceProfile voiceId and locale from the previous settings shape.
UPDATE "VoiceProfile"
SET "voiceId" = json_extract("settingsJson", '$.speakerUuid') || ':' || CAST(json_extract("settingsJson", '$.defaultStyleId') AS TEXT),
    "locale" = 'ja-JP',
    "settingsJson" = '{}'
WHERE json_extract("settingsJson", '$.speakerUuid') IS NOT NULL
  AND json_extract("settingsJson", '$.defaultStyleId') IS NOT NULL;

-- CreateIndex
CREATE INDEX "CharacterVoice_characterId_idx" ON "CharacterVoice"("characterId");

-- CreateIndex
CREATE INDEX "CharacterVoice_voiceProfileId_idx" ON "CharacterVoice"("voiceProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterVoice_characterId_locale_key" ON "CharacterVoice"("characterId", "locale");
