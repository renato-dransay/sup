import cron from 'node-cron';
import { WebClient } from '@slack/web-api';
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { acquireLock, releaseLock } from '../utils/locks.js';
import { createStandup, collectFromUsers, sendRemindersForOffset } from './collector.js';
import { compileStandup } from './compiler.js';
import { SummarizerProvider } from './summarizer/provider.js';

interface ScheduledJob {
  task: cron.ScheduledTask;
  compileTask: cron.ScheduledTask;
}

const jobs = new Map<string, ScheduledJob>();
const reminderTimers = new Map<string, NodeJS.Timeout[]>();
const INSTANCE_ID = `scheduler-${Date.now()}-${Math.random().toString(36).substring(7)}`;

function trackReminderTimer(standupId: string, timer: NodeJS.Timeout): void {
  const existing = reminderTimers.get(standupId) || [];
  existing.push(timer);
  reminderTimers.set(standupId, existing);
}

export function scheduleStandupReminders(
  client: WebClient,
  standupId: string,
  deadlineAt: Date | null,
  offsets: number[]
): void {
  if (!deadlineAt) {
    logger.warn({ standupId }, 'Skipping reminder scheduling because deadline is missing');
    return;
  }

  for (const offset of offsets) {
    const scheduledAt = new Date(deadlineAt.getTime() - offset * 60 * 1000);
    const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());

    const timer = setTimeout(() => {
      void sendRemindersForOffset(client, standupId, offset);
    }, delayMs);

    trackReminderTimer(standupId, timer);
    logger.info({ standupId, offsetMinutes: offset, scheduledAt }, 'Reminder scheduled');
  }
}

function clearReminderTimersForStandup(standupId: string): void {
  const timers = reminderTimers.get(standupId);
  if (!timers) return;

  for (const timer of timers) {
    clearTimeout(timer);
  }

  reminderTimers.delete(standupId);
}

export async function scheduleWorkspaceJobs(
  client: WebClient,
  summarizer: SummarizerProvider | null
): Promise<void> {
  try {
    const workspaces = await prisma.workspace.findMany();

    for (const workspace of workspaces) {
      await scheduleWorkspaceJob(workspace.id, client, summarizer);
    }

    logger.info({ count: workspaces.length }, 'Scheduled jobs for workspaces');
  } catch (error) {
    logger.error({ error }, 'Failed to schedule workspace jobs');
    throw error;
  }
}

export async function scheduleWorkspaceJob(
  workspaceId: string,
  client: WebClient,
  summarizer: SummarizerProvider | null
): Promise<void> {
  try {
    // Cancel existing job if any
    cancelWorkspaceJob(workspaceId);

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      logger.error({ workspaceId }, 'Workspace not found');
      return;
    }

    const collectionWindowMin = workspace.collectionWindowMin;
    const lockKey = `standup-job-${workspaceId}`;

    // Enforce weekdays-only (Mon–Fri), regardless of what's stored in the DB
    const cronParts = workspace.cron.split(' ');
    const weekdayCron = `${cronParts[0]} ${cronParts[1]} * * 1-5`;

    // Schedule collection job
    const collectionTask = cron.schedule(
      weekdayCron,
      () => {
        void (async () => {
          const acquired = await acquireLock(lockKey, INSTANCE_ID);
          if (!acquired) {
            logger.debug({ workspaceId }, 'Another instance is handling this job');
            return;
          }

          try {
            logger.info({ workspaceId, cron: weekdayCron }, 'Starting scheduled stand-up');

            const standupId = await createStandup(
              workspaceId,
              workspace.defaultChannelId,
              workspace.timezone,
              collectionWindowMin
            );

            const uniqueOffsets = await collectFromUsers(client, workspaceId, standupId);
            const standup = await prisma.standup.findUnique({
              where: { id: standupId },
              select: { deadlineAt: true },
            });
            scheduleStandupReminders(client, standupId, standup?.deadlineAt ?? null, uniqueOffsets);

            logger.info({ workspaceId, standupId }, 'Collection started');
          } catch (error) {
            logger.error({ error, workspaceId }, 'Failed to execute scheduled job');
          } finally {
            await releaseLock(lockKey, INSTANCE_ID);
          }
        })();
      },
      {
        timezone: workspace.timezone,
      }
    );

    // Calculate compilation cron (collection time + window)
    const collectionMinute = parseInt(cronParts[0], 10);
    const collectionHour = parseInt(cronParts[1], 10);

    let compileMinute = collectionMinute + collectionWindowMin;
    let compileHour = collectionHour;

    if (compileMinute >= 60) {
      compileHour += Math.floor(compileMinute / 60);
      compileMinute = compileMinute % 60;
    }

    if (compileHour >= 24) {
      compileHour = compileHour % 24;
    }

    const compileCron = `${compileMinute} ${compileHour} * * 1-5`;

    // Schedule compilation job
    const compileTask = cron.schedule(
      compileCron,
      () => {
        void (async () => {
          const acquired = await acquireLock(`${lockKey}-compile`, INSTANCE_ID);
          if (!acquired) {
            logger.debug({ workspaceId }, 'Another instance is handling compilation');
            return;
          }

          try {
            logger.info({ workspaceId }, 'Starting scheduled compilation');

            // Find today's standup
            const standup = await prisma.standup.findFirst({
              where: {
                workspaceId,
                compiledAt: null,
              },
              orderBy: {
                startedAt: 'desc',
              },
            });

            if (standup) {
              await compileStandup(client, standup.id, summarizer);
              logger.info({ workspaceId, standupId: standup.id }, 'Compilation completed');
            } else {
              logger.warn({ workspaceId }, 'No standup found to compile');
            }
          } catch (error) {
            logger.error({ error, workspaceId }, 'Failed to execute compilation job');
          } finally {
            await releaseLock(`${lockKey}-compile`, INSTANCE_ID);
          }
        })();
      },
      {
        timezone: workspace.timezone,
      }
    );

    jobs.set(workspaceId, { task: collectionTask, compileTask });

    logger.info(
      { workspaceId, collectionCron: weekdayCron, compileCron, timezone: workspace.timezone },
      'Workspace job scheduled'
    );
  } catch (error) {
    logger.error({ error, workspaceId }, 'Failed to schedule workspace job');
    throw error;
  }
}

export function cancelWorkspaceJob(workspaceId: string): void {
  const job = jobs.get(workspaceId);
  if (job) {
    job.task.stop();
    job.compileTask.stop();
    jobs.delete(workspaceId);
    logger.info({ workspaceId }, 'Workspace job cancelled');
  }
}

export function getScheduledJobsCount(): number {
  return jobs.size;
}

export function stopAllJobs(): void {
  for (const [workspaceId, job] of jobs.entries()) {
    job.task.stop();
    job.compileTask.stop();
    logger.info({ workspaceId }, 'Job stopped');
  }
  for (const standupId of reminderTimers.keys()) {
    clearReminderTimersForStandup(standupId);
  }
  jobs.clear();
  logger.info('All jobs stopped');
}
