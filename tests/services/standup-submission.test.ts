import { describe, expect, it } from 'vitest';
import { SUBMISSION_STATUS } from '../../src/services/collector.js';
import { buildSubmissionConfirmationText } from '../../src/modals/collect-standup.js';

describe('standup submission messaging', () => {
  it('uses required friendly copy for on-time submission', () => {
    const message = buildSubmissionConfirmationText(SUBMISSION_STATUS.ON_TIME, 'March 13, 2026 09:45');
    expect(message.startsWith('✅ Thank you, buddy!')).toBe(true);
  });

  it('communicates late submission outcome clearly', () => {
    const message = buildSubmissionConfirmationText(SUBMISSION_STATUS.LATE, 'March 13, 2026 09:45');
    expect(message).toContain('window closed');
    expect(message).toContain('saved as late');
    expect(message).toContain('excluded');
  });
});
