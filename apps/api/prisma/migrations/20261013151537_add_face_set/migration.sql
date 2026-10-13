-- AlterTable
ALTER TABLE "CharacterAppearance" ADD COLUMN "faceSetId" TEXT;

-- CreateTable
CREATE TABLE "FaceSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FaceLayer" (
    "faceSetId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "blinkLayerId" TEXT,
    "speakingLayerId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("faceSetId", "id"),
    CONSTRAINT "FaceLayer_faceSetId_fkey" FOREIGN KEY ("faceSetId") REFERENCES "FaceSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpressionPreset" (
    "faceSetId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "browLayerId" TEXT,
    "eyeLayerId" TEXT,
    "mouthLayerId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("faceSetId", "id"),
    CONSTRAINT "ExpressionPreset_faceSetId_fkey" FOREIGN KEY ("faceSetId") REFERENCES "FaceSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FaceLayer_assetId_idx" ON "FaceLayer"("assetId");

-- CreateIndex
CREATE INDEX "CharacterAppearance_faceSetId_idx" ON "CharacterAppearance"("faceSetId");

