import { Block, KnownBlock } from '@slack/web-api';

export interface StandupEntry {
  userId: string;
  userName: string;
  yesterday: string;
  today: string;
  blockers?: string;
  notes?: string;
}

export function buildStandupHeaderBlocks(date: string, timezone: string): KnownBlock[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📋 Stand-up – ${date}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `*Timezone:* ${timezone} | *Generated:* <!date^${Math.floor(Date.now() / 1000)}^{date_pretty} at {time}|${new Date().toISOString()}>`,
        },
      ],
    },
    {
      type: 'divider',
    },
  ];
}

export function buildEntryBlock(entry: StandupEntry): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*<@${entry.userId}>*`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Yesterday:*\n${entry.yesterday}`,
        },
        {
          type: 'mrkdwn',
          text: `*Today:*\n${entry.today}`,
        },
      ],
    },
  ];

  if (entry.blockers && entry.blockers.trim()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Blockers & Risks:* 🚧\n${entry.blockers}`,
      },
    });
  }

  if (entry.notes && entry.notes.trim()) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Additional Notes:* 📝\n${entry.notes}`,
      },
    });
  }

  blocks.push({
    type: 'divider',
  });

  return blocks;
}

export function buildMissedSection(
  missedUsers: Array<{ userId: string; userName: string }>
): KnownBlock[] {
  if (missedUsers.length === 0) return [];

  const userNames = missedUsers.map((u) => u.userName).join(', ');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Missed:* ${userNames}`,
      },
    },
  ];
}

export function buildCompleteStandupBlocks(
  date: string,
  timezone: string,
  entries: StandupEntry[],
  missedUsers: Array<{ userId: string; userName: string }>
): (Block | KnownBlock)[] {
  const blocks: (Block | KnownBlock)[] = [...buildStandupHeaderBlocks(date, timezone)];

  entries.forEach((entry) => {
    blocks.push(...buildEntryBlock(entry));
  });

  if (missedUsers.length > 0) {
    blocks.push(...buildMissedSection(missedUsers));
  }

  return blocks;
}

export function buildSummaryBlocks(
  highlights: string,
  blockers: string,
  actionItems: string
): (Block | KnownBlock)[] {
  return [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: '✨ AI Summary',
        emoji: true,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*📌 Highlights*\n${highlights}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🚧 Blockers & Risks*\n${blockers}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*✅ Action Items*\n${actionItems}`,
      },
    },
  ];
}

export function buildConfigModal(currentConfig?: {
  channelId?: string;
  timezone?: string;
  hour?: number;
  minute?: number;
  summaryEnabled?: boolean;
}): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
} {
  return {
    type: 'modal',
    callback_id: 'standup_config_modal',
    title: {
      type: 'plain_text',
      text: 'Configure Stand-up',
    },
    submit: {
      type: 'plain_text',
      text: 'Save',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'channel_block',
        element: {
          type: 'conversations_select',
          action_id: 'channel_select',
          placeholder: {
            type: 'plain_text',
            text: 'Select a channel',
          },
          filter: {
            include: ['public', 'private'],
          },
          ...(currentConfig?.channelId && { initial_conversation: currentConfig.channelId }),
        },
        label: {
          type: 'plain_text',
          text: 'Target Channel',
        },
      },
      {
        type: 'input',
        block_id: 'time_block',
        element: {
          type: 'plain_text_input',
          action_id: 'time_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., 09:30',
          },
          initial_value:
            currentConfig?.hour !== undefined && currentConfig?.minute !== undefined
              ? `${String(currentConfig.hour).padStart(2, '0')}:${String(currentConfig.minute).padStart(2, '0')}`
              : '09:30',
        },
        label: {
          type: 'plain_text',
          text: 'Stand-up Time (HH:MM)',
        },
      },
      {
        type: 'input',
        block_id: 'timezone_block',
        element: {
          type: 'plain_text_input',
          action_id: 'timezone_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., Asia/Kolkata',
          },
          initial_value: currentConfig?.timezone || 'Asia/Kolkata',
        },
        label: {
          type: 'plain_text',
          text: 'Timezone',
        },
      },
      {
        type: 'input',
        block_id: 'summary_block',
        element: {
          type: 'checkboxes',
          action_id: 'summary_checkbox',
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'Enable AI summary',
              },
              value: 'enabled',
            },
          ],
          ...(currentConfig?.summaryEnabled && {
            initial_options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Enable AI summary',
                },
                value: 'enabled',
              },
            ],
          }),
        },
        label: {
          type: 'plain_text',
          text: 'Summary Settings',
        },
        optional: true,
      },
    ],
  };
}

export function buildStandupCollectionModal(): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
} {
  return {
    type: 'modal',
    callback_id: 'standup_collection_modal',
    title: {
      type: 'plain_text',
      text: 'Daily Stand-up',
    },
    submit: {
      type: 'plain_text',
      text: 'Submit',
    },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Share your daily update:',
        },
      },
      {
        type: 'input',
        block_id: 'yesterday_block',
        element: {
          type: 'plain_text_input',
          action_id: 'yesterday_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'What did you achieve yesterday?',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Yesterday',
        },
      },
      {
        type: 'input',
        block_id: 'today_block',
        element: {
          type: 'plain_text_input',
          action_id: 'today_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'What do you plan to achieve today?',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Today',
        },
      },
      {
        type: 'input',
        block_id: 'blockers_block',
        element: {
          type: 'plain_text_input',
          action_id: 'blockers_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Any Blockers or Risks?',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Blockers or Risks (Optional)',
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'notes_block',
        element: {
          type: 'plain_text_input',
          action_id: 'notes_input',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: 'Additional Notes',
          },
        },
        label: {
          type: 'plain_text',
          text: 'Additional Notes (Optional)',
        },
        optional: true,
      },
    ],
  };
}
