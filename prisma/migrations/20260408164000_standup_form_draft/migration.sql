-- CreateTable
CREATE TABLE "StandupFormDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "standupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "yesterday" TEXT NOT NULL,
    "today" TEXT NOT NULL,
    "blockers" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StandupFormDraft_standupId_fkey" FOREIGN KEY ("standupId") REFERENCES "Standup" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StandupFormDraft_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StandupFormDraft_standupId_memberId_key" ON "StandupFormDraft"("standupId", "memberId");

-- CreateIndex
CREATE INDEX "StandupFormDraft_standupId_idx" ON "StandupFormDraft"("standupId");

-- CreateIndex
CREATE INDEX "StandupFormDraft_memberId_idx" ON "StandupFormDraft"("memberId");
