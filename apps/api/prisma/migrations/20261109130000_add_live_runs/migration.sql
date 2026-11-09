-- CreateTable
CREATE TABLE "LiveRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programVersionId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "packagePath" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceJson" TEXT NOT NULL,
    "startAt" DATETIME,
    "requestedPort" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "controlUrl" TEXT,
    "controlTokenRef" TEXT,
    "pid" INTEGER,
    "logDir" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "launchedAt" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveRun_programVersionId_fkey" FOREIGN KEY ("programVersionId") REFERENCES "LiveProgramVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LiveRun_status_createdAt_idx" ON "LiveRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "LiveRun_createdAt_idx" ON "LiveRun"("createdAt");
