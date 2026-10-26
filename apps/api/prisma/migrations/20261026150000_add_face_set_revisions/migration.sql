-- CreateTable
CREATE TABLE "FaceSetRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "faceSetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FaceSetRevision_faceSetId_fkey" FOREIGN KEY ("faceSetId") REFERENCES "FaceSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FaceSetRevision_faceSetId_versionNumber_key" ON "FaceSetRevision"("faceSetId", "versionNumber");

-- Backfill one immutable revision per existing Face Set.
INSERT INTO "FaceSetRevision" ("id", "faceSetId", "versionNumber", "createdAt")
SELECT lower(hex(randomblob(12))), "id", 1, "createdAt" FROM "FaceSet";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FaceLayer" (
    "faceSetRevisionId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "blinkLayerId" TEXT,
    "speakingLayerId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("faceSetRevisionId", "id"),
    CONSTRAINT "FaceLayer_faceSetRevisionId_fkey" FOREIGN KEY ("faceSetRevisionId") REFERENCES "FaceSetRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_FaceLayer" ("faceSetRevisionId", "id", "part", "assetId", "blinkLayerId", "speakingLayerId", "position", "createdAt")
SELECT (SELECT "id" FROM "FaceSetRevision" WHERE "FaceSetRevision"."faceSetId" = "FaceLayer"."faceSetId" AND "FaceSetRevision"."versionNumber" = 1), "id", "part", "assetId", "blinkLayerId", "speakingLayerId", "position", "createdAt"
FROM "FaceLayer";
DROP TABLE "FaceLayer";
ALTER TABLE "new_FaceLayer" RENAME TO "FaceLayer";
CREATE INDEX "FaceLayer_assetId_idx" ON "FaceLayer"("assetId");
CREATE TABLE "new_ExpressionPreset" (
    "faceSetRevisionId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "browLayerId" TEXT,
    "eyeLayerId" TEXT,
    "mouthLayerId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("faceSetRevisionId", "id"),
    CONSTRAINT "ExpressionPreset_faceSetRevisionId_fkey" FOREIGN KEY ("faceSetRevisionId") REFERENCES "FaceSetRevision" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ExpressionPreset" ("faceSetRevisionId", "id", "name", "browLayerId", "eyeLayerId", "mouthLayerId", "position", "createdAt")
SELECT (SELECT "id" FROM "FaceSetRevision" WHERE "FaceSetRevision"."faceSetId" = "ExpressionPreset"."faceSetId" AND "FaceSetRevision"."versionNumber" = 1), "id", "name", "browLayerId", "eyeLayerId", "mouthLayerId", "position", "createdAt"
FROM "ExpressionPreset";
DROP TABLE "ExpressionPreset";
ALTER TABLE "new_ExpressionPreset" RENAME TO "ExpressionPreset";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
