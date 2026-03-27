import { describe, it, expect } from 'vitest';
import { isDateInRange, parseDateArg } from '../../src/services/excuses.js';

describe('isDateInRange', () => {
  it('returns true when date equals startDate', () => {
    expect(isDateInRange('2026-04-01', '2026-04-01', '2026-04-05')).toBe(true);
  });

  it('returns true when date equals endDate', () => {
    expect(isDateInRange('2026-04-05', '2026-04-01', '2026-04-05')).toBe(true);
  });

  it('returns true when date is between start and end', () => {
    expect(isDateInRange('2026-04-03', '2026-04-01', '2026-04-05')).toBe(true);
  });

  it('returns false when date is before startDate', () => {
    expect(isDateInRange('2026-03-31', '2026-04-01', '2026-04-05')).toBe(false);
  });

  it('returns false when date is after endDate', () => {
    expect(isDateInRange('2026-04-06', '2026-04-01', '2026-04-05')).toBe(false);
  });

  it('handles single-day excuse (start == end)', () => {
    expect(isDateInRange('2026-04-01', '2026-04-01', '2026-04-01')).toBe(true);
    expect(isDateInRange('2026-04-02', '2026-04-01', '2026-04-01')).toBe(false);
  });
});

describe('parseDateArg', () => {
  it('returns today date for "today"', () => {
    const result = parseDateArg('today', 'UTC');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
    expect(result).toBe(today);
  });

  it('returns tomorrow date for "tomorrow"', () => {
    const result = parseDateArg('tomorrow', 'UTC');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(tomorrow);
    expect(result).toBe(expected);
  });

  it('returns the date as-is for YYYY-MM-DD format', () => {
    expect(parseDateArg('2026-04-01', 'UTC')).toBe('2026-04-01');
  });

  it('returns null for invalid input', () => {
    expect(parseDateArg('invalid', 'UTC')).toBeNull();
    expect(parseDateArg('04/01/2026', 'UTC')).toBeNull();
  });
});
