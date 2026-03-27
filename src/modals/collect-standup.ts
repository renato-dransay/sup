import { AllMiddlewareArgs, SlackViewMiddlewareArgs, SlackActionMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { saveEntry, SUBMISSION_STATUS, SubmissionStatus } from '../services/collector.js';
import { formatDateTime } from '../utils/date.js';
import { buildStandupCollectionModal, richTextToMrkdwn } from '../utils/formatting.js';
import { openModal } from '../services/slack.js';
import { prisma } from '../db/prismaClient.js';
import { recompileStandup } from '../services/compiler.js';

export const DAILY_FORM_ACK_PREFIX = 'Thank you, buddy!';

export function buildSubmissionConfirmationText(
  status: SubmissionStatus,
  deadlineText: string
): string {
  if (status === SUBMISSION_STATUS.ON_TIME) {
    return `${DAILY_FORM_ACK_PREFIX} Your stand-up has been submitted successfully.`;
  }

  return `${DAILY_FORM_ACK_PREFIX} The submission window closed at ${deadlineText}. Your update was saved as late and will be excluded from today's summary.`;
}

export async function handleOpenStandupModal({
  ack,
  action,
  client,
  body,
}: SlackActionMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    await ack();

    if (!('trigger_id' in body)) {
      logger.error({ body }, 'No trigger_id in body');
      return;
    }

    const modal = buildStandupCollectionModal();
    const standupId = 'value' in action ? (action.value as string) : '';

    // Store standupId in private_metadata
    const modalWithMetadata = {
      ...modal,
      private_metadata: JSON.stringify({ standupId }),
    };

    await openModal(client, body.trigger_id, modalWithMetadata);

    logger.info({ userId: body.user.id, standupId }, 'Collection modal opened');
  } catch (error) {
    logger.error({ error }, 'Failed to open standup modal');
  }
}

export async function handleSkipStandup({
  ack,
  action,
  client,
  body,
}: SlackActionMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    await ack();

    const standupId = 'value' in action ? (action.value as string) : '';

    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ You've skipped today's stand-up. No worries! See you next time.`,
    });

    logger.info({ userId: body.user.id, standupId }, 'User skipped standup');
  } catch (error) {
    logger.error({ error }, 'Failed to handle skip standup');
  }
}

export async function handleStandupSubmission({
  ack,
  view,
  body,
  client,
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

    const metadata = JSON.parse(view.private_metadata || '{}') as { standupId?: string };
    const standupId = metadata.standupId;

    if (!standupId) {
      logger.error({ view }, 'No standupId in private_metadata');
      return;
    }

    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      include: { workspace: true },
    });

    const { status, deadlineAt } = await saveEntry(
      standupId,
      body.user.id,
      yesterday,
      today,
      blockers,
      notes
    );

    // Send confirmation DM
    const deadlineText =
      deadlineAt && standup?.workspace?.timezone
        ? formatDateTime(deadlineAt, standup.workspace.timezone)
        : 'the submission deadline';
    const confirmationText = buildSubmissionConfirmationText(status, deadlineText);

    await client.chat.postMessage({
      channel: body.user.id,
      text: confirmationText,
    });

    // Auto-recompile if this was a late submission and standup is already compiled
    if (status === SUBMISSION_STATUS.LATE && standup?.compiledAt) {
      void recompileStandup(client, standup.workspaceId, standup.date).catch((err) => {
        logger.error({ error: err, standupId }, 'Auto-recompile failed after late submission');
      });
    }

    logger.info(
      { userId: body.user.id, standupId, submissionStatus: status },
      'Stand-up entry submitted'
    );
  } catch (error) {
    logger.error({ error, view }, 'Failed to handle standup submission');
  }
}
