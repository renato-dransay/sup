import boltPkg from '@slack/bolt';
import type { App as AppType } from '@slack/bolt';
const { App, LogLevel } = boltPkg;
import { WebClient } from '@slack/web-api';
import { Config } from './config.js';
import { logger } from './utils/logger.js';
import { createSummarizer } from './services/summarizer/openai.js';

// Command handlers
import { handleStandupInit } from './commands/standup-init.js';
import { createStandupTodayHandler } from './commands/standup-today.js';
import { createStandupSummaryHandler } from './commands/standup-summary.js';
import { createStandupRecompileHandler } from './commands/standup-recompile.js';
import { handleStandupConfig } from './commands/standup-config.js';
import { handleStandupOptIn } from './commands/standup-optin.js';
import { handleStandupOptOut } from './commands/standup-optout.js';
import { handleStandupStatus } from './commands/standup-status.js';
import { handleStandupMe } from './commands/standup-me.js';
import { createStandupWeeklyHandler } from './commands/standup-weekly.js';
import { handleStandupPrefill } from './commands/standup-prefill.js';
import { handlePrefillSubmission } from './modals/prefill-standup.js';
import { handleRemindersSubmission } from './modals/me-reminders.js';
import { handleExcuseSubmission } from './modals/me-excuse.js';
import { buildRemindersModal, buildExcuseModal } from './utils/formatting.js';
import { deleteExcuse } from './services/excuses.js';
import { openModal } from './services/slack.js';

// Event handlers
import { handleAppMention } from './events/app_mention.js';

// Modal handlers
import { createSetupConfigHandler } from './modals/setup-config.js';
import {
  handleOpenStandupModal,
  handleStandupClose,
  handleSaveDraft,
  handleSkipStandup,
  handleStandupSubmission,
} from './modals/collect-standup.js';

export function createApp(config: Config): AppType {
  const app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    logLevel: config.logLevel === 'debug' ? LogLevel.DEBUG : LogLevel.INFO,
    // HTTP mode (no Socket Mode)
    processBeforeResponse: true,
  });

  const client = new WebClient(config.slackBotToken);
  const summarizer = createSummarizer(config.openAiApiKey, config.llmBaseUrl, config.llmModel);

  // Middleware for logging
  app.use(async ({ next }) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    logger.debug({ requestId }, 'Incoming request');
    await next();
  });

  // Command listeners
  app.command('/standup', async ({ command, ack, respond }) => {
    await ack();

    const subcommand = command.text.trim().split(' ')[0] || 'help';

    switch (subcommand) {
      case 'help':
      case '':
        await respond({
          text:
            '📋 *Stand-up Bot Commands*\n\n' +
            '• `/standup init` - Set up stand-ups\n' +
            '• `/standup today` - Run stand-up now\n' +
            '• `/standup summary` - Generate summary\n' +
            '• `/standup recompile` - Update message with late submissions\n' +
            '• `/standup config` - Update config\n' +
            '• `/standup optin` - Opt in\n' +
            '• `/standup optout` - Opt out\n' +
            '• `/standup status` - View status\n' +
            '• `/standup me` - Your preferences (reminders, excuses)\n' +
            '• `/standup weekly` - Your personal weekly summary\n' +
            "• `/standup prefill` - Pre-fill tomorrow's stand-up tonight",
          response_type: 'ephemeral',
        });
        break;

      default:
        await respond({
          text: `❌ Unknown command: \`${subcommand}\`. Use \`/standup help\` to see available commands.`,
          response_type: 'ephemeral',
        });
    }
  });

  app.command('/standup-init', handleStandupInit);
  app.command('/standup-today', createStandupTodayHandler(summarizer));
  app.command('/standup-summary', createStandupSummaryHandler(summarizer));
  app.command('/standup-recompile', createStandupRecompileHandler());
  app.command('/standup-config', handleStandupConfig);
  app.command('/standup-optin', handleStandupOptIn);
  app.command('/standup-optout', handleStandupOptOut);
  app.command('/standup-status', handleStandupStatus);
  app.command('/standup-me', handleStandupMe);
  app.command('/standup-weekly', createStandupWeeklyHandler(summarizer));
  app.command('/standup-prefill', handleStandupPrefill);

  // Event listeners
  app.event('app_mention', handleAppMention);

  // Action listeners
  app.action('open_standup_modal', handleOpenStandupModal);
  app.action('skip_standup', handleSkipStandup);
  app.action('save_standup_draft', handleSaveDraft);

  // Hub action buttons
  app.action('open_reminders_modal', async ({ ack, body, client }) => {
    await ack();
    if (!('trigger_id' in body)) return;
    const modal = buildRemindersModal();
    await openModal(client, body.trigger_id, modal);
  });

  app.action('open_excuse_modal', async ({ ack, body, client }) => {
    await ack();
    if (!('trigger_id' in body)) return;
    const modal = buildExcuseModal();
    await openModal(client, body.trigger_id, modal);
  });

  // Cancel excuse action (dynamic action_id)
  app.action(/^cancel_excuse_/, async ({ ack, action, respond }) => {
    await ack();
    const excuseId = 'value' in action ? (action.value as string) : '';
    if (excuseId) {
      try {
        await deleteExcuse(excuseId);
        if (respond) {
          await respond({
            text: '✅ Excuse cancelled.',
            response_type: 'ephemeral',
            replace_original: false,
          });
        }
      } catch (error) {
        logger.error({ error, excuseId }, 'Failed to cancel excuse');
        if (respond) {
          await respond({
            text: '❌ Failed to cancel excuse.',
            response_type: 'ephemeral',
            replace_original: false,
          });
        }
      }
    }
  });

  // View submissions
  app.view('standup_config_modal', createSetupConfigHandler(client, summarizer));
  app.view('standup_collection_modal', handleStandupSubmission);
  app.view({ type: 'view_closed', callback_id: 'standup_collection_modal' }, handleStandupClose);
  app.view('standup_prefill_modal', handlePrefillSubmission);
  app.view('standup_me_reminders_modal', handleRemindersSubmission);
  app.view('standup_me_excuse_modal', handleExcuseSubmission);

  // Error handling
  // eslint-disable-next-line @typescript-eslint/require-await
  app.error(async (error) => {
    logger.error({ error }, 'Unhandled error in Slack app');
  });

  return app;
}
