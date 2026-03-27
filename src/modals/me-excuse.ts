import { AllMiddlewareArgs, SlackViewMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { createExcuse } from '../services/excuses.js';

export async function handleExcuseSubmission({
  ack,
  view,
  body,
}: SlackViewMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    const values = view.state.values;
    const startDate = values.start_date_block.start_date_picker.selected_date as string;
    const endDate = values.end_date_block.end_date_picker.selected_date as string;
    const reason = values.reason_block?.reason_input?.value || undefined;

    if (endDate < startDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: 'End date must be on or after start date' },
      });
      return;
    }

    await ack();

    const userId = 'user' in body ? body.user.id : '';
    const teamId =
      ('team' in body ? body.team?.id : undefined) || ('user' in body ? body.user.team_id : '');

    if (!userId || !teamId) {
      logger.error({ body }, 'Missing user or team ID');
      return;
    }

    const member = await prisma.member.findFirst({
      where: {
        userId,
        workspace: { teamId },
      },
    });

    if (!member) {
      logger.error({ userId, teamId }, 'Member not found for excuse creation');
      return;
    }

    await createExcuse(member.id, startDate, endDate, reason);

    logger.info({ userId, memberId: member.id, startDate, endDate }, 'Excuse created via modal');
  } catch (error) {
    logger.error({ error }, 'Failed to handle excuse submission');
    await ack({
      response_action: 'errors',
      errors: { start_date_block: 'Failed to save absence. Please try again.' },
    });
  }
}
