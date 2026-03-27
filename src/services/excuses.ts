import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';

export function isDateInRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

export function parseDateArg(arg: string, timezone: string): string | null {
  const lower = arg.toLowerCase().trim();

  if (lower === 'today') {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  }

  if (lower === 'tomorrow') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(tomorrow);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return lower;
  }

  return null;
}

export async function createExcuse(
  memberId: string,
  startDate: string,
  endDate: string,
  reason?: string
): Promise<string> {
  const excuse = await prisma.excuse.create({
    data: {
      memberId,
      startDate,
      endDate,
      reason: reason || null,
    },
  });
  logger.info({ excuseId: excuse.id, memberId, startDate, endDate }, 'Excuse created');
  return excuse.id;
}

export async function deleteExcuse(excuseId: string): Promise<void> {
  await prisma.excuse.delete({ where: { id: excuseId } });
  logger.info({ excuseId }, 'Excuse deleted');
}

export async function getActiveExcuses(memberId: string, asOfDate: string) {
  return prisma.excuse.findMany({
    where: {
      memberId,
      endDate: { gte: asOfDate },
    },
    orderBy: { startDate: 'asc' },
  });
}

export async function getExcusedMemberIds(workspaceId: string, date: string): Promise<string[]> {
  const members = await prisma.member.findMany({
    where: {
      workspaceId,
      optedIn: true,
      excuses: {
        some: {
          startDate: { lte: date },
          endDate: { gte: date },
        },
      },
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function getExcusedUsersWithReasons(
  workspaceId: string,
  date: string
): Promise<Array<{ userId: string; reason: string | null }>> {
  const members = await prisma.member.findMany({
    where: {
      workspaceId,
      optedIn: true,
      excuses: {
        some: {
          startDate: { lte: date },
          endDate: { gte: date },
        },
      },
    },
    include: {
      excuses: {
        where: {
          startDate: { lte: date },
          endDate: { gte: date },
        },
        take: 1,
      },
    },
  });
  return members.map((m) => ({
    userId: m.userId,
    reason: m.excuses[0]?.reason ?? null,
  }));
}

export async function getMemberIdByUserId(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  });
  return member?.id ?? null;
}
