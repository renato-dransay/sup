import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/db/prismaClient.js', () => ({
  prisma: {
    member: {
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/db/prismaClient.js';
import { filterActiveUsers } from '../../src/services/users.js';

const mockUpdateMany = vi.mocked(prisma.member.updateMany);

function clientReturning(deletedById: Record<string, boolean>) {
  return {
    users: {
      info: vi.fn(async ({ user }: { user: string }) => ({
        ok: true,
        user: { id: user, deleted: deletedById[user] ?? false },
      })),
    },
  } as never;
}

describe('filterActiveUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops deactivated users and prunes them to optedIn=false', async () => {
    const client = clientReturning({ Udead: true });

    const result = await filterActiveUsers(client, 'ws-1', ['Ualive', 'Udead']);

    expect(result).toEqual(['Ualive']);
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', userId: { in: ['Udead'] } },
      data: { optedIn: false },
    });
  });

  it('does not touch the DB when everyone is active', async () => {
    const client = clientReturning({});

    const result = await filterActiveUsers(client, 'ws-1', ['U1', 'U2']);

    expect(result).toEqual(['U1', 'U2']);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('keeps a user when their Slack status cannot be determined (fail-safe)', async () => {
    const client = {
      users: {
        info: vi.fn(async () => {
          throw new Error('rate_limited');
        }),
      },
    } as never;

    const result = await filterActiveUsers(client, 'ws-1', ['U1']);

    expect(result).toEqual(['U1']);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
