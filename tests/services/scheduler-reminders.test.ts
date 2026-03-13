import { describe, expect, it } from 'vitest';
import { getReminderOffsets } from '../../src/services/scheduler.js';

describe('scheduler reminders', () => {
  it('returns expected reminder offsets', () => {
    expect(getReminderOffsets()).toEqual([15, 5]);
  });
});
