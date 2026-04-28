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
import { getExcusedMemberIds } from './excuses.js';
import { resolveUserReminderConfig } from './preferences.js';
import { consumeDraftsForStandup } from './drafts.js';

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
  deadlineAt: Date,
  workspaceId: string
): Promise<number[]> {
  if (userIds.length === 0) {
    return [];
  }

  const allOffsets = new Set<number>();

  for (const userId of userIds) {
    const config = await resolveUserReminderConfig(workspaceId, userId);

    if (!config.enabled) continue;

    for (const offsetMinutes of config.offsets) {
      allOffsets.add(offsetMinutes);

      await prisma.reminderDispatch.upsert({
        where: {
          standupId_userId_offsetMinutes: {
            standupId,
            userId,
            offsetMinutes,
          },
        },
        create: {
          standupId,
          userId,
          offsetMinutes,
          scheduledFor: getReminderScheduleTime(deadlineAt, offsetMinutes),
          status: REMINDER_STATUS.PENDING,
        },
        update: {
          scheduledFor: getReminderScheduleTime(deadlineAt, offsetMinutes),
          status: REMINDER_STATUS.PENDING,
          failureReason: null,
        },
      });
    }
  }

  return [...allOffsets].sort((a, b) => b - a);
}

export async function collectFromUsers(
  client: WebClient,
  workspaceId: string,
  standupId: string,
  triggerId?: string,
  specificUserId?: string
): Promise<number[]> {
  try {
    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      include: { workspace: true },
    });

    if (!standup) {
      logger.error({ workspaceId, standupId }, 'Stand-up not found while collecting from users');
      return [];
    }

    const userIds = specificUserId ? [specificUserId] : await getOptedInUsers(workspaceId);
    const today = getTodayDate(standup.workspace.timezone);
    const excusedUserIds = await getExcusedMemberIds(workspaceId, today);
    const excusedSet = new Set(excusedUserIds);
    const activeUserIds = userIds.filter((id) => !excusedSet.has(id));

    const uniqueOffsets = await seedReminderDispatches(
      standupId,
      activeUserIds,
      standup.deadlineAt ?? new Date(standup.startedAt),
      workspaceId
    );

    logger.info({ workspaceId, standupId, userCount: activeUserIds.length }, 'Starting collection');

    // Auto-submit pre-filled drafts
    const drafts = await consumeDraftsForStandup(workspaceId);
    const draftUserIds = new Set<string>();
    for (const draft of drafts) {
      try {
        await saveEntry(
          standupId,
          draft.userId,
          draft.yesterday,
          draft.today,
          draft.blockers,
          draft.notes
        );
        draftUserIds.add(draft.userId);

        // Send confirmation DM
        const dmChannel = await openDMChannel(client, draft.userId);
        await client.chat.postMessage({
          channel: dmChannel,
          text: '✅ Your pre-filled stand-up has been submitted automatically. Have a great day!',
        });

        logger.info({ userId: draft.userId, standupId }, 'Pre-filled draft auto-submitted');
      } catch (error) {
        logger.error({ error, userId: draft.userId, standupId }, 'Failed to auto-submit draft');
      }
    }

    const modal = buildStandupCollectionModal();
    const deadlineText = standup.deadlineAt
      ? formatDateTime(standup.deadlineAt, standup.workspace.timezone)
      : 'the collection window';

    for (const userId of activeUserIds) {
      // Skip users whose draft was already auto-submitted
      if (draftUserIds.has(userId)) continue;
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
                      text: "Yesterday's Daily",
                    },
                    action_id: 'show_last_entry',
                    value: standupId,
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

    return uniqueOffsets;
  } catch (error) {
    logger.error({ error, workspaceId, standupId }, 'Failed to collect from users');
    throw error;
  }
}

export async function sendRemindersForOffset(
  client: WebClient,
  standupId: string,
  offsetMinutes: number
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

  const today = standup.date;
  const excusedUserIds = new Set(await getExcusedMemberIds(standup.workspaceId, today));

  for (const dispatch of dispatches) {
    try {
      // Skip if user has an excuse (including "Skip Today")
      if (excusedUserIds.has(dispatch.userId)) {
        await prisma.reminderDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: REMINDER_STATUS.SKIPPED,
            failureReason: 'user is excused',
          },
        });
        logger.info(
          { standupId, userId: dispatch.userId, offsetMinutes },
          'Skipped reminder for excused user'
        );
        continue;
      }

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
  notes?: string,
  progressStatus: string = 'on_track'
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
        progressStatus,
      },
      update: {
        yesterday,
        today,
        blockers: blockers || null,
        notes: notes || null,
        updatedAt: now,
        submissionStatus: status,
        progressStatus,
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
