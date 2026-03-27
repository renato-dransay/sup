import { describe, it, expect } from 'vitest';
import { resolveReminderConfig } from '../../src/services/preferences.js';

describe('resolveReminderConfig', () => {
  const workspace = {
    remindersEnabled: true,
    reminderOffsets: '15,5',
  };

  it('uses workspace defaults when no preference exists', () => {
    const result = resolveReminderConfig(workspace, null);
    expect(result).toEqual({ enabled: true, offsets: [15, 5] });
  });

  it('uses workspace defaults when preference fields are null', () => {
    const result = resolveReminderConfig(workspace, {
      remindersEnabled: null,
      reminderOffsets: null,
    });
    expect(result).toEqual({ enabled: true, offsets: [15, 5] });
  });

  it('overrides enabled with user preference', () => {
    const result = resolveReminderConfig(workspace, {
      remindersEnabled: false,
      reminderOffsets: null,
    });
    expect(result).toEqual({ enabled: false, offsets: [15, 5] });
  });

  it('overrides offsets with user preference', () => {
    const result = resolveReminderConfig(workspace, {
      remindersEnabled: null,
      reminderOffsets: '30,10',
    });
    expect(result).toEqual({ enabled: true, offsets: [30, 10] });
  });

  it('overrides both fields with user preference', () => {
    const result = resolveReminderConfig(workspace, {
      remindersEnabled: false,
      reminderOffsets: '20',
    });
    expect(result).toEqual({ enabled: false, offsets: [20] });
  });
});
