-- CreateTable
CREATE TABLE "AgentRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operation" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentRequest_operation_agentId_requestId_key" ON "AgentRequest"("operation", "agentId", "requestId");

-- CreateIndex
CREATE INDEX "AgentRequest_createdAt_idx" ON "AgentRequest"("createdAt");
