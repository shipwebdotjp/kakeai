-- AlterTable
ALTER TABLE "ScriptVersion" ADD COLUMN "author" TEXT NOT NULL DEFAULT 'human';
ALTER TABLE "ScriptVersion" ADD COLUMN "authorAgentId" TEXT;
ALTER TABLE "ScriptVersion" ADD COLUMN "agentRequestId" TEXT;
ALTER TABLE "ScriptVersion" ADD COLUMN "agentRequestHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScriptVersion_languageEditionId_agentRequestId_key" ON "ScriptVersion"("languageEditionId", "agentRequestId");
