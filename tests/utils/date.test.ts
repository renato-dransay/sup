import { describe, it, expect } from 'vitest';
import {
  formatDate,
  parseCron,
  buildCron,
  validateTimezone,
  getTodayDate,
  calculateDeadlineAt,
  getReminderScheduleTime,
  isOnTimeSubmission,
} from '../../src/utils/date.js';

describe('date utilities', () => {
  describe('formatDate', () => {
    it('should format date correctly', () => {
      const date = new Date('2024-03-15T10:30:00Z');
      const formatted = formatDate(date);
      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('parseCron', () => {
    it('should parse valid cron expression', () => {
      const result = parseCron('30 9 * * *');
      expect(result).toEqual({ hour: 9, minute: 30 });
    });

    it('should return null for invalid cron', () => {
      const result = parseCron('invalid');
      expect(result).toBeNull();
    });
  });

  describe('buildCron', () => {
    it('should build cron expression', () => {
      const cron = buildCron(9, 30);
      expect(cron).toBe('30 9 * * *');
    });
  });

  describe('validateTimezone', () => {
    it('should validate correct timezone', () => {
      expect(validateTimezone('Asia/Kolkata')).toBe(true);
      expect(validateTimezone('America/New_York')).toBe(true);
      expect(validateTimezone('UTC')).toBe(true);
    });

    it('should reject invalid timezone', () => {
      expect(validateTimezone('Invalid/Zone')).toBe(false);
    });
  });

  describe('getTodayDate', () => {
    it('should return date in specified timezone', () => {
      const date = getTodayDate('UTC');
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('deadline helpers', () => {
    it('should calculate deadline from collection window', () => {
      const startedAt = new Date('2026-03-13T09:00:00Z');
      const deadlineAt = calculateDeadlineAt(startedAt, 45);
      expect(deadlineAt.toISOString()).toBe('2026-03-13T09:45:00.000Z');
    });

    it('should calculate reminder schedule time from deadline', () => {
      const deadlineAt = new Date('2026-03-13T09:45:00Z');
      const reminderAt = getReminderScheduleTime(deadlineAt, 15);
      expect(reminderAt.toISOString()).toBe('2026-03-13T09:30:00.000Z');
    });

    it('should detect on-time submission including exact deadline', () => {
      const deadlineAt = new Date('2026-03-13T09:45:00Z');
      expect(isOnTimeSubmission(new Date('2026-03-13T09:44:59Z'), deadlineAt)).toBe(true);
      expect(isOnTimeSubmission(new Date('2026-03-13T09:45:00Z'), deadlineAt)).toBe(true);
      expect(isOnTimeSubmission(new Date('2026-03-13T09:45:01Z'), deadlineAt)).toBe(false);
    });
  });
});
