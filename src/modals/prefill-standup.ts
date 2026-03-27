import { AllMiddlewareArgs, SlackViewMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { richTextToMrkdwn } from '../utils/formatting.js';
import { saveDraft } from '../services/drafts.js';

export async function handlePrefillSubmission({
  ack,
  view,
  body,
}: SlackViewMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    await ack();

    const values = view.state.values;
    const getRichText = (blockId: string, actionId: string) => {
      const block = values[blockId];
      if (!block) return undefined;
      const action = block[actionId];
      if (!action) return undefined;
      return (action as unknown as Record<string, unknown>).rich_text_value as
        | Parameters<typeof richTextToMrkdwn>[0]
        | undefined;
    };

    const yesterdayRt = getRichText('yesterday_block', 'yesterday_input');
    const todayRt = getRichText('today_block', 'today_input');
    const yesterday = yesterdayRt ? richTextToMrkdwn(yesterdayRt) : '';
    const today = todayRt ? richTextToMrkdwn(todayRt) : '';
    const blockersRt = getRichText('blockers_block', 'blockers_input');
    const blockers = blockersRt ? richTextToMrkdwn(blockersRt) || undefined : undefined;
    const notesRt = getRichText('notes_block', 'notes_input');
    const notes = notesRt ? richTextToMrkdwn(notesRt) || undefined : undefined;

    const metadata = JSON.parse(view.private_metadata || '{}') as {
      workspaceId?: string;
    };
    const workspaceId = metadata.workspaceId;

    if (!workspaceId) {
      logger.error({ view }, 'No workspaceId in prefill private_metadata');
      return;
    }

    const userId = 'user' in body ? body.user.id : '';
    const member = await prisma.member.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { id: true },
    });

    if (!member) {
      logger.error({ userId, workspaceId }, 'Member not found for prefill');
      return;
    }

    await saveDraft(member.id, workspaceId, yesterday, today, blockers, notes);

    // Send confirmation DM
    logger.info({ userId, workspaceId, memberId: member.id }, 'Standup pre-filled for next daily');
  } catch (error) {
    logger.error({ error, view }, 'Failed to handle prefill submission');
  }
}
