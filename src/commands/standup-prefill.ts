import { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { buildStandupCollectionModal } from '../utils/formatting.js';
import { openModal } from '../services/slack.js';

export async function handleStandupPrefill({
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

    const member = await prisma.member.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: workspace.id,
          userId: command.user_id,
        },
      },
    });

    if (!member || !member.optedIn) {
      await respond({
        text: '❌ You need to be opted in. Run `/standup optin` first.',
        response_type: 'ephemeral',
      });
      return;
    }

    const modal = buildStandupCollectionModal();
    const modalWithMetadata = {
      ...modal,
      callback_id: 'standup_prefill_modal',
      title: { type: 'plain_text' as const, text: 'Pre-fill Stand-up' },
      private_metadata: JSON.stringify({ workspaceId: workspace.id }),
    };

    await openModal(client, command.trigger_id, modalWithMetadata);

    logger.info({ userId: command.user_id }, 'Prefill modal opened');
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to handle standup prefill');
    await respond({
      text: '❌ Something went wrong. Please try again.',
      response_type: 'ephemeral',
    });
  }
}
