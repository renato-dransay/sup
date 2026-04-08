import { Prisma } from '@prisma/client';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';

export function registerApiRoutes(fastify: FastifyInstance, apiKey: string): void {
  const authenticate = (
    request: FastifyRequest,
    reply: FastifyReply,
    done: (err?: Error) => void
  ) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      void reply.code(401).send({ error: 'Missing or invalid authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    if (token !== apiKey) {
      void reply.code(401).send({ error: 'Invalid API key' });
      return;
    }

    done();
  };

  fastify.get(
    '/api/responses',
    { preHandler: authenticate },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        teamId?: string;
        date?: string;
        from?: string;
        to?: string;
        userId?: string;
      };

      try {
        // Build Prisma where clause
        const standupWhere: Prisma.StandupWhereInput = {};
        const entryWhere: Prisma.EntryWhereInput = {};

        if (query.teamId) {
          standupWhere.workspace = { teamId: query.teamId };
        }

        if (query.date) {
          standupWhere.date = query.date;
        } else if (query.from || query.to) {
          standupWhere.date = {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          };
        }

        if (query.userId) {
          entryWhere.userId = query.userId;
        }

        const entries = await prisma.entry.findMany({
          where: {
            ...entryWhere,
            standup: standupWhere,
          },
          include: {
            standup: {
              include: {
                workspace: true,
              },
            },
          },
          orderBy: {
            submittedAt: 'desc',
          },
        });

        const data = entries.map((entry) => ({
          id: entry.id,
          standupId: entry.standupId,
          date: entry.standup.date,
          teamId: entry.standup.workspace.teamId,
          userId: entry.userId,
          yesterday: entry.yesterday,
          today: entry.today,
          blockers: entry.blockers,
          notes: entry.notes,
          submissionStatus: entry.submissionStatus,
          submittedAt: entry.submittedAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
        }));

        await reply.send({ data, count: data.length });
      } catch (error) {
        logger.error({ error, query }, 'Failed to fetch responses');
        await reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );

  fastify.get(
    '/api/workspaces',
    { preHandler: authenticate },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const workspaces = await prisma.workspace.findMany({
          include: {
            _count: {
              select: { members: true, standups: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        });

        const data = workspaces.map((ws) => ({
          id: ws.id,
          teamId: ws.teamId,
          defaultChannelId: ws.defaultChannelId,
          timezone: ws.timezone,
          cron: ws.cron,
          summaryEnabled: ws.summaryEnabled,
          memberCount: ws._count.members,
          standupCount: ws._count.standups,
          createdAt: ws.createdAt.toISOString(),
          updatedAt: ws.updatedAt.toISOString(),
        }));

        await reply.send({ data, count: data.length });
      } catch (error) {
        logger.error({ error }, 'Failed to fetch workspaces');
        await reply.code(500).send({ error: 'Internal server error' });
      }
    }
  );
}
