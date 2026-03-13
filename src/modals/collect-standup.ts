import { AllMiddlewareArgs, SlackViewMiddlewareArgs, SlackActionMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { saveEntry, SUBMISSION_STATUS, SubmissionStatus } from '../services/collector.js';
import { formatDateTime } from '../utils/date.js';
import { buildStandupCollectionModal } from '../utils/formatting.js';
import { openModal } from '../services/slack.js';
import { prisma } from '../db/prismaClient.js';

export function buildSubmissionConfirmationText(
  status: SubmissionStatus,
  deadlineText: string
): string {
  if (status === SUBMISSION_STATUS.ON_TIME) {
    return '✅ Thank you, buddy! Your stand-up has been submitted successfully.';
  }

  return `⏰ The submission window closed at ${deadlineText}. Your update was saved as late and will be excluded from today's summary.`;
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
    const yesterday = values.yesterday_block.yesterday_input.value as string;
    const today = values.today_block.today_input.value as string;
    const blockers = (values.blockers_block.blockers_input.value as string) || undefined;
    const notes = (values.notes_block?.notes_input?.value as string) || undefined;

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

    logger.info(
      { userId: body.user.id, standupId, submissionStatus: status },
      'Stand-up entry submitted'
    );
  } catch (error) {
    logger.error({ error, view }, 'Failed to handle standup submission');
  }
}
