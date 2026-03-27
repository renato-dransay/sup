import { describe, it, expect } from 'vitest';
import { parseReminderOffsets, validateReminderOffsets, formatOffsets } from '../../src/utils/date.js';

describe('parseReminderOffsets', () => {
  it('parses comma-separated string to sorted desc number array', () => {
    expect(parseReminderOffsets('5,15,10')).toEqual([15, 10, 5]);
  });

  it('handles single value', () => {
    expect(parseReminderOffsets('30')).toEqual([30]);
  });

  it('trims whitespace', () => {
    expect(parseReminderOffsets(' 15 , 5 ')).toEqual([15, 5]);
  });

  it('returns empty array for empty string', () => {
    expect(parseReminderOffsets('')).toEqual([]);
  });

  it('filters out non-numeric values', () => {
    expect(parseReminderOffsets('15,abc,5')).toEqual([15, 5]);
  });

  it('deduplicates values', () => {
    expect(parseReminderOffsets('15,15,5')).toEqual([15, 5]);
  });
});

describe('validateReminderOffsets', () => {
  it('returns null for valid offsets', () => {
    expect(validateReminderOffsets('15,5')).toBeNull();
  });

  it('rejects values outside 1-60 range', () => {
    expect(validateReminderOffsets('0,5')).toBe('Each reminder must be between 1 and 60 minutes');
    expect(validateReminderOffsets('61,5')).toBe('Each reminder must be between 1 and 60 minutes');
  });

  it('rejects more than 5 entries', () => {
    expect(validateReminderOffsets('1,2,3,4,5,6')).toBe('Maximum 5 reminder times allowed');
  });

  it('rejects empty input', () => {
    expect(validateReminderOffsets('')).toBe('At least one reminder time is required');
  });

  it('rejects non-numeric input', () => {
    expect(validateReminderOffsets('abc')).toBe('At least one reminder time is required');
  });
});

describe('formatOffsets', () => {
  it('formats number array to comma-separated string', () => {
    expect(formatOffsets([15, 5])).toBe('15,5');
  });
});
