import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';

export interface StandupFormDraftValues {
  yesterday: string;
  today: string;
  blockers?: string;
  notes?: string;
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

  await prisma.standupFormDraft.upsert({
    where: { standupId_memberId: { standupId, memberId } },
    create: {
      standupId,
      memberId,
      yesterday: values.yesterday,
      today: values.today,
      blockers: values.blockers || null,
      notes: values.notes || null,
    },
    update: {
      yesterday: values.yesterday,
      today: values.today,
      blockers: values.blockers || null,
      notes: values.notes || null,
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

  await prisma.standupFormDraft
    .delete({
      where: { standupId_memberId: { standupId, memberId } },
    })
    .catch(() => {
      // Ignore if draft doesn't exist
    });
}
