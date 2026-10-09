-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CharacterAppearance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "pose" TEXT NOT NULL,
    "label" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterAppearance_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CharacterAppearance" ("assetId", "characterId", "createdAt", "expression", "id", "label", "pose") SELECT "assetId", "characterId", "createdAt", "expression", "id", "label", "pose" FROM "CharacterAppearance";
DROP TABLE "CharacterAppearance";
ALTER TABLE "new_CharacterAppearance" RENAME TO "CharacterAppearance";
CREATE INDEX "CharacterAppearance_characterId_idx" ON "CharacterAppearance"("characterId");
CREATE INDEX "CharacterAppearance_assetId_idx" ON "CharacterAppearance"("assetId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
