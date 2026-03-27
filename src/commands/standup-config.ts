import { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { buildConfigModal } from '../utils/formatting.js';
import { parseCron } from '../utils/date.js';
import { openModal } from '../services/slack.js';

export async function handleStandupConfig({
  command,
  ack,
  client,
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

    const cronParsed = parseCron(workspace.cron);

    const modal = buildConfigModal({
      channelId: workspace.defaultChannelId,
      timezone: workspace.timezone,
      hour: cronParsed?.hour,
      minute: cronParsed?.minute,
      summaryEnabled: workspace.summaryEnabled,
      collectionWindowMin: workspace.collectionWindowMin,
      remindersEnabled: workspace.remindersEnabled,
      reminderOffsets: workspace.reminderOffsets,
    });

    await openModal(client, command.trigger_id, modal);

    logger.info({ userId: command.user_id, workspaceId: workspace.id }, 'Config modal opened');
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to handle standup config');
    await respond({
      text: '❌ Failed to open configuration. Please try again.',
      response_type: 'ephemeral',
    });
  }
}
