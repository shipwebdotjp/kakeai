-- Composition ownership: work-scoped, shared, or unclassified (legacy rows).
-- The reference-based backfill runs once at startup because it has to parse
-- ScriptVersion.contentJson; this migration only adds the columns.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Composition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "runtimeCompositionId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'unclassified',
    "workId" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    CONSTRAINT "Composition_workId_fkey" FOREIGN KEY ("workId") REFERENCES "Work" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Composition" ("id", "name", "runtimeCompositionId", "scope", "workId", "archivedAt", "createdAt", "updatedAt")
SELECT "id", "name", "runtimeCompositionId", 'unclassified', NULL, NULL, "createdAt", "updatedAt"
FROM "Composition";
DROP TABLE "Composition";
ALTER TABLE "new_Composition" RENAME TO "Composition";
CREATE UNIQUE INDEX "Composition_runtimeCompositionId_key" ON "Composition"("runtimeCompositionId");
CREATE INDEX "Composition_workId_idx" ON "Composition"("workId");
CREATE INDEX "Composition_scope_idx" ON "Composition"("scope");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
