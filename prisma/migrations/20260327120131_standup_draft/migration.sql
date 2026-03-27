-- CreateTable
CREATE TABLE "StandupDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "yesterday" TEXT NOT NULL,
    "today" TEXT NOT NULL,
    "blockers" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StandupDraft_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "StandupDraft_workspaceId_idx" ON "StandupDraft"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "StandupDraft_workspaceId_memberId_key" ON "StandupDraft"("workspaceId", "memberId");
