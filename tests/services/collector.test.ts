import { describe, expect, it } from 'vitest';
import { resolveSubmissionStatus, SUBMISSION_STATUS } from '../../src/services/collector.js';

describe('collector service', () => {
  it('defaults to on_time when deadline is missing', () => {
    const status = resolveSubmissionStatus(new Date('2026-03-13T09:00:00Z'), null);
    expect(status).toBe(SUBMISSION_STATUS.ON_TIME);
  });

  it('marks status as on_time for submissions at or before deadline', () => {
    const deadlineAt = new Date('2026-03-13T09:45:00Z');
    expect(resolveSubmissionStatus(new Date('2026-03-13T09:44:59Z'), deadlineAt)).toBe(
      SUBMISSION_STATUS.ON_TIME
    );
    expect(resolveSubmissionStatus(new Date('2026-03-13T09:45:00Z'), deadlineAt)).toBe(
      SUBMISSION_STATUS.ON_TIME
    );
  });

  it('marks status as late after deadline', () => {
    const deadlineAt = new Date('2026-03-13T09:45:00Z');
    const status = resolveSubmissionStatus(new Date('2026-03-13T09:45:01Z'), deadlineAt);
    expect(status).toBe(SUBMISSION_STATUS.LATE);
  });
});
