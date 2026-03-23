import { Block, KnownBlock } from '@slack/web-api';

interface RichTextElement {
  type: string;
  text?: string;
  user_id?: string;
  channel_id?: string;
  url?: string;
  name?: string;
  style?: {
    bold?: boolean;
    italic?: boolean;
    strike?: boolean;
    code?: boolean;
  };
  elements?: RichTextElement[];
}

interface RichTextBlock {
  type: 'rich_text';
  elements: RichTextElement[];
}

export function richTextToMrkdwn(richText: RichTextBlock): string {
  return richText.elements.map(renderSection).join('\n');
}

function renderSection(section: RichTextElement): string {
  if (section.type === 'rich_text_list') {
    const style = section.style as unknown as string;
    return (section.elements ?? [])
      .map((item, i) => {
        const prefix = style === 'ordered' ? `${i + 1}. ` : '• ';
        return prefix + renderSection(item);
      })
      .join('\n');
  }

  if (section.type === 'rich_text_preformatted') {
    const inner = (section.elements ?? []).map(renderElement).join('');
    return '```\n' + inner + '\n```';
  }

  if (section.type === 'rich_text_quote') {
    const inner = (section.elements ?? []).map(renderElement).join('');
    return inner
      .split('\n')
      .map((line) => '> ' + line)
      .join('\n');
  }

  // rich_text_section and fallback
  return (section.elements ?? []).map(renderElement).join('');
}

function renderElement(el: RichTextElement): string {
  if (el.type === 'user') {
    return `<@${el.user_id}>`;
  }
  if (el.type === 'channel') {
    return `<#${el.channel_id}>`;
  }
  if (el.type === 'link') {
    return el.text && el.text !== el.url ? `<${el.url}|${el.text}>` : `<${el.url}>`;
  }
  if (el.type === 'emoji') {
    return `:${el.name}:`;
  }
  if (el.type === 'text') {
    let text = el.text ?? '';
    if (el.style?.code) text = '`' + text + '`';
    if (el.style?.bold) text = '*' + text + '*';
    if (el.style?.italic) text = '_' + text + '_';
    if (el.style?.strike) text = '~' + text + '~';
    return text;
  }
  return el.text ?? '';
}

export interface StandupEntry {
  userId: string;
  userName: string;
  yesterday: string;
  today: string;
  blockers?: string;
  notes?: string;
}

export function buildStandupHeaderBlocks(
  date: string,
  timezone: string,
  deadlineText?: string | null
): KnownBlock[] {
  const metadataParts = [`*Timezone:* ${timezone}`];

  if (deadlineText) {
    metadataParts.push(`*Deadline:* ${deadlineText}`);
  }

  metadataParts.push(
    `*Generated:* <!date^${Math.floor(Date.now() / 1000)}^{date_pretty} at {time}|${new Date().toISOString()}>`
  );

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
          text: metadataParts.join(' | '),
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
  missedUsers: Array<{ userId: string; userName: string }>,
  deadlineText?: string | null
): (Block | KnownBlock)[] {
  const blocks: (Block | KnownBlock)[] = [
    ...buildStandupHeaderBlocks(date, timezone, deadlineText),
  ];

  entries.forEach((entry) => {
    blocks.push(...buildEntryBlock(entry));
  });

  if (missedUsers.length > 0) {
    blocks.push(...buildMissedSection(missedUsers));
  }

  return blocks;
}

export function buildLateSubmissionsSection(lateEntries: StandupEntry[]): (Block | KnownBlock)[] {
  if (lateEntries.length === 0) return [];

  const blocks: (Block | KnownBlock)[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🕐 Late Submissions*',
      },
    },
    {
      type: 'divider',
    },
  ];

  lateEntries.forEach((entry) => {
    blocks.push(...buildEntryBlock(entry));
  });

  return blocks;
}

export function buildCompleteStandupBlocksGrouped(
  date: string,
  timezone: string,
  onTimeEntries: StandupEntry[],
  lateEntries: StandupEntry[],
  missedUsers: Array<{ userId: string; userName: string }>,
  deadlineText?: string | null
): (Block | KnownBlock)[] {
  const blocks: (Block | KnownBlock)[] = [
    ...buildStandupHeaderBlocks(date, timezone, deadlineText),
  ];

  onTimeEntries.forEach((entry) => {
    blocks.push(...buildEntryBlock(entry));
  });

  blocks.push(...buildLateSubmissionsSection(lateEntries));

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
          type: 'rich_text_input',
          action_id: 'yesterday_input',
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
          type: 'rich_text_input',
          action_id: 'today_input',
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
          type: 'rich_text_input',
          action_id: 'blockers_input',
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
          type: 'rich_text_input',
          action_id: 'notes_input',
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
