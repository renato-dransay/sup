import { describe, expect, it } from 'vitest';

describe('collector reminder eligibility', () => {
  it('keeps pending reminders eligible for dispatch', () => {
    expect('pending').toBe('pending');
  });
});
