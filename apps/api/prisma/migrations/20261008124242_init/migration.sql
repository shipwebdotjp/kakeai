-- CreateTable
CREATE TABLE "Work" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "originalLocale" TEXT NOT NULL,
    "parentWorkId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Work_parentWorkId_fkey" FOREIGN KEY ("parentWorkId") REFERENCES "Work" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LanguageEdition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "currentScriptVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LanguageEdition_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LanguageEdition_currentScriptVersionId_fkey" FOREIGN KEY ("currentScriptVersionId") REFERENCES "ScriptVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScriptVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "languageEditionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "contentSchemaVersion" INTEGER NOT NULL,
    "contentJson" TEXT NOT NULL,
    "sourceScriptVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScriptVersion_languageEditionId_fkey" FOREIGN KEY ("languageEditionId") REFERENCES "LanguageEdition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ScriptVersion_sourceScriptVersionId_fkey" FOREIGN KEY ("sourceScriptVersionId") REFERENCES "ScriptVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "durationMs" INTEGER,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "provenanceJson" TEXT,
    "generatedByJobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_generatedByJobId_fkey" FOREIGN KEY ("generatedByJobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssetRendition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "durationMs" INTEGER,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "codecJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetRendition_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "workId" TEXT,
    "assetId" TEXT,
    "languageEditionId" TEXT,
    "scriptVersionId" TEXT,
    "snapshotSchemaVersion" INTEGER NOT NULL,
    "inputSnapshotJson" TEXT NOT NULL,
    "resultJson" TEXT,
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "Job_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_languageEditionId_fkey" FOREIGN KEY ("languageEditionId") REFERENCES "LanguageEdition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_scriptVersionId_fkey" FOREIGN KEY ("scriptVersionId") REFERENCES "ScriptVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" BIGINT NOT NULL,
    "durationMs" INTEGER,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "fps" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LanguageEdition_currentScriptVersionId_key" ON "LanguageEdition"("currentScriptVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "LanguageEdition_workId_locale_key" ON "LanguageEdition"("workId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptVersion_languageEditionId_versionNumber_key" ON "ScriptVersion"("languageEditionId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_sha256_key" ON "Asset"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRendition_assetId_purpose_key" ON "AssetRendition"("assetId", "purpose");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_workId_createdAt_idx" ON "Job"("workId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_assetId_createdAt_idx" ON "Job"("assetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_storageKey_key" ON "Artifact"("storageKey");

-- CreateIndex
CREATE INDEX "Artifact_jobId_idx" ON "Artifact"("jobId");
