import { describe, it, expect } from 'vitest';
import { getWeekDateRange } from '../../src/services/weekly-summary.js';

describe('getWeekDateRange', () => {
  it('returns Monday–Friday for a Wednesday', () => {
    // 2026-03-25 is a Wednesday
    const { start, end } = getWeekDateRange('2026-03-25');
    expect(start).toBe('2026-03-23');
    expect(end).toBe('2026-03-27');
  });

  it('returns Monday–Friday for a Monday', () => {
    const { start, end } = getWeekDateRange('2026-03-23');
    expect(start).toBe('2026-03-23');
    expect(end).toBe('2026-03-27');
  });

  it('returns Monday–Friday for a Friday', () => {
    const { start, end } = getWeekDateRange('2026-03-27');
    expect(start).toBe('2026-03-23');
    expect(end).toBe('2026-03-27');
  });
});
