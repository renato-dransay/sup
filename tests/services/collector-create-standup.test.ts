import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/prismaClient.js', () => ({
  prisma: {
    standup: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/db/prismaClient.js';
import { createStandup } from '../../src/services/collector.js';

const mockFindUnique = vi.mocked(prisma.standup.findUnique);
const mockCreate = vi.mocked(prisma.standup.create);

describe('createStandup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new standup and reports it as newly created', async () => {
    mockFindUnique.mockResolvedValue(null as never);
    mockCreate.mockResolvedValue({ id: 'standup-new' } as never);

    const result = await createStandup('ws-1', 'C1', 'Europe/Berlin', 75);

    expect(result).toEqual({ id: 'standup-new', alreadyExisted: false });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('returns the existing standup without recreating it', async () => {
    mockFindUnique.mockResolvedValue({ id: 'standup-existing' } as never);

    const result = await createStandup('ws-1', 'C1', 'Europe/Berlin', 75);

    expect(result).toEqual({ id: 'standup-existing', alreadyExisted: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
