import { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { getTodayDate } from '../utils/date.js';
import { recompileStandup } from '../services/compiler.js';

export function createStandupRecompileHandler() {
  return async function handleStandupRecompile({
    command,
    ack,
    respond,
    client,
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

      const date = getTodayDate(workspace.timezone);

      await respond({
        text: '⏳ Recompiling stand-up with latest entries...',
        response_type: 'ephemeral',
      });

      await recompileStandup(client, workspace.id, date);

      await respond({
        text: '✅ Stand-up recompiled! The message has been updated with all entries (including late submissions).',
        response_type: 'ephemeral',
      });

      logger.info({ userId: command.user_id, workspaceId: workspace.id }, 'Stand-up recompiled');
    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Failed to handle standup recompile');
      await respond({
        text: '❌ Failed to recompile stand-up. Make sure a stand-up was compiled today.',
        response_type: 'ephemeral',
      });
    }
  };
}
