-- CreateTable
CREATE TABLE "MemberPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "remindersEnabled" BOOLEAN,
    "reminderOffsets" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemberPreference_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Excuse" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Excuse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "defaultChannelId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "cron" TEXT NOT NULL DEFAULT '30 9 * * *',
    "summaryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "collectionWindowMin" INTEGER NOT NULL DEFAULT 45,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reminderOffsets" TEXT NOT NULL DEFAULT '15,5',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Workspace" ("createdAt", "cron", "defaultChannelId", "id", "summaryEnabled", "teamId", "timezone", "updatedAt") SELECT "createdAt", "cron", "defaultChannelId", "id", "summaryEnabled", "teamId", "timezone", "updatedAt" FROM "Workspace";
DROP TABLE "Workspace";
ALTER TABLE "new_Workspace" RENAME TO "Workspace";
CREATE UNIQUE INDEX "Workspace_teamId_key" ON "Workspace"("teamId");
CREATE INDEX "Workspace_teamId_idx" ON "Workspace"("teamId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MemberPreference_memberId_key" ON "MemberPreference"("memberId");

-- CreateIndex
CREATE INDEX "MemberPreference_memberId_idx" ON "MemberPreference"("memberId");

-- CreateIndex
CREATE INDEX "Excuse_memberId_startDate_endDate_idx" ON "Excuse"("memberId", "startDate", "endDate");
