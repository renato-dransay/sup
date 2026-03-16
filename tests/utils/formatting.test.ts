import { describe, it, expect } from 'vitest';
import {
  buildStandupHeaderBlocks,
  buildEntryBlock,
  buildMissedSection,
  buildCompleteStandupBlocks,
} from '../../src/utils/formatting.js';

describe('formatting utilities', () => {
  describe('buildStandupHeaderBlocks', () => {
    it('should create header blocks with date, timezone, and deadline', () => {
      const blocks = buildStandupHeaderBlocks(
        '2024-03-15',
        'Asia/Kolkata',
        'March 15, 2024 at 09:45 AM IST'
      );

      expect(blocks).toHaveLength(3);
      expect(blocks[0].type).toBe('header');
      expect(blocks[1].type).toBe('context');
      expect(blocks[2].type).toBe('divider');
      expect(blocks[1]).toMatchObject({
        elements: [
          {
            text: expect.stringContaining('*Deadline:* March 15, 2024 at 09:45 AM IST'),
          },
        ],
      });
    });
  });

  describe('buildEntryBlock', () => {
    it('should create entry blocks with all fields', () => {
      const entry = {
        userId: 'U12345',
        userName: 'John Doe',
        yesterday: 'Worked on feature X',
        today: 'Will work on feature Y',
        blockers: 'Need design review',
      };

      const blocks = buildEntryBlock(entry);

      expect(blocks.length).toBeGreaterThan(2);
      expect(blocks[0].type).toBe('section');
      expect(blocks[blocks.length - 1].type).toBe('divider');
    });

    it('should handle entry without blockers', () => {
      const entry = {
        userId: 'U12345',
        userName: 'John Doe',
        yesterday: 'Worked on feature X',
        today: 'Will work on feature Y',
      };

      const blocks = buildEntryBlock(entry);

      expect(blocks).toBeDefined();
      expect(blocks[blocks.length - 1].type).toBe('divider');
    });
  });

  describe('buildMissedSection', () => {
    it('should return empty array when no users missed', () => {
      const blocks = buildMissedSection([]);
      expect(blocks).toHaveLength(0);
    });

    it('should create section for missed users', () => {
      const blocks = buildMissedSection(['U123', 'U456']);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('section');
    });
  });

  describe('buildCompleteStandupBlocks', () => {
    it('should combine all blocks correctly', () => {
      const entries = [
        {
          userId: 'U123',
          userName: 'Alice',
          yesterday: 'Task A',
          today: 'Task B',
        },
      ];

      const blocks = buildCompleteStandupBlocks(
        '2024-03-15',
        'Asia/Kolkata',
        entries,
        [],
        'March 15, 2024 at 09:45 AM IST'
      );

      expect(blocks.length).toBeGreaterThan(3);
      expect(blocks[1]).toMatchObject({
        elements: [
          {
            text: expect.stringContaining('*Deadline:* March 15, 2024 at 09:45 AM IST'),
          },
        ],
      });
    });
  });
});
