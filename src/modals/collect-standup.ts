import { AllMiddlewareArgs, SlackViewMiddlewareArgs, SlackActionMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { saveEntry, SUBMISSION_STATUS, SubmissionStatus } from '../services/collector.js';
import { formatDateTime } from '../utils/date.js';
import {
  buildLastEntryModal,
  buildStandupCollectionModal,
  richTextToMrkdwn,
} from '../utils/formatting.js';
import { openModal } from '../services/slack.js';
import { prisma } from '../db/prismaClient.js';
import { recompileStandup } from '../services/compiler.js';
import { createExcuse } from '../services/excuses.js';
import { getTodayDate } from '../utils/date.js';
import {
  deleteStandupFormDraftByUserId,
  getStandupFormDraftByUserId,
  saveStandupFormDraftByUserId,
  StandupFormDraftValues,
} from '../services/form-drafts.js';

export const DAILY_FORM_ACK_PREFIX = 'Thank you, buddy!';

function parseStandupFormValues(
  values: Record<string, Record<string, unknown>>
): StandupFormDraftValues {
  const getRichText = (blockId: string, actionId: string) => {
    const block = values[blockId];
    if (!block) return undefined;
    const action = block[actionId];
    if (!action) return undefined;
    return (action as Record<string, unknown>).rich_text_value as
      | Parameters<typeof richTextToMrkdwn>[0]
      | undefined;
  };

  const yesterdayRt = getRichText('yesterday_block', 'yesterday_input');
  const todayRt = getRichText('today_block', 'today_input');
  const blockersRt = getRichText('blockers_block', 'blockers_input');
  const notesRt = getRichText('notes_block', 'notes_input');

  return {
    yesterday: yesterdayRt ? richTextToMrkdwn(yesterdayRt) : '',
    today: todayRt ? richTextToMrkdwn(todayRt) : '',
    blockers: blockersRt ? richTextToMrkdwn(blockersRt) || undefined : undefined,
    notes: notesRt ? richTextToMrkdwn(notesRt) || undefined : undefined,
  };
}

function hasDraftContent(values: StandupFormDraftValues): boolean {
  return [values.yesterday, values.today, values.blockers, values.notes].some((value) =>
    Boolean(value?.trim())
  );
}

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

    const standupId = 'value' in action ? (action.value as string) : '';
    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      select: { workspaceId: true },
    });

    if (!standup) {
      logger.error({ standupId, userId: body.user.id }, 'Stand-up not found while opening modal');
      return;
    }

    const draft = await getStandupFormDraftByUserId(standupId, standup.workspaceId, body.user.id);
    const modal = buildStandupCollectionModal({
      notifyOnClose: true,
      initialValues: draft ?? undefined,
    });

    const modalWithMetadata = {
      ...modal,
      private_metadata: JSON.stringify({ standupId, workspaceId: standup.workspaceId }),
    };

    await openModal(client, body.trigger_id, modalWithMetadata);

    logger.info({ userId: body.user.id, standupId }, 'Collection modal opened');
  } catch (error) {
    logger.error({ error }, 'Failed to open standup modal');
  }
}

export async function handleShowLastEntry({
  ack,
  action,
  client,
  body,
}: SlackActionMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    await ack();

    if (!('trigger_id' in body)) {
      logger.error({ body }, 'No trigger_id in body for show last entry');
      return;
    }

    const standupId = 'value' in action ? (action.value as string) : '';
    const currentStandup = await prisma.standup.findUnique({
      where: { id: standupId },
      select: { workspaceId: true },
    });

    if (!currentStandup) {
      logger.error(
        { standupId, userId: body.user.id },
        'Stand-up not found while showing last entry'
      );
      return;
    }

    const lastEntry = await prisma.entry.findFirst({
      where: {
        userId: body.user.id,
        standupId: { not: standupId },
        standup: { workspaceId: currentStandup.workspaceId },
      },
      include: { standup: { select: { date: true } } },
      orderBy: { submittedAt: 'desc' },
    });

    const modal = buildLastEntryModal(
      lastEntry
        ? {
            date: lastEntry.standup.date,
            yesterday: lastEntry.yesterday,
            today: lastEntry.today,
            blockers: lastEntry.blockers,
            notes: lastEntry.notes,
          }
        : null
    );

    await openModal(client, body.trigger_id, modal);

    logger.info(
      { userId: body.user.id, standupId, hasEntry: Boolean(lastEntry) },
      'Last entry modal opened'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to show last entry');
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

    // Look up the standup to find workspace and date
    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      include: { workspace: true },
    });

    if (standup) {
      const userId = body.user.id;
      const today = getTodayDate(standup.workspace.timezone);

      // Find the member record to create an excuse
      const member = await prisma.member.findUnique({
        where: { workspaceId_userId: { workspaceId: standup.workspaceId, userId } },
      });

      if (member) {
        await createExcuse(member.id, today, today, 'Skipped via button');
      }

      // Cancel all pending reminders for this user/standup
      await prisma.reminderDispatch.updateMany({
        where: {
          standupId,
          userId,
          status: 'pending',
        },
        data: {
          status: 'skipped',
          failureReason: 'user skipped standup',
        },
      });
    }

    await client.chat.postMessage({
      channel: body.user.id,
      text: `✅ You've skipped today's stand-up. No worries! See you next time.`,
    });

    logger.info({ userId: body.user.id, standupId }, 'User skipped standup');
  } catch (error) {
    logger.error({ error }, 'Failed to handle skip standup');
  }
}

export async function handleStandupClose({
  ack,
  view,
}: SlackViewMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    await ack();
    const metadata = JSON.parse(view.private_metadata || '{}') as {
      standupId?: string;
    };
    logger.info({ standupId: metadata.standupId }, 'Stand-up modal closed without saving');
  } catch (error) {
    logger.error({ error, view }, 'Failed to handle standup modal close');
  }
}

export async function handleSaveDraft({
  ack,
  body,
  client,
}: SlackActionMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    await ack();

    const view = 'view' in body ? body.view : undefined;
    if (!view) {
      logger.error({ body }, 'No view in body for save draft action');
      return;
    }

    const metadata = JSON.parse(view.private_metadata || '{}') as {
      standupId?: string;
      workspaceId?: string;
    };
    const { standupId, workspaceId } = metadata;

    if (!standupId || !workspaceId) {
      logger.error({ body }, 'Missing metadata for save draft action');
      return;
    }

    const draftValues = parseStandupFormValues(
      view.state.values as Record<string, Record<string, unknown>>
    );

    if (hasDraftContent(draftValues)) {
      await saveStandupFormDraftByUserId(standupId, workspaceId, body.user.id, draftValues);
    } else {
      await deleteStandupFormDraftByUserId(standupId, workspaceId, body.user.id);
    }

    // Close the modal with a confirmation message
    await client.views.update({
      view_id: view.id,
      view: {
        type: 'modal',
        callback_id: 'standup_draft_saved',
        title: { type: 'plain_text', text: 'Daily Stand-up' },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: hasDraftContent(draftValues)
                ? ':white_check_mark: *Draft saved!* Your progress will be restored next time you open this stand-up.'
                : ':information_source: Nothing to save — the form was empty.',
            },
          },
        ],
      },
    });

    logger.info(
      { standupId, workspaceId, userId: body.user.id },
      'Stand-up draft saved via button'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to save standup draft');
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
    const draftValues = parseStandupFormValues(
      view.state.values as Record<string, Record<string, unknown>>
    );

    const metadata = JSON.parse(view.private_metadata || '{}') as {
      standupId?: string;
      workspaceId?: string;
    };
    const { standupId, workspaceId } = metadata;

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
      draftValues.yesterday,
      draftValues.today,
      draftValues.blockers,
      draftValues.notes
    );

    if (workspaceId) {
      await deleteStandupFormDraftByUserId(standupId, workspaceId, body.user.id);
    }

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
      void recompileStandup(client, standup.workspaceId, standup.date).catch(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        (err: unknown) => {
          logger.error({ error: err, standupId }, 'Auto-recompile failed after late submission');
        }
      );
    }

    logger.info(
      { userId: body.user.id, standupId, submissionStatus: status },
      'Stand-up entry submitted'
    );
  } catch (error) {
    logger.error({ error, view }, 'Failed to handle standup submission');
  }
}
