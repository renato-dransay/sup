import { WebClient } from '@slack/web-api';
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { userOptInCache } from '../cache/simple-cache.js';

export async function setUserOptIn(
  workspaceId: string,
  userId: string,
  optedIn: boolean
): Promise<void> {
  try {
    await prisma.member.upsert({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
      create: {
        workspaceId,
        userId,
        optedIn,
      },
      update: {
        optedIn,
      },
    });

    // Invalidate cache
    const cacheKey = `${workspaceId}:${userId}`;
    userOptInCache.delete(cacheKey);

    logger.info({ workspaceId, userId, optedIn }, 'User opt-in status updated');
  } catch (error) {
    logger.error({ error, workspaceId, userId }, 'Failed to update user opt-in status');
    throw error;
  }
}

/**
 * Filters a list of opted-in user IDs down to those whose Slack accounts are
 * still active, and prunes any deactivated accounts (optedIn=false) so they
 * stop receiving stand-ups permanently. Fails safe: if a user's status can't
 * be determined, the user is kept rather than removed.
 */
export async function filterActiveUsers(
  client: WebClient,
  workspaceId: string,
  userIds: string[]
): Promise<string[]> {
  const active: string[] = [];
  const deactivated: string[] = [];

  for (const userId of userIds) {
    try {
      const result = await client.users.info({ user: userId });
      if (result.user?.deleted) {
        deactivated.push(userId);
      } else {
        active.push(userId);
      }
    } catch (error) {
      logger.warn(
        { error, workspaceId, userId },
        'Could not determine Slack activation status; keeping user'
      );
      active.push(userId);
    }
  }

  if (deactivated.length > 0) {
    await prisma.member.updateMany({
      where: { workspaceId, userId: { in: deactivated } },
      data: { optedIn: false },
    });

    for (const userId of deactivated) {
      userOptInCache.delete(`${workspaceId}:${userId}`);
    }

    logger.info(
      { workspaceId, userIds: deactivated },
      'Pruned deactivated Slack users from stand-ups'
    );
  }

  return active;
}

export async function getOptedInUsers(workspaceId: string): Promise<string[]> {
  try {
    const members = await prisma.member.findMany({
      where: {
        workspaceId,
        optedIn: true,
      },
      select: {
        userId: true,
      },
    });

    return members.map((m) => m.userId);
  } catch (error) {
    logger.error({ error, workspaceId }, 'Failed to get opted-in users');
    throw error;
  }
}

export async function getUserOptInStatus(workspaceId: string, userId: string): Promise<boolean> {
  const cacheKey = `${workspaceId}:${userId}`;

  // Check cache first
  const cached = userOptInCache.get(cacheKey);
  if (cached !== null) {
    return cached;
  }

  try {
    const member = await prisma.member.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId,
        },
      },
    });

    const result = member?.optedIn ?? false;

    // Cache the result
    userOptInCache.set(cacheKey, result);

    return result;
  } catch (error) {
    logger.error({ error, workspaceId, userId }, 'Failed to get user opt-in status');
    return false;
  }
}

export async function ensureMembersExist(workspaceId: string, userIds: string[]): Promise<void> {
  try {
    const existingMembers = await prisma.member.findMany({
      where: {
        workspaceId,
        userId: {
          in: userIds,
        },
      },
      select: {
        userId: true,
      },
    });

    const existingUserIds = new Set(existingMembers.map((m) => m.userId));
    const newUserIds = userIds.filter((id) => !existingUserIds.has(id));

    if (newUserIds.length > 0) {
      await prisma.member.createMany({
        data: newUserIds.map((userId) => ({
          workspaceId,
          userId,
          optedIn: true, // Default to opted in
        })),
      });

      logger.info({ workspaceId, count: newUserIds.length }, 'Created new members');
    }
  } catch (error) {
    logger.error({ error, workspaceId }, 'Failed to ensure members exist');
    throw error;
  }
}
