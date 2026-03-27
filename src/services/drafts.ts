import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';

export async function saveDraft(
  memberId: string,
  workspaceId: string,
  yesterday: string,
  today: string,
  blockers?: string,
  notes?: string
): Promise<void> {
  await prisma.standupDraft.upsert({
    where: { workspaceId_memberId: { workspaceId, memberId } },
    create: {
      memberId,
      workspaceId,
      yesterday,
      today,
      blockers: blockers || null,
      notes: notes || null,
    },
    update: {
      yesterday,
      today,
      blockers: blockers || null,
      notes: notes || null,
    },
  });
  logger.info({ memberId, workspaceId }, 'Standup draft saved');
}

export async function getDraft(workspaceId: string, memberId: string) {
  return prisma.standupDraft.findUnique({
    where: { workspaceId_memberId: { workspaceId, memberId } },
  });
}

export async function getDraftByUserId(workspaceId: string, userId: string) {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  });
  if (!member) return null;
  return getDraft(workspaceId, member.id);
}

export async function deleteDraft(workspaceId: string, memberId: string): Promise<void> {
  await prisma.standupDraft
    .delete({
      where: { workspaceId_memberId: { workspaceId, memberId } },
    })
    .catch(() => {
      // Ignore if draft doesn't exist
    });
}

export async function consumeDraftsForStandup(workspaceId: string): Promise<
  Array<{
    userId: string;
    memberId: string;
    yesterday: string;
    today: string;
    blockers?: string;
    notes?: string;
  }>
> {
  const drafts = await prisma.standupDraft.findMany({
    where: { workspaceId },
    include: { member: { select: { userId: true } } },
  });

  if (drafts.length === 0) return [];

  // Delete all consumed drafts
  await prisma.standupDraft.deleteMany({ where: { workspaceId } });

  logger.info({ workspaceId, count: drafts.length }, 'Consumed standup drafts');

  return drafts.map((d) => ({
    userId: d.member.userId,
    memberId: d.memberId,
    yesterday: d.yesterday,
    today: d.today,
    blockers: d.blockers || undefined,
    notes: d.notes || undefined,
  }));
}
