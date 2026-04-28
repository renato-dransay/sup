import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';

export const PROGRESS_STATUS = {
  ON_TRACK: 'on_track',
  DELAYED: 'delayed',
} as const;
export type ProgressStatus = (typeof PROGRESS_STATUS)[keyof typeof PROGRESS_STATUS];

export interface StandupFormDraftValues {
  yesterday: string;
  today: string;
  blockers?: string;
  notes?: string;
  progressStatus?: ProgressStatus;
}

async function getMemberId(workspaceId: string, userId: string): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  });

  return member?.id ?? null;
}

export async function getStandupFormDraftByUserId(
  standupId: string,
  workspaceId: string,
  userId: string
) {
  const memberId = await getMemberId(workspaceId, userId);
  if (!memberId) return null;

  return prisma.standupFormDraft.findUnique({
    where: { standupId_memberId: { standupId, memberId } },
  });
}

export async function saveStandupFormDraftByUserId(
  standupId: string,
  workspaceId: string,
  userId: string,
  values: StandupFormDraftValues
): Promise<void> {
  const memberId = await getMemberId(workspaceId, userId);

  if (!memberId) {
    logger.error({ standupId, workspaceId, userId }, 'Member not found for standup form draft');
    return;
  }

  const progressStatus = values.progressStatus ?? PROGRESS_STATUS.ON_TRACK;

  await prisma.standupFormDraft.upsert({
    where: { standupId_memberId: { standupId, memberId } },
    create: {
      standupId,
      memberId,
      yesterday: values.yesterday,
      today: values.today,
      blockers: values.blockers || null,
      notes: values.notes || null,
      progressStatus,
    },
    update: {
      yesterday: values.yesterday,
      today: values.today,
      blockers: values.blockers || null,
      notes: values.notes || null,
      progressStatus,
    },
  });

  logger.info({ standupId, workspaceId, userId }, 'Standup form draft saved');
}

export async function deleteStandupFormDraftByUserId(
  standupId: string,
  workspaceId: string,
  userId: string
): Promise<void> {
  const memberId = await getMemberId(workspaceId, userId);
  if (!memberId) return;

  await prisma.standupFormDraft.deleteMany({
    where: { standupId: standupId, memberId: memberId },
  });
}
