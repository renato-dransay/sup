import { describe, expect, it } from 'vitest';
import { filterCompilableEntries } from '../../src/services/compiler.js';

describe('compiler late-entry filtering', () => {
  it('excludes late entries from compilable list', () => {
    const entries = [
      { userId: 'U1', submissionStatus: 'on_time' },
      { userId: 'U2', submissionStatus: 'late' },
      { userId: 'U3', submissionStatus: 'on_time' },
    ];

    const { onTimeEntries, lateEntries } = filterCompilableEntries(entries);
    expect(onTimeEntries.map((entry) => entry.userId)).toEqual(['U1', 'U3']);
    expect(lateEntries.map((entry) => entry.userId)).toEqual(['U2']);
  });
});
