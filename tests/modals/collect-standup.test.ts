import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/prismaClient.js', () => ({
  prisma: {
    standup: {
      findUnique: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
    },
    reminderDispatch: {
      updateMany: vi.fn(),
    },
    entry: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/slack.js', () => ({
  openModal: vi.fn(),
}));

vi.mock('../../src/services/form-drafts.js', () => ({
  getStandupFormDraftByUserId: vi.fn(),
  saveStandupFormDraftByUserId: vi.fn(),
  deleteStandupFormDraftByUserId: vi.fn(),
}));

vi.mock('../../src/services/collector.js', () => ({
  saveEntry: vi.fn(),
  SUBMISSION_STATUS: {
    ON_TIME: 'on_time',
    LATE: 'late',
  },
}));

vi.mock('../../src/services/excuses.js', () => ({
  createExcuse: vi.fn(),
}));

vi.mock('../../src/utils/date.js', () => ({
  formatDateTime: vi.fn().mockReturnValue('10:15 AM'),
  getTodayDate: vi.fn().mockReturnValue('2026-04-09'),
}));

import { prisma } from '../../src/db/prismaClient.js';
import { openModal } from '../../src/services/slack.js';
import {
  deleteStandupFormDraftByUserId,
  getStandupFormDraftByUserId,
  saveStandupFormDraftByUserId,
} from '../../src/services/form-drafts.js';
import { saveEntry } from '../../src/services/collector.js';
import { createExcuse } from '../../src/services/excuses.js';
import {
  handleOpenStandupModal,
  handleSaveDraft,
  handleShowLastEntry,
  handleSkipStandup,
  handleStandupClose,
  handleStandupSubmission,
} from '../../src/modals/collect-standup.js';

const mockStandupFindUnique = vi.mocked(prisma.standup.findUnique);
const mockMemberFindUnique = vi.mocked(prisma.member.findUnique);
const mockReminderDispatchUpdateMany = vi.mocked(prisma.reminderDispatch.updateMany);
const mockEntryFindFirst = vi.mocked(prisma.entry.findFirst);
const mockOpenModal = vi.mocked(openModal);
const mockGetStandupFormDraftByUserId = vi.mocked(getStandupFormDraftByUserId);
const mockSaveStandupFormDraftByUserId = vi.mocked(saveStandupFormDraftByUserId);
const mockDeleteStandupFormDraftByUserId = vi.mocked(deleteStandupFormDraftByUserId);
const mockSaveEntry = vi.mocked(saveEntry);
const mockCreateExcuse = vi.mocked(createExcuse);

function richTextValue(text: string) {
  return {
    type: 'rich_text',
    elements: [
      {
        type: 'rich_text_section',
        elements: [{ type: 'text', text }],
      },
    ],
  };
}

describe('standup collection modal handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the standup modal with draft restore enabled', async () => {
    mockStandupFindUnique.mockResolvedValue({ workspaceId: 'ws-1' } as never);
    mockGetStandupFormDraftByUserId.mockResolvedValue({
      yesterday: 'Investigated alert',
      today: 'Ship the fix',
      blockers: null,
      notes: 'Need review',
    } as never);

    await handleOpenStandupModal({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: 'standup-1' },
      client: {} as never,
      body: { trigger_id: 'trigger-1', user: { id: 'U123' } } as never,
    } as never);

    expect(mockOpenModal).toHaveBeenCalledTimes(1);
    expect(mockOpenModal).toHaveBeenCalledWith(
      expect.anything(),
      'trigger-1',
      expect.objectContaining({
        notify_on_close: true,
        private_metadata: JSON.stringify({ standupId: 'standup-1', workspaceId: 'ws-1' }),
      })
    );

    const modal = mockOpenModal.mock.calls[0]?.[2];
    expect(modal.blocks[1]).toMatchObject({
      element: {
        initial_value: richTextValue('Investigated alert'),
      },
    });
    expect(modal.blocks[2]).toMatchObject({
      element: {
        initial_value: richTextValue('Ship the fix'),
      },
    });
  });

  it('does not attempt to save draft on modal close (view_closed has no form values)', async () => {
    await handleStandupClose({
      ack: vi.fn().mockResolvedValue(undefined),
      body: { user: { id: 'U123' } } as never,
      view: {
        private_metadata: JSON.stringify({ standupId: 'standup-1' }),
      } as never,
    } as never);

    expect(mockSaveStandupFormDraftByUserId).not.toHaveBeenCalled();
    expect(mockDeleteStandupFormDraftByUserId).not.toHaveBeenCalled();
  });

  it('saves a draft when the Save Draft button is clicked', async () => {
    const mockViewsUpdate = vi.fn().mockResolvedValue(undefined);

    await handleSaveDraft({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        user: { id: 'U123' },
        view: {
          id: 'V123',
          private_metadata: JSON.stringify({ standupId: 'standup-1', workspaceId: 'ws-1' }),
          state: {
            values: {
              yesterday_block: {
                yesterday_input: { rich_text_value: richTextValue('Finished API work') },
              },
              today_block: {
                today_input: { rich_text_value: richTextValue('Write tests') },
              },
              blockers_block: {},
              notes_block: {},
            },
          },
        },
      } as never,
      client: { views: { update: mockViewsUpdate } } as never,
      action: {} as never,
    } as never);

    expect(mockSaveStandupFormDraftByUserId).toHaveBeenCalledWith('standup-1', 'ws-1', 'U123', {
      yesterday: 'Finished API work',
      today: 'Write tests',
      blockers: undefined,
      notes: undefined,
    });
    expect(mockViewsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        view_id: 'V123',
      })
    );
  });

  it('clears the draft after successful submission', async () => {
    mockSaveEntry.mockResolvedValue({
      status: 'on_time',
      deadlineAt: new Date('2026-04-08T08:45:00.000Z'),
    } as never);
    mockStandupFindUnique.mockResolvedValue({
      workspace: { timezone: 'Europe/Berlin' },
      workspaceId: 'ws-1',
    } as never);

    await handleStandupSubmission({
      ack: vi.fn().mockResolvedValue(undefined),
      body: { user: { id: 'U123' } } as never,
      client: {
        chat: {
          postMessage: vi.fn().mockResolvedValue(undefined),
        },
      } as never,
      view: {
        private_metadata: JSON.stringify({ standupId: 'standup-1', workspaceId: 'ws-1' }),
        state: {
          values: {
            yesterday_block: {
              yesterday_input: { rich_text_value: richTextValue('Finished API work') },
            },
            today_block: {
              today_input: { rich_text_value: richTextValue('Write tests') },
            },
            blockers_block: {},
            notes_block: {},
          },
        },
      } as never,
    } as never);

    expect(mockDeleteStandupFormDraftByUserId).toHaveBeenCalledWith('standup-1', 'ws-1', 'U123');
  });

  it('creates an excuse and cancels reminders when user skips standup', async () => {
    mockStandupFindUnique.mockResolvedValue({
      id: 'standup-1',
      workspaceId: 'ws-1',
      workspace: { timezone: 'Europe/Berlin' },
    } as never);
    mockMemberFindUnique.mockResolvedValue({ id: 'member-1' } as never);
    mockReminderDispatchUpdateMany.mockResolvedValue({ count: 2 } as never);
    mockCreateExcuse.mockResolvedValue('excuse-1');

    const mockPostMessage = vi.fn().mockResolvedValue(undefined);

    await handleSkipStandup({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: 'standup-1' },
      client: { chat: { postMessage: mockPostMessage } } as never,
      body: { user: { id: 'U123' } } as never,
    } as never);

    expect(mockCreateExcuse).toHaveBeenCalledWith('member-1', '2026-04-09', '2026-04-09', 'Skipped via button');
    expect(mockReminderDispatchUpdateMany).toHaveBeenCalledWith({
      where: { standupId: 'standup-1', userId: 'U123', status: 'pending' },
      data: { status: 'skipped', failureReason: 'user skipped standup' },
    });
    expect(mockPostMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('skipped') })
    );
  });

  it("opens a modal with the user's most recent prior entry", async () => {
    mockStandupFindUnique.mockResolvedValue({ workspaceId: 'ws-1' } as never);
    mockEntryFindFirst.mockResolvedValue({
      yesterday: 'Reviewed PRs',
      today: 'Ship feature',
      blockers: 'None',
      notes: null,
      standup: { date: '2026-04-27' },
    } as never);

    await handleShowLastEntry({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: 'standup-1' },
      client: {} as never,
      body: { user: { id: 'U123' }, trigger_id: 'trig-1' } as never,
    } as never);

    expect(mockEntryFindFirst).toHaveBeenCalledWith({
      where: {
        userId: 'U123',
        standupId: { not: 'standup-1' },
        standup: { workspaceId: 'ws-1' },
      },
      include: { standup: { select: { date: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    expect(mockOpenModal).toHaveBeenCalledTimes(1);
    const modal = mockOpenModal.mock.calls[0]?.[2] as { blocks: unknown[] };
    const serialized = JSON.stringify(modal.blocks);
    expect(serialized).toContain('2026-04-27');
    expect(serialized).toContain('Reviewed PRs');
    expect(serialized).toContain('Ship feature');
  });

  it('opens a modal with empty-state message when there is no prior entry', async () => {
    mockStandupFindUnique.mockResolvedValue({ workspaceId: 'ws-1' } as never);
    mockEntryFindFirst.mockResolvedValue(null);

    await handleShowLastEntry({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: 'standup-1' },
      client: {} as never,
      body: { user: { id: 'U123' }, trigger_id: 'trig-1' } as never,
    } as never);

    expect(mockOpenModal).toHaveBeenCalledTimes(1);
    const modal = mockOpenModal.mock.calls[0]?.[2] as { blocks: unknown[] };
    expect(JSON.stringify(modal.blocks)).toContain("haven't submitted");
  });

  it('still sends confirmation DM even if standup is not found on skip', async () => {
    mockStandupFindUnique.mockResolvedValue(null);

    const mockPostMessage = vi.fn().mockResolvedValue(undefined);

    await handleSkipStandup({
      ack: vi.fn().mockResolvedValue(undefined),
      action: { value: 'standup-1' },
      client: { chat: { postMessage: mockPostMessage } } as never,
      body: { user: { id: 'U123' } } as never,
    } as never);

    expect(mockCreateExcuse).not.toHaveBeenCalled();
    expect(mockReminderDispatchUpdateMany).not.toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalledTimes(1);
  });
});
