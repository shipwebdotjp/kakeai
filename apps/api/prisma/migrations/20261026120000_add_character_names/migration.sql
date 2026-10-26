-- CreateTable
CREATE TABLE "CharacterName" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterName_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CharacterName_characterId_idx" ON "CharacterName"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterName_characterId_locale_key" ON "CharacterName"("characterId", "locale");
