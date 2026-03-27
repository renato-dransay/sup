import { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { getTodayDate } from '../utils/date.js';
import {
  getUserWeeklyEntries,
  generatePersonalWeeklySummary,
  getWeekDateRange,
} from '../services/weekly-summary.js';
import { buildWeeklySummaryBlocks } from '../utils/formatting.js';
import { SummarizerProvider } from '../services/summarizer/provider.js';

export function createStandupWeeklyHandler(summarizer: SummarizerProvider | null) {
  return async function handleStandupWeekly({
    command,
    ack,
    respond,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
    try {
      await ack();

      const workspace = await prisma.workspace.findUnique({
        where: { teamId: command.team_id },
      });

      if (!workspace) {
        await respond({
          text: '❌ Workspace not configured. Please run `/standup init` first.',
          response_type: 'ephemeral',
        });
        return;
      }

      const today = getTodayDate(workspace.timezone);
      const { start, end } = getWeekDateRange(today);
      const entries = await getUserWeeklyEntries(command.user_id, workspace.id, today);

      let aiSummary: string | undefined;
      if (summarizer && entries.length > 0) {
        try {
          aiSummary = await generatePersonalWeeklySummary(entries, summarizer);
        } catch (error) {
          logger.error({ error }, 'Failed to generate weekly AI summary');
        }
      }

      const dateRange = `${start} – ${end}`;
      const blocks = buildWeeklySummaryBlocks(dateRange, entries, aiSummary);

      await respond({
        blocks,
        text: `Your Week (${dateRange})`,
        response_type: 'ephemeral',
      });

      logger.info(
        { userId: command.user_id, entryCount: entries.length },
        'Weekly summary generated'
      );
    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Failed to generate weekly summary');
      await respond({
        text: '❌ Failed to generate weekly summary. Please try again.',
        response_type: 'ephemeral',
      });
    }
  };
}
