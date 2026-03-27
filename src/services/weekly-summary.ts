import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { SummarizerProvider } from './summarizer/provider.js';

export function getWeekDateRange(todayDate: string): { start: string; end: string } {
  const date = new Date(todayDate + 'T12:00:00Z');
  const dayOfWeek = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Calculate Monday of this week
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + mondayOffset);

  // Friday is Monday + 4
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  const format = (d: Date) => d.toISOString().split('T')[0];
  return { start: format(monday), end: format(friday) };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDayName(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00Z');
  return DAY_NAMES[date.getUTCDay()];
}

export async function getUserWeeklyEntries(
  userId: string,
  workspaceId: string,
  todayDate: string
): Promise<Array<{
  date: string;
  dayName: string;
  yesterday: string;
  today: string;
  blockers?: string;
}>> {
  const { start, end } = getWeekDateRange(todayDate);

  const entries = await prisma.entry.findMany({
    where: {
      userId,
      standup: {
        workspaceId,
        date: { gte: start, lte: end },
      },
    },
    include: {
      standup: { select: { date: true } },
    },
    orderBy: {
      standup: { date: 'asc' },
    },
  });

  return entries.map((e) => ({
    date: e.standup.date,
    dayName: getDayName(e.standup.date),
    yesterday: e.yesterday,
    today: e.today,
    blockers: e.blockers || undefined,
  }));
}

export async function generatePersonalWeeklySummary(
  entries: Array<{ date: string; dayName: string; yesterday: string; today: string; blockers?: string }>,
  summarizer: SummarizerProvider
): Promise<string> {
  const formatted = entries
    .map(
      (e) =>
        `${e.dayName} (${e.date}):\n` +
        `Yesterday: ${e.yesterday}\n` +
        `Today: ${e.today}` +
        (e.blockers ? `\nBlockers: ${e.blockers}` : '')
    )
    .join('\n\n');

  const result = await summarizer.generateSummary([
    {
      userId: 'Weekly entries',
      yesterday: formatted,
      today: 'Summarize this person\'s week based on their daily standup entries. Focus on: accomplishments, ongoing work, blockers encountered, and trajectory. Keep it concise (3-5 bullet points).',
    },
  ]);

  return result.highlights || 'Unable to generate summary.';
}
