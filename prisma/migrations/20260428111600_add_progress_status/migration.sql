-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "progressStatus" TEXT NOT NULL DEFAULT 'on_track';

-- AlterTable
ALTER TABLE "StandupFormDraft" ADD COLUMN "progressStatus" TEXT NOT NULL DEFAULT 'on_track';
