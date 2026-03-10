import { WebClient } from '@slack/web-api';
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { buildCompleteStandupBlocks, buildSummaryBlocks } from '../utils/formatting.js';
import { postMessage, postThreadReply, getUserInfo } from './slack.js';
import { getStandupEntries } from './collector.js';
import { getOptedInUsers } from './users.js';
import { SummarizerProvider } from './summarizer/provider.js';

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
    const optedInUsers = await getOptedInUsers(standup.workspaceId);

    // Get user names
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
          };
        } catch (error) {
          logger.error({ error, userId: entry.userId }, 'Failed to get user info');
          return {
            userId: entry.userId,
            userName: 'Unknown',
            yesterday: entry.yesterday,
            today: entry.today,
            blockers: entry.blockers || undefined,
          };
        }
      })
    );

    const submittedUserIds = new Set(entries.map((e) => e.userId));
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

    // Post main message
    const blocks = buildCompleteStandupBlocks(
      standup.date,
      standup.workspace.timezone,
      entryData,
      missedUsers
    );

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

    logger.info({ standupId, messageTs, channelId: standup.channelId }, 'Stand-up compiled');

    // Generate summary if enabled
    if (summarizer && standup.workspace.summaryEnabled && entries.length > 0) {
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
          };
        } catch (error) {
          logger.error({ error, userId: entry.userId }, 'Failed to get user info');
          return {
            userId: entry.userId,
            userName: 'Unknown',
            yesterday: entry.yesterday,
            today: entry.today,
            blockers: entry.blockers || undefined,
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
