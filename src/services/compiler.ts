import { WebClient } from '@slack/web-api';
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { formatDateTime } from '../utils/date.js';
import {
  buildCompleteStandupBlocks,
  buildCompleteStandupBlocksGrouped,
  buildSummaryBlocks,
  buildExcusedSection,
} from '../utils/formatting.js';
import { postMessage, postThreadReply, updateMessage, getUserInfo } from './slack.js';
import { getStandupEntries } from './collector.js';
import { getOptedInUsers } from './users.js';
import { getExcusedUsersWithReasons } from './excuses.js';
import { SummarizerProvider } from './summarizer/provider.js';

export function filterCompilableEntries<
  T extends {
    submissionStatus?: string | null;
    userId: string;
  },
>(entries: T[]): { onTimeEntries: T[]; lateEntries: T[] } {
  const onTimeEntries = entries.filter((entry) => entry.submissionStatus !== 'late');
  const lateEntries = entries.filter((entry) => entry.submissionStatus === 'late');
  return { onTimeEntries, lateEntries };
}

export async function compileStandup(
  client: WebClient,
  standupId: string,
  summarizer: SummarizerProvider | null
): Promise<string | null> {
  try {
    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      include: {
        workspace: true,
      },
    });

    if (!standup) {
      logger.error({ standupId }, 'Stand-up not found');
      return null;
    }

    if (standup.compiledAt) {
      logger.info({ standupId }, 'Stand-up already compiled');
      return standup.messageTs || null;
    }

    const entries = await getStandupEntries(standupId);
    const { onTimeEntries, lateEntries } = filterCompilableEntries(entries);
    const optedInUsers = await getOptedInUsers(standup.workspaceId);

    // Get user names
    const entryData = await Promise.all(
      onTimeEntries.map(async (entry) => {
        try {
          const userInfo = await getUserInfo(client, entry.userId);
          return {
            userId: entry.userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
            yesterday: entry.yesterday,
            today: entry.today,
            blockers: entry.blockers || undefined,
            notes: entry.notes || undefined,
            progressStatus: entry.progressStatus,
          };
        } catch (error) {
          logger.error({ error, userId: entry.userId }, 'Failed to get user info');
          return {
            userId: entry.userId,
            userName: 'Unknown',
            yesterday: entry.yesterday,
            today: entry.today,
            blockers: entry.blockers || undefined,
            progressStatus: entry.progressStatus,
          };
        }
      })
    );

    const submittedUserIds = new Set(onTimeEntries.map((e) => e.userId));
    const missedUserIds = optedInUsers.filter((id) => !submittedUserIds.has(id));

    // Get names for missed users
    const missedUsers = await Promise.all(
      missedUserIds.map(async (userId) => {
        try {
          const userInfo = await getUserInfo(client, userId);
          return {
            userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
          };
        } catch (error) {
          logger.error({ error, userId }, 'Failed to get missed user info');
          return {
            userId,
            userName: 'Unknown',
          };
        }
      })
    );

    // Get excused users
    const excusedData = await getExcusedUsersWithReasons(standup.workspaceId, standup.date);
    const excusedUserIds = new Set(excusedData.map((e) => e.userId));

    // Filter excused users out of missed list
    const actualMissedUsers = missedUsers.filter((u) => !excusedUserIds.has(u.userId));

    // Get names for excused users
    const excusedUsers = await Promise.all(
      excusedData.map(async (e) => {
        try {
          const userInfo = await getUserInfo(client, e.userId);
          return {
            userId: e.userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
            reason: e.reason,
          };
        } catch (error) {
          logger.error({ error, userId: e.userId }, 'Failed to get excused user info');
          return { userId: e.userId, userName: 'Unknown', reason: e.reason };
        }
      })
    );

    // Post main message
    const deadlineText = standup.deadlineAt
      ? formatDateTime(standup.deadlineAt, standup.workspace.timezone)
      : null;
    const blocks = buildCompleteStandupBlocks(
      standup.date,
      standup.workspace.timezone,
      entryData,
      actualMissedUsers,
      deadlineText
    );

    // Insert excused section
    if (excusedUsers.length > 0) {
      const excusedBlocks = buildExcusedSection(excusedUsers);
      blocks.push(...excusedBlocks);
    }

    const result = await postMessage(
      client,
      standup.channelId,
      blocks,
      `Stand-up for ${standup.date}`
    );

    const messageTs = result.ts as string;

    // Update standup record
    await prisma.standup.update({
      where: { id: standupId },
      data: {
        compiledAt: new Date(),
        messageTs,
      },
    });

    logger.info(
      {
        standupId,
        messageTs,
        channelId: standup.channelId,
        onTimeEntryCount: onTimeEntries.length,
        lateEntryCount: lateEntries.length,
      },
      'Stand-up compiled'
    );

    // Generate summary if enabled
    if (summarizer && standup.workspace.summaryEnabled && onTimeEntries.length > 0) {
      try {
        await generateAndPostSummary(client, standup.channelId, messageTs, entryData, summarizer);
      } catch (error) {
        logger.error({ error, standupId }, 'Failed to generate summary');
      }
    }

    return messageTs;
  } catch (error) {
    logger.error({ error, standupId }, 'Failed to compile stand-up');
    throw error;
  }
}

export async function generateAndPostSummary(
  client: WebClient,
  channelId: string,
  threadTs: string,
  entries: Array<{
    userId: string;
    userName: string;
    yesterday: string;
    today: string;
    blockers?: string;
    notes?: string;
  }>,
  summarizer: SummarizerProvider
): Promise<void> {
  try {
    logger.info({ channelId, threadTs }, 'Generating summary');

    const summary = await summarizer.generateSummary(
      entries.map((e) => ({
        userId: e.userName, // Use userName instead of userId for the summary
        yesterday: e.yesterday,
        today: e.today,
        blockers: e.blockers || undefined,
        notes: e.notes || undefined,
      }))
    );

    const blocks = buildSummaryBlocks(summary.highlights, summary.blockers, summary.actionItems);

    await postThreadReply(client, channelId, threadTs, blocks, 'AI Summary');

    logger.info({ channelId, threadTs }, 'Summary posted');
  } catch (error) {
    logger.error({ error, channelId, threadTs }, 'Failed to generate and post summary');
    throw error;
  }
}

export async function regenerateSummary(
  client: WebClient,
  workspaceId: string,
  date: string,
  summarizer: SummarizerProvider
): Promise<void> {
  try {
    const standup = await prisma.standup.findUnique({
      where: {
        workspaceId_date: {
          workspaceId,
          date,
        },
      },
    });

    if (!standup || !standup.messageTs) {
      throw new Error('Stand-up not found or not compiled');
    }

    const entries = await getStandupEntries(standup.id);

    if (entries.length === 0) {
      throw new Error('No entries found for summary');
    }

    // Get user names for entries
    const entryData = await Promise.all(
      entries.map(async (entry) => {
        try {
          const userInfo = await getUserInfo(client, entry.userId);
          return {
            userId: entry.userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
            yesterday: entry.yesterday,
            today: entry.today,
            blockers: entry.blockers || undefined,
            notes: entry.notes || undefined,
            progressStatus: entry.progressStatus,
          };
        } catch (error) {
          logger.error({ error, userId: entry.userId }, 'Failed to get user info');
          return {
            userId: entry.userId,
            userName: 'Unknown',
            yesterday: entry.yesterday,
            today: entry.today,
            blockers: entry.blockers || undefined,
            progressStatus: entry.progressStatus,
          };
        }
      })
    );

    await generateAndPostSummary(
      client,
      standup.channelId,
      standup.messageTs,
      entryData,
      summarizer
    );
  } catch (error) {
    logger.error({ error, workspaceId, date }, 'Failed to regenerate summary');
    throw error;
  }
}

export async function recompileStandup(
  client: WebClient,
  workspaceId: string,
  date: string
): Promise<void> {
  try {
    const standup = await prisma.standup.findUnique({
      where: {
        workspaceId_date: {
          workspaceId,
          date,
        },
      },
      include: { workspace: true },
    });

    if (!standup || !standup.messageTs) {
      throw new Error('Stand-up not found or not compiled yet');
    }

    const entries = await getStandupEntries(standup.id);

    if (entries.length === 0) {
      throw new Error('No entries found to recompile');
    }

    const { onTimeEntries, lateEntries } = filterCompilableEntries(entries);

    // Resolve user names for all entries
    const resolveEntryData = async (entryList: typeof entries) =>
      Promise.all(
        entryList.map(async (entry) => {
          try {
            const userInfo = await getUserInfo(client, entry.userId);
            return {
              userId: entry.userId,
              userName: userInfo?.real_name || userInfo?.name || 'Unknown',
              yesterday: entry.yesterday,
              today: entry.today,
              blockers: entry.blockers || undefined,
              notes: entry.notes || undefined,
              progressStatus: entry.progressStatus,
            };
          } catch (error) {
            logger.error({ error, userId: entry.userId }, 'Failed to get user info');
            return {
              userId: entry.userId,
              userName: 'Unknown',
              yesterday: entry.yesterday,
              today: entry.today,
              blockers: entry.blockers || undefined,
              progressStatus: entry.progressStatus,
            };
          }
        })
      );

    const onTimeData = await resolveEntryData(onTimeEntries);
    const lateData = await resolveEntryData(lateEntries);

    // Compute updated missed list: opted-in users minus ALL submitters
    const optedInUsers = await getOptedInUsers(standup.workspaceId);
    const allSubmittedUserIds = new Set(entries.map((e) => e.userId));
    const missedUserIds = optedInUsers.filter((id) => !allSubmittedUserIds.has(id));

    const missedUsers = await Promise.all(
      missedUserIds.map(async (userId) => {
        try {
          const userInfo = await getUserInfo(client, userId);
          return {
            userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
          };
        } catch (error) {
          logger.error({ error, userId }, 'Failed to get missed user info');
          return { userId, userName: 'Unknown' };
        }
      })
    );

    const excusedData = await getExcusedUsersWithReasons(standup.workspaceId, standup.date);
    const excusedUserIds = new Set(excusedData.map((e) => e.userId));
    const actualMissedUsers = missedUsers.filter((u) => !excusedUserIds.has(u.userId));

    const excusedUsers = await Promise.all(
      excusedData.map(async (e) => {
        try {
          const userInfo = await getUserInfo(client, e.userId);
          return {
            userId: e.userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
            reason: e.reason,
          };
        } catch (error) {
          logger.error({ error, userId: e.userId }, 'Failed to get excused user info');
          return { userId: e.userId, userName: 'Unknown', reason: e.reason };
        }
      })
    );

    const deadlineText = standup.deadlineAt
      ? formatDateTime(standup.deadlineAt, standup.workspace.timezone)
      : null;

    const blocks = buildCompleteStandupBlocksGrouped(
      standup.date,
      standup.workspace.timezone,
      onTimeData,
      lateData,
      actualMissedUsers,
      deadlineText
    );

    // Insert excused section
    if (excusedUsers.length > 0) {
      const excusedBlocks = buildExcusedSection(excusedUsers);
      blocks.push(...excusedBlocks);
    }

    await updateMessage(
      client,
      standup.channelId,
      standup.messageTs,
      blocks,
      `Stand-up for ${standup.date}`
    );

    logger.info(
      {
        workspaceId,
        date,
        onTimeCount: onTimeData.length,
        lateCount: lateData.length,
        missedCount: missedUsers.length,
      },
      'Stand-up recompiled'
    );
  } catch (error) {
    logger.error({ error, workspaceId, date }, 'Failed to recompile stand-up');
    throw error;
  }
}
