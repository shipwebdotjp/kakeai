-- CreateTable
CREATE TABLE "LiveFormat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "documentJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LiveProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "draftJson" TEXT NOT NULL,
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    "sourceFormatId" TEXT,
    "sourceFormatUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LiveProgramVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "documentJson" TEXT NOT NULL,
    "documentSha256" TEXT NOT NULL,
    "resolutionSnapshotJson" TEXT NOT NULL,
    "resolutionSnapshotSha256" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveProgramVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LiveProgram" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "provenanceJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LiveMaterial_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LiveProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LiveFormat_updatedAt_idx" ON "LiveFormat"("updatedAt");

-- CreateIndex
CREATE INDEX "LiveProgram_updatedAt_idx" ON "LiveProgram"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LiveProgramVersion_programId_versionNumber_key" ON "LiveProgramVersion"("programId", "versionNumber");

-- CreateIndex
CREATE INDEX "LiveProgramVersion_programId_createdAt_idx" ON "LiveProgramVersion"("programId", "createdAt");

-- CreateIndex
CREATE INDEX "LiveMaterial_programId_createdAt_idx" ON "LiveMaterial"("programId", "createdAt");
