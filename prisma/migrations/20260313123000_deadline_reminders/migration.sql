-- AlterTable
ALTER TABLE "Standup" ADD COLUMN "deadlineAt" DATETIME;

-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "submissionStatus" TEXT NOT NULL DEFAULT 'on_time';

-- CreateTable
CREATE TABLE "ReminderDispatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "standupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "scheduledFor" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failureReason" TEXT,
    CONSTRAINT "ReminderDispatch_standupId_fkey" FOREIGN KEY ("standupId") REFERENCES "Standup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ReminderDispatch_standupId_userId_offsetMinutes_key" ON "ReminderDispatch"("standupId", "userId", "offsetMinutes");

-- CreateIndex
CREATE INDEX "ReminderDispatch_standupId_status_offsetMinutes_idx" ON "ReminderDispatch"("standupId", "status", "offsetMinutes");

-- CreateIndex
CREATE INDEX "ReminderDispatch_scheduledFor_idx" ON "ReminderDispatch"("scheduledFor");
