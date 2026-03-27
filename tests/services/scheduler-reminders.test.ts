import { describe, expect, it } from 'vitest';
import { resolveReminderConfig } from '../../src/services/preferences.js';

describe('scheduler reminders', () => {
  it('resolves default workspace offsets when no user preference exists', () => {
    const workspace = { remindersEnabled: true, reminderOffsets: '15,5' };
    const result = resolveReminderConfig(workspace, null);
    expect(result).toEqual({ enabled: true, offsets: [15, 5] });
  });
});
