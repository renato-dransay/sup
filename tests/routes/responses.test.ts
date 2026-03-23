import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { registerApiRoutes } from '../../src/routes/responses.js';

const TEST_API_KEY = 'test-api-key-123';

// Mock Prisma
vi.mock('../../src/db/prismaClient.js', () => ({
  prisma: {
    entry: {
      findMany: vi.fn(),
    },
    workspace: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from '../../src/db/prismaClient.js';
const mockEntryFindMany = vi.mocked(prisma.entry.findMany);
const mockWorkspaceFindMany = vi.mocked(prisma.workspace.findMany);

function buildApp() {
  const app = Fastify();
  registerApiRoutes(app, TEST_API_KEY);
  return app;
}

describe('GET /api/responses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when no authorization header is provided', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/responses' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Missing or invalid authorization header' });
  });

  it('returns 401 when authorization header is not Bearer', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/responses',
      headers: { authorization: 'Basic abc' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('returns 401 when API key is wrong', async () => {
    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/responses',
      headers: { authorization: 'Bearer wrong-key' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: 'Invalid API key' });
  });

  it('returns all entries when no filters are provided', async () => {
    mockEntryFindMany.mockResolvedValue([]);

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/responses',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [], count: 0 });
    expect(mockEntryFindMany).toHaveBeenCalledWith({
      where: { standup: {} },
      include: { standup: { include: { workspace: true } } },
      orderBy: { submittedAt: 'desc' },
    });
  });

  it('returns entries filtered by teamId', async () => {
    const now = new Date('2026-03-23T10:00:00Z');
    mockEntryFindMany.mockResolvedValue([
      {
        id: 'entry-1',
        standupId: 'standup-1',
        userId: 'U123',
        yesterday: 'Did stuff',
        today: 'Will do stuff',
        blockers: null,
        notes: null,
        submissionStatus: 'on_time',
        submittedAt: now,
        updatedAt: now,
        standup: {
          id: 'standup-1',
          workspaceId: 'ws-1',
          date: '2026-03-23',
          startedAt: now,
          deadlineAt: null,
          compiledAt: null,
          channelId: 'C123',
          messageTs: null,
          workspace: {
            id: 'ws-1',
            teamId: 'T123',
            defaultChannelId: 'C123',
            timezone: 'UTC',
            cron: '30 9 * * *',
            summaryEnabled: false,
            createdAt: now,
            updatedAt: now,
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/responses?teamId=T123',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(1);
    expect(body.data[0]).toEqual({
      id: 'entry-1',
      standupId: 'standup-1',
      date: '2026-03-23',
      teamId: 'T123',
      userId: 'U123',
      yesterday: 'Did stuff',
      today: 'Will do stuff',
      blockers: null,
      notes: null,
      submissionStatus: 'on_time',
      submittedAt: '2026-03-23T10:00:00.000Z',
      updatedAt: '2026-03-23T10:00:00.000Z',
    });

    expect(mockEntryFindMany).toHaveBeenCalledWith({
      where: {
        standup: { workspace: { teamId: 'T123' } },
      },
      include: {
        standup: { include: { workspace: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  });

  it('passes date filter to Prisma', async () => {
    mockEntryFindMany.mockResolvedValue([]);

    const app = buildApp();
    await app.inject({
      method: 'GET',
      url: '/api/responses?teamId=T123&date=2026-03-23',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(mockEntryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          standup: { workspace: { teamId: 'T123' }, date: '2026-03-23' },
        },
      })
    );
  });

  it('passes date range filters to Prisma', async () => {
    mockEntryFindMany.mockResolvedValue([]);

    const app = buildApp();
    await app.inject({
      method: 'GET',
      url: '/api/responses?teamId=T123&from=2026-03-01&to=2026-03-23',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(mockEntryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          standup: {
            workspace: { teamId: 'T123' },
            date: { gte: '2026-03-01', lte: '2026-03-23' },
          },
        },
      })
    );
  });

  it('passes userId filter to Prisma', async () => {
    mockEntryFindMany.mockResolvedValue([]);

    const app = buildApp();
    await app.inject({
      method: 'GET',
      url: '/api/responses?userId=U456',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(mockEntryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'U456',
          standup: {},
        },
      })
    );
  });

  it('combines teamId and userId filters', async () => {
    mockEntryFindMany.mockResolvedValue([]);

    const app = buildApp();
    await app.inject({
      method: 'GET',
      url: '/api/responses?teamId=T123&userId=U456&date=2026-03-23',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(mockEntryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'U456',
          standup: { workspace: { teamId: 'T123' }, date: '2026-03-23' },
        },
      })
    );
  });
});

describe('GET /api/workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without auth', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(response.statusCode).toBe(401);
  });

  it('returns all workspaces with counts', async () => {
    const now = new Date('2026-03-23T10:00:00Z');
    mockWorkspaceFindMany.mockResolvedValue([
      {
        id: 'ws-1',
        teamId: 'T123',
        defaultChannelId: 'C123',
        timezone: 'UTC',
        cron: '30 9 * * *',
        summaryEnabled: true,
        createdAt: now,
        updatedAt: now,
        _count: { members: 5, standups: 20 },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    const app = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.count).toBe(1);
    expect(body.data[0]).toEqual({
      id: 'ws-1',
      teamId: 'T123',
      defaultChannelId: 'C123',
      timezone: 'UTC',
      cron: '30 9 * * *',
      summaryEnabled: true,
      memberCount: 5,
      standupCount: 20,
      createdAt: '2026-03-23T10:00:00.000Z',
      updatedAt: '2026-03-23T10:00:00.000Z',
    });
  });
});
