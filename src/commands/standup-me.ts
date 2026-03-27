import { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { buildMeHubBlocks, buildRemindersModal, buildExcuseModal } from '../utils/formatting.js';
import { resolveReminderConfig } from '../services/preferences.js';
import { createExcuse, parseDateArg, getActiveExcuses, getMemberIdByUserId } from '../services/excuses.js';
import { openModal } from '../services/slack.js';

export async function handleStandupMe({
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

    const args = command.text.replace(/^me\s*/, '').trim();
    const subcommand = args.split(' ')[0] || '';

    switch (subcommand) {
      case 'reminders':
        await handleRemindersModal(command, client, workspace);
        break;
      case 'excuse':
        await handleExcuseSubcommand(command, respond, client, workspace, args);
        break;
      case '':
        await handleHub(command, respond, workspace);
        break;
      default:
        await respond({
          text: '❌ Unknown subcommand. Use `/standup me`, `/standup me reminders`, or `/standup me excuse`.',
          response_type: 'ephemeral',
        });
    }
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to handle standup me');
    await respond({
      text: '❌ Something went wrong. Please try again.',
      response_type: 'ephemeral',
    });
  }
}

async function handleHub(
  command: SlackCommandMiddlewareArgs['command'],
  respond: SlackCommandMiddlewareArgs['respond'],
  workspace: { id: string; remindersEnabled: boolean; reminderOffsets: string; timezone: string }
): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: command.user_id } },
    include: { preference: true },
  });

  const config = resolveReminderConfig(workspace, member?.preference ?? null);
  const offsetsLabel = config.offsets.length > 0 ? config.offsets.join(', ') + ' min' : 'None';

  const remindersLabel = member?.preference?.remindersEnabled === null || member?.preference?.remindersEnabled === undefined
    ? `Using workspace default (${config.enabled ? 'On' : 'Off'})`
    : config.enabled ? 'On' : 'Off';

  const memberId = member?.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: workspace.timezone }).format(new Date());
  const excuses = memberId ? await getActiveExcuses(memberId, today) : [];
  const excusesLabel = excuses.length > 0
    ? excuses.map((e) => `${e.startDate}${e.startDate !== e.endDate ? ` – ${e.endDate}` : ''}${e.reason ? ` (${e.reason})` : ''}`).join(', ')
    : 'No upcoming excuses';

  const blocks = buildMeHubBlocks({ remindersLabel, offsetsLabel, excusesLabel });

  await respond({
    blocks,
    text: 'Your Stand-up Preferences',
    response_type: 'ephemeral',
  });
}

async function handleRemindersModal(
  command: SlackCommandMiddlewareArgs['command'],
  client: WebClient,
  workspace: { id: string; reminderOffsets: string }
): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: command.user_id } },
    include: { preference: true },
  });

  const modal = buildRemindersModal({
    remindersEnabled: member?.preference?.remindersEnabled ?? null,
    reminderOffsets: member?.preference?.reminderOffsets ?? null,
    workspaceDefault: workspace.reminderOffsets,
  });

  await openModal(client, command.trigger_id, modal);
}

async function handleExcuseSubcommand(
  command: SlackCommandMiddlewareArgs['command'],
  respond: SlackCommandMiddlewareArgs['respond'],
  client: WebClient,
  workspace: { id: string; timezone: string },
  args: string
): Promise<void> {
  const parts = args.replace(/^excuse\s*/, '').trim().split(/\s+/);
  const firstArg = parts[0] || '';

  // No args → open modal
  if (!firstArg) {
    const modal = buildExcuseModal();
    await openModal(client, command.trigger_id, modal);
    return;
  }

  // Cancel → show active excuses
  if (firstArg === 'cancel') {
    const memberId = await getMemberIdByUserId(workspace.id, command.user_id);
    if (!memberId) {
      await respond({ text: '❌ You are not a member of this workspace. Run `/standup optin` first.', response_type: 'ephemeral' });
      return;
    }

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: workspace.timezone }).format(new Date());
    const excuses = await getActiveExcuses(memberId, today);

    if (excuses.length === 0) {
      await respond({ text: 'No active or upcoming excuses to cancel.', response_type: 'ephemeral' });
      return;
    }

    await respond({
      text: 'Your active excuses:',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Your Active Excuses:*',
          },
        },
        ...excuses.map((e) => ({
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `${e.startDate}${e.startDate !== e.endDate ? ` – ${e.endDate}` : ''}${e.reason ? ` (${e.reason})` : ''}`,
          },
          accessory: {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Cancel' },
            action_id: `cancel_excuse_${e.id}`,
            value: e.id,
            style: 'danger' as const,
          },
        })),
      ],
      response_type: 'ephemeral',
    });
    return;
  }

  // Quick excuse: today, tomorrow, or date range
  const startDate = parseDateArg(firstArg, workspace.timezone);
  if (!startDate) {
    await respond({
      text: '❌ Invalid date. Use `today`, `tomorrow`, or `YYYY-MM-DD`.',
      response_type: 'ephemeral',
    });
    return;
  }

  const secondArg = parts[1];
  const endDate = secondArg ? parseDateArg(secondArg, workspace.timezone) : startDate;
  if (!endDate) {
    await respond({
      text: '❌ Invalid end date. Use `YYYY-MM-DD` format.',
      response_type: 'ephemeral',
    });
    return;
  }

  if (endDate < startDate) {
    await respond({
      text: '❌ End date must be on or after start date.',
      response_type: 'ephemeral',
    });
    return;
  }

  const memberId = await getMemberIdByUserId(workspace.id, command.user_id);
  if (!memberId) {
    await respond({
      text: '❌ You are not a member of this workspace. Run `/standup optin` first.',
      response_type: 'ephemeral',
    });
    return;
  }

  await createExcuse(memberId, startDate, endDate);
  const rangeText = startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  await respond({
    text: `✅ You're excused for ${rangeText}. You won't receive standup prompts during this period.`,
    response_type: 'ephemeral',
  });
}
