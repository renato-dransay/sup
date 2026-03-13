import { WebClient } from '@slack/web-api';
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import {
  calculateDeadlineAt,
  formatDateTime,
  getReminderScheduleTime,
  getTodayDate,
  isOnTimeSubmission,
} from '../utils/date.js';
import { buildStandupCollectionModal } from '../utils/formatting.js';
import { openDMChannel, openModal } from './slack.js';
import { getOptedInUsers } from './users.js';

const DEFAULT_COLLECTION_WINDOW_MIN = 45;
export const SUBMISSION_STATUS = {
  ON_TIME: 'on_time',
  LATE: 'late',
} as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUS)[keyof typeof SUBMISSION_STATUS];
const REMINDER_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  SKIPPED: 'skipped',
  FAILED: 'failed',
} as const;

export function resolveSubmissionStatus(
  submittedAt: Date,
  deadlineAt?: Date | null
): SubmissionStatus {
  if (!deadlineAt) {
    return SUBMISSION_STATUS.ON_TIME;
  }

  return isOnTimeSubmission(submittedAt, deadlineAt)
    ? SUBMISSION_STATUS.ON_TIME
    : SUBMISSION_STATUS.LATE;
}

export async function createStandup(
  workspaceId: string,
  channelId: string,
  timezone: string,
  collectionWindowMin = DEFAULT_COLLECTION_WINDOW_MIN
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
      logger.info(
        { workspaceId, date, standupId: existing.id },
        'Stand-up already exists for today'
      );
      return existing.id;
    }

    const startedAt = new Date();
    const deadlineAt = calculateDeadlineAt(startedAt, collectionWindowMin);

    const standup = await prisma.standup.create({
      data: {
        workspaceId,
        channelId,
        date,
        startedAt,
        deadlineAt,
      },
    });

    logger.info({ standupId: standup.id, workspaceId, date, deadlineAt }, 'Stand-up created');
    return standup.id;
  } catch (error) {
    logger.error({ error, workspaceId, date }, 'Failed to create stand-up');
    throw error;
  }
}

export async function seedReminderDispatches(
  standupId: string,
  userIds: string[],
  deadlineAt: Date
): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  const reminders = userIds.flatMap((userId) => {
    const offsets = [15, 5];
    return offsets.map((offsetMinutes) => ({
      standupId,
      userId,
      offsetMinutes,
      scheduledFor: getReminderScheduleTime(deadlineAt, offsetMinutes),
      status: REMINDER_STATUS.PENDING,
    }));
  });

  for (const reminder of reminders) {
    await prisma.reminderDispatch.upsert({
      where: {
        standupId_userId_offsetMinutes: {
          standupId: reminder.standupId,
          userId: reminder.userId,
          offsetMinutes: reminder.offsetMinutes,
        },
      },
      create: reminder,
      update: {
        scheduledFor: reminder.scheduledFor,
        status: REMINDER_STATUS.PENDING,
        failureReason: null,
      },
    });
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
    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      include: { workspace: true },
    });

    if (!standup) {
      logger.error({ workspaceId, standupId }, 'Stand-up not found while collecting from users');
      return;
    }

    const userIds = specificUserId ? [specificUserId] : await getOptedInUsers(workspaceId);
    await seedReminderDispatches(
      standupId,
      userIds,
      standup.deadlineAt ?? new Date(standup.startedAt)
    );

    logger.info({ workspaceId, standupId, userCount: userIds.length }, 'Starting collection');

    const modal = buildStandupCollectionModal();
    const deadlineText = standup.deadlineAt
      ? formatDateTime(standup.deadlineAt, standup.workspace.timezone)
      : 'the collection window';

    for (const userId of userIds) {
      try {
        if (triggerId && specificUserId === userId) {
          await openModal(client, triggerId, modal);
        } else {
          const dmChannel = await openDMChannel(client, userId);
          await client.chat.postMessage({
            channel: dmChannel,
            text: `It's time for your daily stand-up. Please submit before ${deadlineText}.`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `👋 It's time for your daily stand-up!\n*Deadline:* ${deadlineText}`,
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

        logger.debug(
          { userId, standupId, deadlineAt: standup.deadlineAt },
          'Collection request sent'
        );
      } catch (error) {
        logger.error({ error, userId, standupId }, 'Failed to send collection request');
      }
    }
  } catch (error) {
    logger.error({ error, workspaceId, standupId }, 'Failed to collect from users');
    throw error;
  }
}

export async function sendRemindersForOffset(
  client: WebClient,
  standupId: string,
  offsetMinutes: 15 | 5
): Promise<void> {
  const dispatches = await prisma.reminderDispatch.findMany({
    where: {
      standupId,
      offsetMinutes,
      status: REMINDER_STATUS.PENDING,
    },
  });

  if (dispatches.length === 0) {
    logger.info({ standupId, offsetMinutes }, 'No pending reminders to dispatch');
    return;
  }

  const standup = await prisma.standup.findUnique({
    where: { id: standupId },
    include: { workspace: true },
  });

  if (!standup) {
    logger.error({ standupId, offsetMinutes }, 'Stand-up not found for reminder dispatch');
    return;
  }

  const deadlineText = standup.deadlineAt
    ? formatDateTime(standup.deadlineAt, standup.workspace.timezone)
    : 'the collection window';

  for (const dispatch of dispatches) {
    try {
      const existingEntry = await prisma.entry.findUnique({
        where: {
          standupId_userId: {
            standupId,
            userId: dispatch.userId,
          },
        },
      });

      if (existingEntry) {
        await prisma.reminderDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: REMINDER_STATUS.SKIPPED,
            failureReason: 'entry already submitted',
          },
        });
        logger.info(
          { standupId, userId: dispatch.userId, offsetMinutes },
          'Skipped reminder for submitted user'
        );
        continue;
      }

      const dmChannel = await openDMChannel(client, dispatch.userId);
      await client.chat.postMessage({
        channel: dmChannel,
        text: `Reminder: ${offsetMinutes} minutes left to submit your stand-up.`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `⏰ Reminder: *${offsetMinutes} minutes* left to submit your stand-up.\n*Deadline:* ${deadlineText}`,
            },
          },
        ],
      });

      await prisma.reminderDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: REMINDER_STATUS.SENT,
          sentAt: new Date(),
        },
      });

      logger.info({ standupId, userId: dispatch.userId, offsetMinutes }, 'Reminder sent');
    } catch (error) {
      await prisma.reminderDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: REMINDER_STATUS.FAILED,
          failureReason: error instanceof Error ? error.message : 'Unknown reminder dispatch error',
        },
      });
      logger.error(
        { error, standupId, userId: dispatch.userId, offsetMinutes },
        'Failed to send reminder'
      );
    }
  }
}

export async function saveEntry(
  standupId: string,
  userId: string,
  yesterday: string,
  today: string,
  blockers?: string,
  notes?: string
): Promise<{ status: SubmissionStatus; deadlineAt: Date | null }> {
  try {
    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      select: { deadlineAt: true },
    });

    const now = new Date();
    const status = resolveSubmissionStatus(now, standup?.deadlineAt);

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
        submissionStatus: status,
      },
      update: {
        yesterday,
        today,
        blockers: blockers || null,
        notes: notes || null,
        updatedAt: now,
        submissionStatus: status,
      },
    });

    logger.info({ standupId, userId, submissionStatus: status }, 'Entry saved');
    return { status, deadlineAt: standup?.deadlineAt ?? null };
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
