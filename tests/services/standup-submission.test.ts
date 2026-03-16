import { describe, expect, it } from 'vitest';
import { SUBMISSION_STATUS } from '../../src/services/collector.js';
import {
  buildSubmissionConfirmationText,
  DAILY_FORM_ACK_PREFIX,
} from '../../src/modals/collect-standup.js';

describe('standup submission messaging', () => {
  it('uses required friendly copy prefix for on-time submission', () => {
    const message = buildSubmissionConfirmationText(SUBMISSION_STATUS.ON_TIME, 'March 13, 2026 09:45');
    expect(message.startsWith(DAILY_FORM_ACK_PREFIX)).toBe(true);
    expect(message).toContain('submitted successfully');
  });

  it('uses required friendly copy prefix for late submission', () => {
    const message = buildSubmissionConfirmationText(SUBMISSION_STATUS.LATE, 'March 13, 2026 09:45');
    expect(message.startsWith(DAILY_FORM_ACK_PREFIX)).toBe(true);
    expect(message).toContain('window closed');
    expect(message).toContain('saved as late');
    expect(message).toContain('excluded');
  });
});
