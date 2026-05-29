import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/prismaClient.js', () => ({
  prisma: {
    standup: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/db/prismaClient.js';
import { findStandupToCompile } from '../../src/services/collector.js';

const mockFindUnique = vi.mocked(prisma.standup.findUnique);
const mockFindFirst = vi.mocked(prisma.standup.findFirst);

describe('findStandupToCompile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns today's standup when it is not yet compiled", async () => {
    mockFindUnique.mockResolvedValue({ id: 'today', compiledAt: null } as never);

    const result = await findStandupToCompile('ws-1', 'Europe/Berlin');

    expect(result).toEqual({ id: 'today' });
  });

  it("returns null when today's standup is already compiled", async () => {
    mockFindUnique.mockResolvedValue({
      id: 'today',
      compiledAt: new Date('2026-05-29T08:10:00Z'),
    } as never);

    const result = await findStandupToCompile('ws-1', 'Europe/Berlin');

    expect(result).toBeNull();
  });

  it('returns null when there is no standup for today (never falls back to older dates)', async () => {
    mockFindUnique.mockResolvedValue(null as never);

    const result = await findStandupToCompile('ws-1', 'Europe/Berlin');

    expect(result).toBeNull();
    // Must not reach for "newest uncompiled regardless of date" — that posted a stale daily.
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it('selects by the unique workspace+date key', async () => {
    mockFindUnique.mockResolvedValue({ id: 'today', compiledAt: null } as never);

    await findStandupToCompile('ws-1', 'Europe/Berlin');

    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId_date: expect.objectContaining({ workspaceId: 'ws-1' }),
        }),
      })
    );
  });
});
