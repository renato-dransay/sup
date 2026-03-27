import { AllMiddlewareArgs, SlackViewMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { upsertMemberPreference } from '../services/preferences.js';
import { validateReminderOffsets, parseReminderOffsets, formatOffsets } from '../utils/date.js';

export async function handleRemindersSubmission({
  ack,
  view,
  body,
}: SlackViewMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    const values = view.state.values;
    const enabledValue =
      values.reminders_enabled_block.reminders_enabled_select.selected_option?.value;
    const offsetsInput = values.reminder_offsets_block?.reminder_offsets_input?.value || '';

    // Validate offsets if provided
    if (offsetsInput.trim()) {
      const error = validateReminderOffsets(offsetsInput);
      if (error) {
        await ack({
          response_action: 'errors',
          errors: { reminder_offsets_block: error },
        });
        return;
      }
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
      logger.error({ userId, teamId }, 'Member not found for preference update');
      return;
    }

    const remindersEnabled = enabledValue === 'default' ? null : enabledValue === 'on';
    const reminderOffsets = offsetsInput.trim()
      ? formatOffsets(parseReminderOffsets(offsetsInput))
      : null;

    await upsertMemberPreference(member.id, { remindersEnabled, reminderOffsets });

    logger.info({ userId, memberId: member.id }, 'Reminder preferences saved');
  } catch (error) {
    logger.error({ error }, 'Failed to handle reminders submission');
    await ack({
      response_action: 'errors',
      errors: { reminders_enabled_block: 'Failed to save preferences. Please try again.' },
    });
  }
}
