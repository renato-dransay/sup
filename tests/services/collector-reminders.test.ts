import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/prismaClient.js', () => ({
  prisma: {
    reminderDispatch: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    standup: {
      findUnique: vi.fn(),
    },
    entry: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/services/excuses.js', () => ({
  getExcusedMemberIds: vi.fn(),
}));

vi.mock('../../src/services/slack.js', () => ({
  openDMChannel: vi.fn().mockResolvedValue('dm-channel'),
}));

import { prisma } from '../../src/db/prismaClient.js';
import { getExcusedMemberIds } from '../../src/services/excuses.js';
import { sendRemindersForOffset } from '../../src/services/collector.js';

const mockReminderFindMany = vi.mocked(prisma.reminderDispatch.findMany);
const mockReminderUpdate = vi.mocked(prisma.reminderDispatch.update);
const mockStandupFindUnique = vi.mocked(prisma.standup.findUnique);
const mockEntryFindUnique = vi.mocked(prisma.entry.findUnique);
const mockGetExcusedMemberIds = vi.mocked(getExcusedMemberIds);

describe('sendRemindersForOffset', () => {
  const mockClient = {
    chat: { postMessage: vi.fn().mockResolvedValue(undefined) },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips reminders for excused users', async () => {
    mockReminderFindMany.mockResolvedValue([
      { id: 'rd-1', userId: 'U123', standupId: 'standup-1', offsetMinutes: 15 },
    ] as never);
    mockStandupFindUnique.mockResolvedValue({
      id: 'standup-1',
      date: '2026-04-09',
      deadlineAt: new Date('2026-04-09T10:15:00Z'),
      workspaceId: 'ws-1',
      workspace: { timezone: 'Europe/Berlin' },
    } as never);
    mockGetExcusedMemberIds.mockResolvedValue(['U123']);

    await sendRemindersForOffset(mockClient, 'standup-1', 15);

    expect(mockReminderUpdate).toHaveBeenCalledWith({
      where: { id: 'rd-1' },
      data: { status: 'skipped', failureReason: 'user is excused' },
    });
    expect(mockEntryFindUnique).not.toHaveBeenCalled();
  });

  it('sends reminders to non-excused users without entries', async () => {
    mockReminderFindMany.mockResolvedValue([
      { id: 'rd-1', userId: 'U123', standupId: 'standup-1', offsetMinutes: 15 },
    ] as never);
    mockStandupFindUnique.mockResolvedValue({
      id: 'standup-1',
      date: '2026-04-09',
      deadlineAt: new Date('2026-04-09T10:15:00Z'),
      workspaceId: 'ws-1',
      workspace: { timezone: 'Europe/Berlin' },
    } as never);
    mockGetExcusedMemberIds.mockResolvedValue([]);
    mockEntryFindUnique.mockResolvedValue(null);
    mockReminderUpdate.mockResolvedValue({} as never);

    await sendRemindersForOffset(mockClient, 'standup-1', 15);

    expect(mockReminderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'sent' }),
      })
    );
  });
});
