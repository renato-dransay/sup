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

export interface StandupCollectionDraftValues {
  yesterday?: string | null;
  today?: string | null;
  blockers?: string | null;
  notes?: string | null;
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

export function buildExcusedSection(
  excusedUsers: Array<{ userId: string; userName: string; reason?: string | null }>
): KnownBlock[] {
  if (excusedUsers.length === 0) return [];

  const lines = excusedUsers
    .map((u) => (u.reason ? `• ${u.userName} (${u.reason})` : `• ${u.userName}`))
    .join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🏖 Excused*\n${lines}`,
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
  collectionWindowMin?: number;
  remindersEnabled?: boolean;
  reminderOffsets?: string;
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
        block_id: 'window_block',
        element: {
          type: 'plain_text_input',
          action_id: 'window_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., 45',
          },
          initial_value: String(currentConfig?.collectionWindowMin ?? 45),
        },
        label: {
          type: 'plain_text',
          text: 'Response Window (minutes, 10-120)',
        },
      },
      {
        type: 'input',
        block_id: 'reminder_offsets_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reminder_offsets_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., 15,5',
          },
          initial_value: currentConfig?.reminderOffsets ?? '15,5',
        },
        label: {
          type: 'plain_text',
          text: 'Reminder Times (minutes before deadline, comma-separated)',
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
      {
        type: 'input',
        block_id: 'reminders_block',
        element: {
          type: 'checkboxes',
          action_id: 'reminders_checkbox',
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'Enable reminders',
              },
              value: 'enabled',
            },
          ],
          ...(currentConfig?.remindersEnabled !== false && {
            initial_options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Enable reminders',
                },
                value: 'enabled',
              },
            ],
          }),
        },
        label: {
          type: 'plain_text',
          text: 'Reminder Settings',
        },
        optional: true,
      },
    ],
  };
}

function textToRichText(text?: string | null): RichTextBlock | undefined {
  if (!text?.trim()) return undefined;

  return {
    type: 'rich_text',
    elements: text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => ({
        type: 'rich_text_section' as const,
        elements: [
          {
            type: 'text' as const,
            text: line,
          },
        ],
      })),
  };
}

export function buildStandupCollectionModal(options?: {
  closeText?: string;
  notifyOnClose?: boolean;
  initialValues?: StandupCollectionDraftValues;
}): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
  close?: { type: string; text: string };
  notify_on_close?: boolean;
} {
  const initialValues = options?.initialValues;

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
    ...(options?.closeText
      ? {
          close: {
            type: 'plain_text',
            text: options.closeText,
          },
        }
      : {}),
    ...(options?.notifyOnClose ? { notify_on_close: true } : {}),
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
          ...(textToRichText(initialValues?.yesterday)
            ? { initial_value: textToRichText(initialValues?.yesterday) as never }
            : {}),
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
          ...(textToRichText(initialValues?.today)
            ? { initial_value: textToRichText(initialValues?.today) as never }
            : {}),
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
          ...(textToRichText(initialValues?.blockers)
            ? { initial_value: textToRichText(initialValues?.blockers) as never }
            : {}),
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
          ...(textToRichText(initialValues?.notes)
            ? { initial_value: textToRichText(initialValues?.notes) as never }
            : {}),
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

export function buildMeHubBlocks(config: {
  remindersLabel: string;
  offsetsLabel: string;
  excusesLabel: string;
}): (Block | KnownBlock)[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*👤 Your Stand-up Preferences*\n\n` +
          `*Reminders:* ${config.remindersLabel} | *Offsets:* ${config.offsetsLabel}\n` +
          `*Excuses:* ${config.excusesLabel}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔔 Reminders' },
          action_id: 'open_reminders_modal',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🏖 Excuse' },
          action_id: 'open_excuse_modal',
        },
      ],
    },
  ];
}

export function buildRemindersModal(current?: {
  remindersEnabled: boolean | null;
  reminderOffsets: string | null;
  workspaceDefault: string;
}): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
} {
  const currentValue =
    current?.remindersEnabled === null || current?.remindersEnabled === undefined
      ? 'default'
      : current?.remindersEnabled
        ? 'on'
        : 'off';

  return {
    type: 'modal',
    callback_id: 'standup_me_reminders_modal',
    title: { type: 'plain_text', text: 'Reminder Preferences' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [
      {
        type: 'input',
        block_id: 'reminders_enabled_block',
        element: {
          type: 'static_select',
          action_id: 'reminders_enabled_select',
          options: [
            { text: { type: 'plain_text', text: 'Use workspace default' }, value: 'default' },
            { text: { type: 'plain_text', text: 'On' }, value: 'on' },
            { text: { type: 'plain_text', text: 'Off' }, value: 'off' },
          ],
          initial_option: {
            text: {
              type: 'plain_text',
              text:
                currentValue === 'default'
                  ? 'Use workspace default'
                  : currentValue === 'on'
                    ? 'On'
                    : 'Off',
            },
            value: currentValue,
          },
        },
        label: { type: 'plain_text', text: 'Reminders' },
      },
      {
        type: 'input',
        block_id: 'reminder_offsets_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reminder_offsets_input',
          placeholder: {
            type: 'plain_text',
            text: `Workspace default: ${current?.workspaceDefault ?? '15,5'}`,
          },
          ...(current?.reminderOffsets && { initial_value: current.reminderOffsets }),
        },
        label: {
          type: 'plain_text',
          text: 'Reminder Times (minutes before deadline, leave empty for workspace default)',
        },
        optional: true,
      },
    ],
  };
}

export function buildExcuseModal(): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
} {
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());

  return {
    type: 'modal',
    callback_id: 'standup_me_excuse_modal',
    title: { type: 'plain_text', text: 'Set Absence' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [
      {
        type: 'input',
        block_id: 'start_date_block',
        element: {
          type: 'datepicker',
          action_id: 'start_date_picker',
          initial_date: today,
          placeholder: { type: 'plain_text', text: 'Start date' },
        },
        label: { type: 'plain_text', text: 'Start Date' },
      },
      {
        type: 'input',
        block_id: 'end_date_block',
        element: {
          type: 'datepicker',
          action_id: 'end_date_picker',
          initial_date: today,
          placeholder: { type: 'plain_text', text: 'End date' },
        },
        label: { type: 'plain_text', text: 'End Date' },
      },
      {
        type: 'input',
        block_id: 'reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reason_input',
          placeholder: { type: 'plain_text', text: 'e.g., Vacation, Sick leave' },
        },
        label: { type: 'plain_text', text: 'Reason (optional)' },
        optional: true,
      },
    ],
  };
}

export function buildWeeklySummaryBlocks(
  dateRange: string,
  entries: Array<{
    date: string;
    dayName: string;
    yesterday: string;
    today: string;
    blockers?: string;
  }>,
  aiSummary?: string
): (Block | KnownBlock)[] {
  const blocks: (Block | KnownBlock)[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📅 Your Week (${dateRange})`, emoji: true },
    },
  ];

  if (aiSummary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: aiSummary },
    });
    blocks.push({ type: 'divider' });
  }

  for (const entry of entries) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${entry.dayName} (${entry.date}):*\n` +
          `*Yesterday:* ${entry.yesterday}\n` +
          `*Today:* ${entry.today}` +
          (entry.blockers ? `\n*Blockers:* ${entry.blockers}` : ''),
      },
    });
  }

  if (entries.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'No standup entries found for this week.' },
    });
  }

  return blocks;
}
