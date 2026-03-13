/**
 * Date and timezone utilities for cron scheduling and formatting
 */

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function calculateDeadlineAt(startedAt: Date, collectionWindowMin: number): Date {
  return new Date(startedAt.getTime() + collectionWindowMin * 60 * 1000);
}

export function isOnTimeSubmission(submittedAt: Date, deadlineAt: Date): boolean {
  return submittedAt.getTime() <= deadlineAt.getTime();
}

export function getReminderScheduleTime(deadlineAt: Date, offsetMinutes: number): Date {
  return new Date(deadlineAt.getTime() - offsetMinutes * 60 * 1000);
}

export function getTodayDate(timezone: string): string {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return formatted;
}

export function parseCron(cron: string): { hour: number; minute: number } | null {
  const parts = cron.split(' ');
  if (parts.length < 5) return null;

  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);

  if (isNaN(minute) || isNaN(hour)) return null;

  return { hour, minute };
}

export function buildCron(hour: number, minute: number): string {
  return `${minute} ${hour} * * *`;
}

export function getNextCronTime(cronExpression: string, timezone: string): Date | null {
  try {
    const parsed = parseCron(cronExpression);
    if (!parsed) return null;

    const now = new Date();
    const todayInTz = new Date(now.toLocaleString('en-US', { timeZone: timezone }));

    const nextRun = new Date(todayInTz);
    nextRun.setHours(parsed.hour, parsed.minute, 0, 0);

    // If today's time has passed, schedule for tomorrow
    if (nextRun < todayInTz) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun;
  } catch (error) {
    return null;
  }
}

export function validateTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
