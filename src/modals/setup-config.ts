import { AllMiddlewareArgs, SlackViewMiddlewareArgs } from '@slack/bolt';
import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { buildCron, validateTimezone } from '../utils/date.js';
import { scheduleWorkspaceJob, cancelWorkspaceJob } from '../services/scheduler.js';
import { SummarizerProvider } from '../services/summarizer/provider.js';
import { invalidateWorkspaceCache } from '../cache/simple-cache.js';

export function createSetupConfigHandler(
  client: WebClient,
  summarizer: SummarizerProvider | null,
  collectionWindowMin: number
) {
  return async function handleSetupConfig({
    ack,
    view,
    body,
  }: SlackViewMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
    try {
      const values = view.state.values;

      const channelId = values.channel_block.channel_select.selected_conversation as string;
      const timeInput = values.time_block.time_input.value as string;
      const timezone = values.timezone_block.timezone_input.value as string;
      const summaryEnabled =
        (values.summary_block.summary_checkbox.selected_options?.length ?? 0) > 0;

      // Validate time format
      const timeMatch = timeInput.match(/^(\d{1,2}):(\d{2})$/);
      if (!timeMatch) {
        await ack({
          response_action: 'errors',
          errors: {
            time_block: 'Invalid time format. Use HH:MM (e.g., 09:30)',
          },
        });
        return;
      }

      const hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2], 10);

      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        await ack({
          response_action: 'errors',
          errors: {
            time_block: 'Invalid time. Hour must be 0-23, minute must be 0-59',
          },
        });
        return;
      }

      // Validate timezone
      if (!validateTimezone(timezone)) {
        await ack({
          response_action: 'errors',
          errors: {
            timezone_block: 'Invalid timezone. Use IANA timezone format (e.g., Asia/Kolkata)',
          },
        });
        return;
      }

      await ack();

      const teamId =
        ('team' in body ? body.team?.id : undefined) || ('user' in body ? body.user.team_id : '');

      if (!teamId) {
        logger.error({ body }, 'Unable to determine teamId');
        return;
      }

      const cron = buildCron(hour, minute);

      // Upsert workspace configuration
      const workspace = await prisma.workspace.upsert({
        where: { teamId },
        create: {
          teamId,
          defaultChannelId: channelId,
          timezone,
          cron,
          summaryEnabled,
        },
        update: {
          defaultChannelId: channelId,
          timezone,
          cron,
          summaryEnabled,
        },
      });

      // Invalidate cache
      invalidateWorkspaceCache(teamId);

      // Reschedule the job
      cancelWorkspaceJob(workspace.id);
      await scheduleWorkspaceJob(workspace.id, client, summarizer, collectionWindowMin);

      // Send confirmation message
      try {
        await client.chat.postMessage({
          channel: channelId,
          text:
            `✅ Stand-up bot configured successfully!\n\n` +
            `Stand-ups will be collected at *${timeInput}* (${timezone}) and posted here.\n` +
            `AI Summary: ${summaryEnabled ? 'Enabled' : 'Disabled'}\n\n` +
            `Use \`/standup optin\` to participate and \`/standup status\` to view details.`,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (postError: any) {
        // If bot is not in channel, provide helpful message
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (postError?.data?.error === 'not_in_channel') {
          logger.warn({ channelId }, 'Bot not in channel, configuration saved but cannot post');
          // Configuration is still saved, just notify via DM
          try {
            await client.chat.postMessage({
              channel: 'user' in body ? body.user.id : '',
              text:
                `✅ Stand-up bot configured successfully!\n\n` +
                `⚠️ *Important:* Please invite me to <#${channelId}> by typing:\n` +
                `\`/invite @Stand-up Bot\`\n\n` +
                `Stand-ups will be collected at *${timeInput}* (${timezone}).\n` +
                `AI Summary: ${summaryEnabled ? 'Enabled' : 'Disabled'}\n\n` +
                `Use \`/standup optin\` to participate and \`/standup status\` to view details.`,
            });
          } catch (dmError) {
            logger.error({ dmError }, 'Failed to send DM notification');
          }
        } else {
          throw postError;
        }
      }

      logger.info(
        { workspaceId: workspace.id, teamId, channelId, cron, timezone },
        'Workspace configured'
      );
    } catch (error) {
      logger.error({ error, view }, 'Failed to handle setup config');
      await ack({
        response_action: 'errors',
        errors: {
          channel_block: 'Failed to save configuration. Please try again.',
        },
      });
    }
  };
}
