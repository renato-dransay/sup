import { WebClient } from '@slack/web-api';
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { getTodayDate } from '../utils/date.js';
import { buildStandupCollectionModal } from '../utils/formatting.js';
import { openDMChannel, openModal } from './slack.js';
import { getOptedInUsers } from './users.js';

export async function createStandup(
  workspaceId: string,
  channelId: string,
  timezone: string
): Promise<string> {
  const date = getTodayDate(timezone);

  try {
    // Check if standup already exists for today
    const existing = await prisma.standup.findUnique({
      where: {
        workspaceId_date: {
          workspaceId,
          date,
        },
      },
    });

    if (existing) {
      logger.info({ workspaceId, date }, 'Stand-up already exists for today');
      return existing.id;
    }

    const standup = await prisma.standup.create({
      data: {
        workspaceId,
        channelId,
        date,
        startedAt: new Date(),
      },
    });

    logger.info({ standupId: standup.id, workspaceId, date }, 'Stand-up created');
    return standup.id;
  } catch (error) {
    logger.error({ error, workspaceId, date }, 'Failed to create stand-up');
    throw error;
  }
}

export async function collectFromUsers(
  client: WebClient,
  workspaceId: string,
  standupId: string,
  triggerId?: string,
  specificUserId?: string
): Promise<void> {
  try {
    const userIds = specificUserId ? [specificUserId] : await getOptedInUsers(workspaceId);

    logger.info({ workspaceId, standupId, userCount: userIds.length }, 'Starting collection');

    const modal = buildStandupCollectionModal();

    for (const userId of userIds) {
      try {
        if (triggerId && specificUserId === userId) {
          // If we have a trigger ID and this is the specific user, use it
          await openModal(client, triggerId, modal);
        } else {
          // Otherwise, open a DM and send the modal prompt
          const dmChannel = await openDMChannel(client, userId);
          await client.chat.postMessage({
            channel: dmChannel,
            text: "It's time for your daily stand-up! Please click the button below to submit.",
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: "👋 It's time for your daily stand-up!",
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: 'Submit Stand-up',
                    },
                    action_id: 'open_standup_modal',
                    value: standupId,
                    style: 'primary',
                  },
                  {
                    type: 'button',
                    text: {
                      type: 'plain_text',
                      text: 'Skip Today',
                    },
                    action_id: 'skip_standup',
                    value: standupId,
                  },
                ],
              },
            ],
          });
        }

        logger.debug({ userId, standupId }, 'Collection request sent');
      } catch (error) {
        logger.error({ error, userId, standupId }, 'Failed to send collection request');
      }
    }
  } catch (error) {
    logger.error({ error, workspaceId, standupId }, 'Failed to collect from users');
    throw error;
  }
}

export async function saveEntry(
  standupId: string,
  userId: string,
  yesterday: string,
  today: string,
  blockers?: string,
  notes?: string
): Promise<void> {
  try {
    await prisma.entry.upsert({
      where: {
        standupId_userId: {
          standupId,
          userId,
        },
      },
      create: {
        standupId,
        userId,
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
        updatedAt: new Date(),
      },
    });

    logger.info({ standupId, userId }, 'Entry saved');
  } catch (error) {
    logger.error({ error, standupId, userId }, 'Failed to save entry');
    throw error;
  }
}

export async function getStandupEntries(standupId: string) {
  try {
    const entries = await prisma.entry.findMany({
      where: {
        standupId,
      },
      orderBy: {
        submittedAt: 'asc',
      },
    });

    return entries;
  } catch (error) {
    logger.error({ error, standupId }, 'Failed to get entries');
    throw error;
  }
}
