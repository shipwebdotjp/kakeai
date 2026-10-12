-- CreateTable
CREATE TABLE "Composition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "runtimeCompositionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompositionDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compositionId" TEXT NOT NULL,
    "entrypoint" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompositionDraft_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompositionVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "compositionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "manifestJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CompositionVersion_compositionId_fkey" FOREIGN KEY ("compositionId") REFERENCES "Composition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Composition_runtimeCompositionId_key" ON "Composition"("runtimeCompositionId");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionDraft_compositionId_key" ON "CompositionDraft"("compositionId");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionDraft_storageKey_key" ON "CompositionDraft"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionVersion_storageKey_key" ON "CompositionVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "CompositionVersion_compositionId_versionNumber_key" ON "CompositionVersion"("compositionId", "versionNumber");
