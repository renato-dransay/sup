# Advanced Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-workspace response window, user excuses, configurable reminders with per-user overrides, auto-recompile for late answers, and on-demand personal weekly summary.

**Architecture:** New Prisma models (MemberPreference, Excuse) + workspace field additions. Hub-and-spoke UX via `/standup me` with section-specific modals. Resolution logic for per-user reminder preferences using null-coalesce over workspace defaults.

**Tech Stack:** TypeScript, Prisma (SQLite), Slack Bolt, node-cron, OpenAI API, Vitest

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/services/preferences.ts` | MemberPreference CRUD + reminder config resolution |
| `src/services/excuses.ts` | Excuse CRUD + "is user excused today?" query |
| `src/services/weekly-summary.ts` | Fetch user's weekly entries + generate personal summary |
| `src/commands/standup-me.ts` | Hub command + subcommand routing (me, me reminders, me excuse) |
| `src/commands/standup-weekly.ts` | Weekly summary command handler |
| `src/modals/me-reminders.ts` | Reminders preference modal submission handler |
| `src/modals/me-excuse.ts` | Excuse modal submission handler |
| `tests/services/preferences.test.ts` | Tests for preference resolution logic |
| `tests/services/excuses.test.ts` | Tests for excuse date-range logic |
| `tests/services/weekly-summary.test.ts` | Tests for weekly entry fetching + formatting |
| `tests/utils/offsets.test.ts` | Tests for offset parsing/validation |

### Modified Files
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add Workspace fields, MemberPreference model, Excuse model, Member relations |
| `src/utils/formatting.ts` | Add config modal new fields, excused section, hub message, reminders/excuse modals, weekly summary blocks |
| `src/modals/setup-config.ts` | Handle new workspace config fields (window, reminders, offsets) |
| `src/services/collector.ts` | Skip excused users, per-user reminder seeding |
| `src/services/compiler.ts` | Add excused section to compilation, auto-recompile on late entry |
| `src/services/scheduler.ts` | Read window from workspace, per-user reminder offsets, remove `collectionWindowMin` param |
| `src/modals/collect-standup.ts` | Trigger auto-recompile after late submission |
| `src/app.ts` | Register new commands, modals, actions |
| `src/commands/standup-config.ts` | Pass new fields to config modal builder |

---

### Task 1: Database Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add new fields and models to Prisma schema**

```prisma
// Add to Workspace model, after summaryEnabled field:
  collectionWindowMin Int     @default(45)
  remindersEnabled    Boolean @default(true)
  reminderOffsets     String  @default("15,5")

// Add to Member model, after updatedAt field:
  preference MemberPreference?
  excuses    Excuse[]

// Add new models after JobLock:

model MemberPreference {
  id               String   @id @default(uuid())
  memberId         String   @unique
  remindersEnabled Boolean?
  reminderOffsets  String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  member Member @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@index([memberId])
}

model Excuse {
  id        String   @id @default(uuid())
  memberId  String
  startDate String
  endDate   String
  reason    String?
  createdAt DateTime @default(now())

  member Member @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@index([memberId, startDate, endDate])
}
```

- [ ] **Step 2: Run migration**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm prisma migrate dev --name advanced_config`
Expected: Migration created and applied successfully, Prisma client regenerated.

- [ ] **Step 3: Verify generated client**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm prisma generate`
Expected: Prisma Client generated successfully.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add schema for preferences, excuses, and workspace config fields"
```

---

### Task 2: Offset Parsing Utility

**Files:**
- Create: `tests/utils/offsets.test.ts`
- Modify: `src/utils/date.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/utils/offsets.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseReminderOffsets, validateReminderOffsets, formatOffsets } from '../../src/utils/date.js';

describe('parseReminderOffsets', () => {
  it('parses comma-separated string to sorted desc number array', () => {
    expect(parseReminderOffsets('5,15,10')).toEqual([15, 10, 5]);
  });

  it('handles single value', () => {
    expect(parseReminderOffsets('30')).toEqual([30]);
  });

  it('trims whitespace', () => {
    expect(parseReminderOffsets(' 15 , 5 ')).toEqual([15, 5]);
  });

  it('returns empty array for empty string', () => {
    expect(parseReminderOffsets('')).toEqual([]);
  });

  it('filters out non-numeric values', () => {
    expect(parseReminderOffsets('15,abc,5')).toEqual([15, 5]);
  });

  it('deduplicates values', () => {
    expect(parseReminderOffsets('15,15,5')).toEqual([15, 5]);
  });
});

describe('validateReminderOffsets', () => {
  it('returns null for valid offsets', () => {
    expect(validateReminderOffsets('15,5')).toBeNull();
  });

  it('rejects values outside 1-60 range', () => {
    expect(validateReminderOffsets('0,5')).toBe('Each reminder must be between 1 and 60 minutes');
    expect(validateReminderOffsets('61,5')).toBe('Each reminder must be between 1 and 60 minutes');
  });

  it('rejects more than 5 entries', () => {
    expect(validateReminderOffsets('1,2,3,4,5,6')).toBe('Maximum 5 reminder times allowed');
  });

  it('rejects empty input', () => {
    expect(validateReminderOffsets('')).toBe('At least one reminder time is required');
  });

  it('rejects non-numeric input', () => {
    expect(validateReminderOffsets('abc')).toBe('At least one reminder time is required');
  });
});

describe('formatOffsets', () => {
  it('formats number array to comma-separated string', () => {
    expect(formatOffsets([15, 5])).toBe('15,5');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/utils/offsets.test.ts`
Expected: FAIL — functions not found.

- [ ] **Step 3: Implement the functions**

Add to the end of `src/utils/date.ts`:

```typescript
export function parseReminderOffsets(input: string): number[] {
  if (!input.trim()) return [];
  const values = input
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  const unique = [...new Set(values)];
  return unique.sort((a, b) => b - a);
}

export function validateReminderOffsets(input: string): string | null {
  const parsed = parseReminderOffsets(input);
  if (parsed.length === 0) return 'At least one reminder time is required';
  if (parsed.length > 5) return 'Maximum 5 reminder times allowed';
  if (parsed.some((n) => n < 1 || n > 60)) return 'Each reminder must be between 1 and 60 minutes';
  return null;
}

export function formatOffsets(offsets: number[]): string {
  return offsets.join(',');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/utils/offsets.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/date.ts tests/utils/offsets.test.ts
git commit -m "feat: add reminder offset parsing and validation utilities"
```

---

### Task 3: Preferences Service

**Files:**
- Create: `src/services/preferences.ts`
- Create: `tests/services/preferences.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/services/preferences.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/services/preferences.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the preferences service**

Create `src/services/preferences.ts`:

```typescript
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { parseReminderOffsets } from '../utils/date.js';

export interface ReminderConfig {
  enabled: boolean;
  offsets: number[];
}

export function resolveReminderConfig(
  workspace: { remindersEnabled: boolean; reminderOffsets: string },
  preference: { remindersEnabled: boolean | null; reminderOffsets: string | null } | null
): ReminderConfig {
  const enabled = preference?.remindersEnabled ?? workspace.remindersEnabled;
  const offsetsStr = preference?.reminderOffsets ?? workspace.reminderOffsets;
  const offsets = parseReminderOffsets(offsetsStr);
  return { enabled, offsets };
}

export async function getMemberPreference(memberId: string) {
  return prisma.memberPreference.findUnique({
    where: { memberId },
  });
}

export async function upsertMemberPreference(
  memberId: string,
  data: { remindersEnabled: boolean | null; reminderOffsets: string | null }
): Promise<void> {
  await prisma.memberPreference.upsert({
    where: { memberId },
    create: {
      memberId,
      remindersEnabled: data.remindersEnabled,
      reminderOffsets: data.reminderOffsets,
    },
    update: {
      remindersEnabled: data.remindersEnabled,
      reminderOffsets: data.reminderOffsets,
    },
  });
  logger.info({ memberId }, 'Member preference updated');
}

export async function resolveUserReminderConfig(
  workspaceId: string,
  userId: string
): Promise<ReminderConfig> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { remindersEnabled: true, reminderOffsets: true },
  });

  if (!workspace) {
    return { enabled: true, offsets: [15, 5] };
  }

  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { preference: true },
  });

  return resolveReminderConfig(workspace, member?.preference ?? null);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/services/preferences.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/preferences.ts tests/services/preferences.test.ts
git commit -m "feat: add preferences service with reminder config resolution"
```

---

### Task 4: Excuses Service

**Files:**
- Create: `src/services/excuses.ts`
- Create: `tests/services/excuses.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/services/excuses.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isDateInRange, parseDateArg } from '../../src/services/excuses.js';

describe('isDateInRange', () => {
  it('returns true when date equals startDate', () => {
    expect(isDateInRange('2026-04-01', '2026-04-01', '2026-04-05')).toBe(true);
  });

  it('returns true when date equals endDate', () => {
    expect(isDateInRange('2026-04-05', '2026-04-01', '2026-04-05')).toBe(true);
  });

  it('returns true when date is between start and end', () => {
    expect(isDateInRange('2026-04-03', '2026-04-01', '2026-04-05')).toBe(true);
  });

  it('returns false when date is before startDate', () => {
    expect(isDateInRange('2026-03-31', '2026-04-01', '2026-04-05')).toBe(false);
  });

  it('returns false when date is after endDate', () => {
    expect(isDateInRange('2026-04-06', '2026-04-01', '2026-04-05')).toBe(false);
  });

  it('handles single-day excuse (start == end)', () => {
    expect(isDateInRange('2026-04-01', '2026-04-01', '2026-04-01')).toBe(true);
    expect(isDateInRange('2026-04-02', '2026-04-01', '2026-04-01')).toBe(false);
  });
});

describe('parseDateArg', () => {
  it('returns today date for "today"', () => {
    const result = parseDateArg('today', 'UTC');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
    expect(result).toBe(today);
  });

  it('returns tomorrow date for "tomorrow"', () => {
    const result = parseDateArg('tomorrow', 'UTC');
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expected = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(tomorrow);
    expect(result).toBe(expected);
  });

  it('returns the date as-is for YYYY-MM-DD format', () => {
    expect(parseDateArg('2026-04-01', 'UTC')).toBe('2026-04-01');
  });

  it('returns null for invalid input', () => {
    expect(parseDateArg('invalid', 'UTC')).toBeNull();
    expect(parseDateArg('04/01/2026', 'UTC')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/services/excuses.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the excuses service**

Create `src/services/excuses.ts`:

```typescript
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';

export function isDateInRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

export function parseDateArg(arg: string, timezone: string): string | null {
  const lower = arg.toLowerCase().trim();

  if (lower === 'today') {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  }

  if (lower === 'tomorrow') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(tomorrow);
  }

  // Validate YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return lower;
  }

  return null;
}

export async function createExcuse(
  memberId: string,
  startDate: string,
  endDate: string,
  reason?: string
): Promise<string> {
  const excuse = await prisma.excuse.create({
    data: {
      memberId,
      startDate,
      endDate,
      reason: reason || null,
    },
  });
  logger.info({ excuseId: excuse.id, memberId, startDate, endDate }, 'Excuse created');
  return excuse.id;
}

export async function deleteExcuse(excuseId: string): Promise<void> {
  await prisma.excuse.delete({ where: { id: excuseId } });
  logger.info({ excuseId }, 'Excuse deleted');
}

export async function getActiveExcuses(memberId: string, asOfDate: string) {
  return prisma.excuse.findMany({
    where: {
      memberId,
      endDate: { gte: asOfDate },
    },
    orderBy: { startDate: 'asc' },
  });
}

export async function getExcusedMemberIds(workspaceId: string, date: string): Promise<string[]> {
  const members = await prisma.member.findMany({
    where: {
      workspaceId,
      optedIn: true,
      excuses: {
        some: {
          startDate: { lte: date },
          endDate: { gte: date },
        },
      },
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function getExcusedUsersWithReasons(
  workspaceId: string,
  date: string
): Promise<Array<{ userId: string; reason: string | null }>> {
  const members = await prisma.member.findMany({
    where: {
      workspaceId,
      optedIn: true,
      excuses: {
        some: {
          startDate: { lte: date },
          endDate: { gte: date },
        },
      },
    },
    include: {
      excuses: {
        where: {
          startDate: { lte: date },
          endDate: { gte: date },
        },
        take: 1,
      },
    },
  });
  return members.map((m) => ({
    userId: m.userId,
    reason: m.excuses[0]?.reason ?? null,
  }));
}

export async function getMemberIdByUserId(
  workspaceId: string,
  userId: string
): Promise<string | null> {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { id: true },
  });
  return member?.id ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/services/excuses.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/excuses.ts tests/services/excuses.test.ts
git commit -m "feat: add excuses service with date range logic and CRUD"
```

---

### Task 5: Formatting — Config Modal, Excused Section, Hub Message, Modals

**Files:**
- Modify: `src/utils/formatting.ts`

- [ ] **Step 1: Add new fields to `buildConfigModal`**

In `src/utils/formatting.ts`, update the `buildConfigModal` function's parameter interface and blocks array. Replace the function entirely:

```typescript
export function buildConfigModal(currentConfig?: {
  channelId?: string;
  timezone?: string;
  hour?: number;
  minute?: number;
  summaryEnabled?: boolean;
  collectionWindowMin?: number;
  remindersEnabled?: boolean;
  reminderOffsets?: string;
}): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
} {
  return {
    type: 'modal',
    callback_id: 'standup_config_modal',
    title: {
      type: 'plain_text',
      text: 'Configure Stand-up',
    },
    submit: {
      type: 'plain_text',
      text: 'Save',
    },
    blocks: [
      {
        type: 'input',
        block_id: 'channel_block',
        element: {
          type: 'conversations_select',
          action_id: 'channel_select',
          placeholder: {
            type: 'plain_text',
            text: 'Select a channel',
          },
          filter: {
            include: ['public', 'private'],
          },
          ...(currentConfig?.channelId && { initial_conversation: currentConfig.channelId }),
        },
        label: {
          type: 'plain_text',
          text: 'Target Channel',
        },
      },
      {
        type: 'input',
        block_id: 'time_block',
        element: {
          type: 'plain_text_input',
          action_id: 'time_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., 09:30',
          },
          initial_value:
            currentConfig?.hour !== undefined && currentConfig?.minute !== undefined
              ? `${String(currentConfig.hour).padStart(2, '0')}:${String(currentConfig.minute).padStart(2, '0')}`
              : '09:30',
        },
        label: {
          type: 'plain_text',
          text: 'Stand-up Time (HH:MM)',
        },
      },
      {
        type: 'input',
        block_id: 'timezone_block',
        element: {
          type: 'plain_text_input',
          action_id: 'timezone_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., Asia/Kolkata',
          },
          initial_value: currentConfig?.timezone || 'Asia/Kolkata',
        },
        label: {
          type: 'plain_text',
          text: 'Timezone',
        },
      },
      {
        type: 'input',
        block_id: 'window_block',
        element: {
          type: 'plain_text_input',
          action_id: 'window_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., 45',
          },
          initial_value: String(currentConfig?.collectionWindowMin ?? 45),
        },
        label: {
          type: 'plain_text',
          text: 'Response Window (minutes, 10-120)',
        },
      },
      {
        type: 'input',
        block_id: 'reminder_offsets_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reminder_offsets_input',
          placeholder: {
            type: 'plain_text',
            text: 'e.g., 15,5',
          },
          initial_value: currentConfig?.reminderOffsets ?? '15,5',
        },
        label: {
          type: 'plain_text',
          text: 'Reminder Times (minutes before deadline, comma-separated)',
        },
      },
      {
        type: 'input',
        block_id: 'summary_block',
        element: {
          type: 'checkboxes',
          action_id: 'summary_checkbox',
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'Enable AI summary',
              },
              value: 'enabled',
            },
          ],
          ...(currentConfig?.summaryEnabled && {
            initial_options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Enable AI summary',
                },
                value: 'enabled',
              },
            ],
          }),
        },
        label: {
          type: 'plain_text',
          text: 'Summary Settings',
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'reminders_block',
        element: {
          type: 'checkboxes',
          action_id: 'reminders_checkbox',
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'Enable reminders',
              },
              value: 'enabled',
            },
          ],
          ...(currentConfig?.remindersEnabled !== false && {
            initial_options: [
              {
                text: {
                  type: 'plain_text',
                  text: 'Enable reminders',
                },
                value: 'enabled',
              },
            ],
          }),
        },
        label: {
          type: 'plain_text',
          text: 'Reminder Settings',
        },
        optional: true,
      },
    ],
  };
}
```

- [ ] **Step 2: Add `buildExcusedSection` function**

Add after `buildMissedSection` in `src/utils/formatting.ts`:

```typescript
export function buildExcusedSection(
  excusedUsers: Array<{ userId: string; userName: string; reason?: string | null }>
): KnownBlock[] {
  if (excusedUsers.length === 0) return [];

  const lines = excusedUsers
    .map((u) => (u.reason ? `• ${u.userName} (${u.reason})` : `• ${u.userName}`))
    .join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*🏖 Excused*\n${lines}`,
      },
    },
  ];
}
```

- [ ] **Step 3: Add `buildMeHubBlocks` function**

Add at the end of `src/utils/formatting.ts`:

```typescript
export function buildMeHubBlocks(config: {
  remindersLabel: string;
  offsetsLabel: string;
  excusesLabel: string;
}): (Block | KnownBlock)[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*👤 Your Stand-up Preferences*\n\n` +
          `*Reminders:* ${config.remindersLabel} | *Offsets:* ${config.offsetsLabel}\n` +
          `*Excuses:* ${config.excusesLabel}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔔 Reminders' },
          action_id: 'open_reminders_modal',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🏖 Excuse' },
          action_id: 'open_excuse_modal',
        },
      ],
    },
  ];
}
```

- [ ] **Step 4: Add `buildRemindersModal` function**

```typescript
export function buildRemindersModal(current?: {
  remindersEnabled: boolean | null;
  reminderOffsets: string | null;
  workspaceDefault: string;
}): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
} {
  const currentValue =
    current?.remindersEnabled === null
      ? 'default'
      : current?.remindersEnabled
        ? 'on'
        : 'off';

  return {
    type: 'modal',
    callback_id: 'standup_me_reminders_modal',
    title: { type: 'plain_text', text: 'Reminder Preferences' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [
      {
        type: 'input',
        block_id: 'reminders_enabled_block',
        element: {
          type: 'static_select',
          action_id: 'reminders_enabled_select',
          options: [
            { text: { type: 'plain_text', text: 'Use workspace default' }, value: 'default' },
            { text: { type: 'plain_text', text: 'On' }, value: 'on' },
            { text: { type: 'plain_text', text: 'Off' }, value: 'off' },
          ],
          initial_option: {
            text: {
              type: 'plain_text',
              text:
                currentValue === 'default'
                  ? 'Use workspace default'
                  : currentValue === 'on'
                    ? 'On'
                    : 'Off',
            },
            value: currentValue,
          },
        },
        label: { type: 'plain_text', text: 'Reminders' },
      },
      {
        type: 'input',
        block_id: 'reminder_offsets_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reminder_offsets_input',
          placeholder: {
            type: 'plain_text',
            text: `Workspace default: ${current?.workspaceDefault ?? '15,5'}`,
          },
          ...(current?.reminderOffsets && { initial_value: current.reminderOffsets }),
        },
        label: {
          type: 'plain_text',
          text: 'Reminder Times (minutes before deadline, leave empty for workspace default)',
        },
        optional: true,
      },
    ],
  };
}
```

- [ ] **Step 5: Add `buildExcuseModal` function**

```typescript
export function buildExcuseModal(): {
  type: string;
  title: { type: string; text: string };
  blocks: KnownBlock[];
  submit: { type: string; text: string };
  callback_id: string;
} {
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());

  return {
    type: 'modal',
    callback_id: 'standup_me_excuse_modal',
    title: { type: 'plain_text', text: 'Set Absence' },
    submit: { type: 'plain_text', text: 'Save' },
    blocks: [
      {
        type: 'input',
        block_id: 'start_date_block',
        element: {
          type: 'datepicker',
          action_id: 'start_date_picker',
          initial_date: today,
          placeholder: { type: 'plain_text', text: 'Start date' },
        },
        label: { type: 'plain_text', text: 'Start Date' },
      },
      {
        type: 'input',
        block_id: 'end_date_block',
        element: {
          type: 'datepicker',
          action_id: 'end_date_picker',
          initial_date: today,
          placeholder: { type: 'plain_text', text: 'End date' },
        },
        label: { type: 'plain_text', text: 'End Date' },
      },
      {
        type: 'input',
        block_id: 'reason_block',
        element: {
          type: 'plain_text_input',
          action_id: 'reason_input',
          placeholder: { type: 'plain_text', text: 'e.g., Vacation, Sick leave' },
        },
        label: { type: 'plain_text', text: 'Reason (optional)' },
        optional: true,
      },
    ],
  };
}
```

- [ ] **Step 6: Add `buildWeeklySummaryBlocks` function**

```typescript
export function buildWeeklySummaryBlocks(
  dateRange: string,
  entries: Array<{ date: string; dayName: string; yesterday: string; today: string; blockers?: string }>,
  aiSummary?: string
): (Block | KnownBlock)[] {
  const blocks: (Block | KnownBlock)[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `📅 Your Week (${dateRange})`, emoji: true },
    },
  ];

  if (aiSummary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: aiSummary },
    });
    blocks.push({ type: 'divider' });
  }

  for (const entry of entries) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${entry.dayName} (${entry.date}):*\n` +
          `*Yesterday:* ${entry.yesterday}\n` +
          `*Today:* ${entry.today}` +
          (entry.blockers ? `\n*Blockers:* ${entry.blockers}` : ''),
      },
    });
  }

  if (entries.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'No standup entries found for this week.' },
    });
  }

  return blocks;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/utils/formatting.ts
git commit -m "feat: add formatting functions for config modal, excused section, hub, and modals"
```

---

### Task 6: Update Workspace Config Handler

**Files:**
- Modify: `src/commands/standup-config.ts`
- Modify: `src/modals/setup-config.ts`

- [ ] **Step 1: Update `standup-config.ts` to pass new fields to modal**

Replace the `buildConfigModal` call in `src/commands/standup-config.ts`:

```typescript
    const modal = buildConfigModal({
      channelId: workspace.defaultChannelId,
      timezone: workspace.timezone,
      hour: cronParsed?.hour,
      minute: cronParsed?.minute,
      summaryEnabled: workspace.summaryEnabled,
      collectionWindowMin: workspace.collectionWindowMin,
      remindersEnabled: workspace.remindersEnabled,
      reminderOffsets: workspace.reminderOffsets,
    });
```

- [ ] **Step 2: Update `setup-config.ts` to handle new fields**

In `src/modals/setup-config.ts`, add parsing and saving for the new fields. Inside the handler, after the `summaryEnabled` extraction:

```typescript
      const windowInput = values.window_block.window_input.value as string;
      const collectionWindowMin = parseInt(windowInput, 10);
      if (isNaN(collectionWindowMin) || collectionWindowMin < 10 || collectionWindowMin > 120) {
        await ack({
          response_action: 'errors',
          errors: {
            window_block: 'Response window must be between 10 and 120 minutes',
          },
        });
        return;
      }

      const reminderOffsetsInput = values.reminder_offsets_block.reminder_offsets_input.value as string;
      const offsetsError = validateReminderOffsets(reminderOffsetsInput);
      if (offsetsError) {
        await ack({
          response_action: 'errors',
          errors: {
            reminder_offsets_block: offsetsError,
          },
        });
        return;
      }
      const reminderOffsets = formatOffsets(parseReminderOffsets(reminderOffsetsInput));

      const remindersEnabled =
        (values.reminders_block.reminders_checkbox.selected_options?.length ?? 0) > 0;
```

Add `validateReminderOffsets`, `parseReminderOffsets`, `formatOffsets` to the imports from `'../utils/date.js'`.

Update the `upsert` data to include the new fields:

```typescript
      const workspace = await prisma.workspace.upsert({
        where: { teamId },
        create: {
          teamId,
          defaultChannelId: channelId,
          timezone,
          cron,
          summaryEnabled,
          collectionWindowMin,
          remindersEnabled,
          reminderOffsets,
        },
        update: {
          defaultChannelId: channelId,
          timezone,
          cron,
          summaryEnabled,
          collectionWindowMin,
          remindersEnabled,
          reminderOffsets,
        },
      });
```

Update the confirmation message:

```typescript
      try {
        await client.chat.postMessage({
          channel: channelId,
          text:
            `✅ Stand-up bot configured successfully!\n\n` +
            `Stand-ups will be collected at *${timeInput}* (${timezone}) and posted here.\n` +
            `Response Window: ${collectionWindowMin} minutes\n` +
            `Reminders: ${remindersEnabled ? `Enabled (${reminderOffsets} min before deadline)` : 'Disabled'}\n` +
            `AI Summary: ${summaryEnabled ? 'Enabled' : 'Disabled'}\n\n` +
            `Use \`/standup optin\` to participate and \`/standup status\` to view details.`,
        });
```

Remove the `collectionWindowMin` parameter from `createSetupConfigHandler` since it's now read from the workspace. Update the scheduler call:

```typescript
      cancelWorkspaceJob(workspace.id);
      await scheduleWorkspaceJob(workspace.id, client, summarizer);
```

- [ ] **Step 3: Update `createSetupConfigHandler` signature**

Change the function signature to remove `collectionWindowMin`:

```typescript
export function createSetupConfigHandler(
  client: WebClient,
  summarizer: SummarizerProvider | null
) {
```

- [ ] **Step 4: Verify typecheck**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm typecheck`
Expected: No errors (may need to update scheduler signature first — see Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/commands/standup-config.ts src/modals/setup-config.ts
git commit -m "feat: add response window, reminders, and offsets to workspace config"
```

---

### Task 7: Update Collector — Skip Excused Users, Per-User Reminders

**Files:**
- Modify: `src/services/collector.ts`

- [ ] **Step 1: Update `collectFromUsers` to skip excused users**

Add imports at top of `src/services/collector.ts`:

```typescript
import { getExcusedMemberIds } from './excuses.js';
import { resolveUserReminderConfig } from './preferences.js';
```

In `collectFromUsers`, after getting `userIds`, add:

```typescript
    const today = getTodayDate(standup.workspace.timezone);
    const excusedUserIds = await getExcusedMemberIds(workspaceId, today);
    const excusedSet = new Set(excusedUserIds);
    const activeUserIds = userIds.filter((id) => !excusedSet.has(id));
```

Replace the `seedReminderDispatches` call and DM loop to use `activeUserIds` instead of `userIds`. Only seed reminders and send DMs to `activeUserIds`.

- [ ] **Step 2: Update `seedReminderDispatches` to be per-user aware**

Replace the `seedReminderDispatches` function:

```typescript
export async function seedReminderDispatches(
  standupId: string,
  userIds: string[],
  deadlineAt: Date,
  workspaceId: string
): Promise<number[]> {
  if (userIds.length === 0) {
    return [];
  }

  const allOffsets = new Set<number>();

  for (const userId of userIds) {
    const config = await resolveUserReminderConfig(workspaceId, userId);

    if (!config.enabled) continue;

    for (const offsetMinutes of config.offsets) {
      allOffsets.add(offsetMinutes);

      await prisma.reminderDispatch.upsert({
        where: {
          standupId_userId_offsetMinutes: {
            standupId,
            userId,
            offsetMinutes,
          },
        },
        create: {
          standupId,
          userId,
          offsetMinutes,
          scheduledFor: getReminderScheduleTime(deadlineAt, offsetMinutes),
          status: REMINDER_STATUS.PENDING,
        },
        update: {
          scheduledFor: getReminderScheduleTime(deadlineAt, offsetMinutes),
          status: REMINDER_STATUS.PENDING,
          failureReason: null,
        },
      });
    }
  }

  return [...allOffsets].sort((a, b) => b - a);
}
```

- [ ] **Step 3: Update `sendRemindersForOffset` to accept `number` instead of `15 | 5`**

Change the signature:

```typescript
export async function sendRemindersForOffset(
  client: WebClient,
  standupId: string,
  offsetMinutes: number
): Promise<void> {
```

- [ ] **Step 4: Update callers of `seedReminderDispatches`**

In `collectFromUsers`, update the call to pass `workspaceId` and use `activeUserIds`:

```typescript
    const uniqueOffsets = await seedReminderDispatches(
      standupId,
      activeUserIds,
      standup.deadlineAt ?? new Date(standup.startedAt),
      workspaceId
    );
```

Return `uniqueOffsets` from `collectFromUsers` so the scheduler can schedule timers for them. Update the function signature:

```typescript
export async function collectFromUsers(
  client: WebClient,
  workspaceId: string,
  standupId: string,
  triggerId?: string,
  specificUserId?: string
): Promise<number[]> {
```

Return `uniqueOffsets` at the end (after the DM loop).

- [ ] **Step 5: Commit**

```bash
git add src/services/collector.ts
git commit -m "feat: skip excused users in collection, per-user reminder seeding"
```

---

### Task 8: Update Scheduler — Read Window from Workspace, Dynamic Offsets

**Files:**
- Modify: `src/services/scheduler.ts`

- [ ] **Step 1: Remove `collectionWindowMin` parameter from scheduler functions**

Update `scheduleWorkspaceJobs`:

```typescript
export async function scheduleWorkspaceJobs(
  client: WebClient,
  summarizer: SummarizerProvider | null
): Promise<void> {
  try {
    const workspaces = await prisma.workspace.findMany();

    for (const workspace of workspaces) {
      await scheduleWorkspaceJob(workspace.id, client, summarizer);
    }

    logger.info({ count: workspaces.length }, 'Scheduled jobs for workspaces');
  } catch (error) {
    logger.error({ error }, 'Failed to schedule workspace jobs');
    throw error;
  }
}
```

Update `scheduleWorkspaceJob`:

```typescript
export async function scheduleWorkspaceJob(
  workspaceId: string,
  client: WebClient,
  summarizer: SummarizerProvider | null
): Promise<void> {
```

Inside, read `collectionWindowMin` from the workspace:

```typescript
    const collectionWindowMin = workspace.collectionWindowMin;
```

- [ ] **Step 2: Update `scheduleStandupReminders` to accept dynamic offsets**

```typescript
export function scheduleStandupReminders(
  client: WebClient,
  standupId: string,
  deadlineAt: Date | null,
  offsets: number[]
): void {
  if (!deadlineAt) {
    logger.warn({ standupId }, 'Skipping reminder scheduling because deadline is missing');
    return;
  }

  for (const offset of offsets) {
    const scheduledAt = new Date(deadlineAt.getTime() - offset * 60 * 1000);
    const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());

    const timer = setTimeout(() => {
      void sendRemindersForOffset(client, standupId, offset);
    }, delayMs);

    trackReminderTimer(standupId, timer);
    logger.info({ standupId, offsetMinutes: offset, scheduledAt }, 'Reminder scheduled');
  }
}
```

Remove the `getReminderOffsets` function.

- [ ] **Step 3: Update the collection task in `scheduleWorkspaceJob`**

After `collectFromUsers` returns `uniqueOffsets`:

```typescript
            const uniqueOffsets = await collectFromUsers(client, workspaceId, standupId);
            const standup = await prisma.standup.findUnique({
              where: { id: standupId },
              select: { deadlineAt: true },
            });
            scheduleStandupReminders(client, standupId, standup?.deadlineAt ?? null, uniqueOffsets);
```

- [ ] **Step 4: Update `src/index.ts` to remove `collectionWindowMin` from scheduler call**

In `src/index.ts`, change:

```typescript
    await scheduleWorkspaceJobs(client, summarizer);
```

- [ ] **Step 5: Update `src/app.ts` to remove `collectionWindowMin` from `createSetupConfigHandler`**

```typescript
  app.view(
    'standup_config_modal',
    createSetupConfigHandler(client, summarizer)
  );
```

Also update `createStandupTodayHandler` — it currently takes `collectionWindowMin`. Update it to read from workspace instead. In `src/commands/standup-today.ts`, read from workspace:

```typescript
export function createStandupTodayHandler(
  summarizer: SummarizerProvider | null
) {
```

Inside the handler, after finding the workspace, use `workspace.collectionWindowMin`.

Update `src/app.ts`:

```typescript
  app.command('/standup-today', createStandupTodayHandler(summarizer));
```

- [ ] **Step 6: Verify typecheck**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/services/scheduler.ts src/index.ts src/app.ts src/commands/standup-today.ts
git commit -m "feat: scheduler reads window/offsets from workspace, supports dynamic per-user offsets"
```

---

### Task 9: Update Compiler — Excused Section + Auto-Recompile

**Files:**
- Modify: `src/services/compiler.ts`
- Modify: `src/modals/collect-standup.ts`

- [ ] **Step 1: Update `compileStandup` to include excused users**

Add imports to `src/services/compiler.ts`:

```typescript
import { getExcusedUsersWithReasons } from './excuses.js';
import { buildExcusedSection } from '../utils/formatting.js';
```

In `compileStandup`, after computing `missedUsers`, add:

```typescript
    // Get excused users
    const excusedData = await getExcusedUsersWithReasons(standup.workspaceId, standup.date);
    const excusedUserIds = new Set(excusedData.map((e) => e.userId));

    // Filter excused users out of missed list
    const actualMissedUsers = missedUsers.filter((u) => !excusedUserIds.has(u.userId));

    // Get names for excused users
    const excusedUsers = await Promise.all(
      excusedData.map(async (e) => {
        try {
          const userInfo = await getUserInfo(client, e.userId);
          return {
            userId: e.userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
            reason: e.reason,
          };
        } catch (error) {
          logger.error({ error, userId: e.userId }, 'Failed to get excused user info');
          return { userId: e.userId, userName: 'Unknown', reason: e.reason };
        }
      })
    );
```

Update the `buildCompleteStandupBlocks` call to use `actualMissedUsers` instead of `missedUsers`. Then add excused section after the blocks are built:

Replace the block-building section. Since `buildCompleteStandupBlocks` doesn't have an excused param, insert excused blocks manually:

```typescript
    const blocks = buildCompleteStandupBlocks(
      standup.date,
      standup.workspace.timezone,
      entryData,
      actualMissedUsers,
      deadlineText
    );

    // Insert excused section before missed section (at the end, before missed)
    if (excusedUsers.length > 0) {
      const excusedBlocks = buildExcusedSection(excusedUsers);
      // Insert before the missed section (last items) or at the end
      const missedIndex = blocks.findIndex(
        (b) => 'text' in b && 'text' in (b as any).text && (b as any).text.text?.startsWith('*Missed:*')
      );
      if (missedIndex >= 0) {
        blocks.splice(missedIndex, 0, ...excusedBlocks);
      } else {
        blocks.push(...excusedBlocks);
      }
    }
```

- [ ] **Step 2: Update `recompileStandup` to include excused users**

In `recompileStandup`, after computing `missedUsers`, add the same excused logic:

```typescript
    const excusedData = await getExcusedUsersWithReasons(standup.workspaceId, standup.date);
    const excusedUserIds = new Set(excusedData.map((e) => e.userId));
    const actualMissedUsers = missedUsers.filter((u) => !excusedUserIds.has(u.userId));

    const excusedUsers = await Promise.all(
      excusedData.map(async (e) => {
        try {
          const userInfo = await getUserInfo(client, e.userId);
          return {
            userId: e.userId,
            userName: userInfo?.real_name || userInfo?.name || 'Unknown',
            reason: e.reason,
          };
        } catch (error) {
          logger.error({ error, userId: e.userId }, 'Failed to get excused user info');
          return { userId: e.userId, userName: 'Unknown', reason: e.reason };
        }
      })
    );
```

Use `actualMissedUsers` in `buildCompleteStandupBlocksGrouped`. Add excused section the same way.

- [ ] **Step 3: Add auto-recompile on late submission**

In `src/modals/collect-standup.ts`, in `handleStandupSubmission`, after the confirmation DM is sent, add:

```typescript
    // Auto-recompile if this was a late submission and standup is already compiled
    if (status === SUBMISSION_STATUS.LATE && standup?.compiledAt) {
      const workspace = standup.workspace;
      if (workspace) {
        void recompileStandup(client, workspace.teamId, standup.date).catch((err) => {
          logger.error({ error: err, standupId }, 'Auto-recompile failed after late submission');
        });
      }
    }
```

Add the import:

```typescript
import { recompileStandup } from '../services/compiler.js';
```

Update the `standup` query to include `workspace` and `compiledAt`:

```typescript
    const standup = await prisma.standup.findUnique({
      where: { id: standupId },
      include: { workspace: true },
    });
```

Note: the existing query already does `include: { workspace: true }`. Just need to add the `recompileStandup` import and the auto-recompile block. But `recompileStandup` uses `workspaceId`, not `teamId` — check the signature. It uses `workspaceId` in the Prisma query via `workspaceId_date`. But the parameter name in the function is `workspaceId` and it queries `prisma.standup.findUnique({ where: { workspaceId_date: { workspaceId, date } } })`. The `workspace` object has both `id` and `teamId`. The `standup` object has `workspaceId` which is the workspace's `id`. So use `standup.workspaceId`:

```typescript
    if (status === SUBMISSION_STATUS.LATE && standup?.compiledAt) {
      void recompileStandup(client, standup.workspaceId, standup.date).catch((err) => {
        logger.error({ error: err, standupId }, 'Auto-recompile failed after late submission');
      });
    }
```

- [ ] **Step 4: Verify typecheck**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/compiler.ts src/modals/collect-standup.ts
git commit -m "feat: add excused section to compilation, auto-recompile on late submission"
```

---

### Task 10: `/standup me` Hub Command

**Files:**
- Create: `src/commands/standup-me.ts`

- [ ] **Step 1: Create the hub command with subcommand routing**

Create `src/commands/standup-me.ts`:

```typescript
import { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { buildMeHubBlocks, buildRemindersModal, buildExcuseModal } from '../utils/formatting.js';
import { resolveReminderConfig } from '../services/preferences.js';
import { createExcuse, parseDateArg, getActiveExcuses, getMemberIdByUserId } from '../services/excuses.js';
import { parseReminderOffsets } from '../utils/date.js';
import { openModal } from '../services/slack.js';

export async function handleStandupMe({
  command,
  ack,
  respond,
  client,
}: SlackCommandMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    await ack();

    const workspace = await prisma.workspace.findUnique({
      where: { teamId: command.team_id },
    });

    if (!workspace) {
      await respond({
        text: '❌ Workspace not configured. Please run `/standup init` first.',
        response_type: 'ephemeral',
      });
      return;
    }

    const args = command.text.replace(/^me\s*/, '').trim();
    const subcommand = args.split(' ')[0] || '';

    switch (subcommand) {
      case 'reminders':
        await handleRemindersModal(command, client, workspace);
        break;
      case 'excuse':
        await handleExcuseSubcommand(command, respond, client, workspace, args);
        break;
      case '':
        await handleHub(command, respond, workspace);
        break;
      default:
        await respond({
          text: '❌ Unknown subcommand. Use `/standup me`, `/standup me reminders`, or `/standup me excuse`.',
          response_type: 'ephemeral',
        });
    }
  } catch (error) {
    logger.error({ error, userId: command.user_id }, 'Failed to handle standup me');
    await respond({
      text: '❌ Something went wrong. Please try again.',
      response_type: 'ephemeral',
    });
  }
}

async function handleHub(
  command: SlackCommandMiddlewareArgs['command'],
  respond: SlackCommandMiddlewareArgs['respond'],
  workspace: { id: string; remindersEnabled: boolean; reminderOffsets: string; timezone: string }
): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: command.user_id } },
    include: { preference: true },
  });

  const config = resolveReminderConfig(workspace, member?.preference ?? null);
  const offsetsLabel = config.offsets.length > 0 ? config.offsets.join(', ') + ' min' : 'None';

  const remindersLabel = member?.preference?.remindersEnabled === null
    ? `Using workspace default (${config.enabled ? 'On' : 'Off'})`
    : config.enabled ? 'On' : 'Off';

  const memberId = member?.id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: workspace.timezone }).format(new Date());
  const excuses = memberId ? await getActiveExcuses(memberId, today) : [];
  const excusesLabel = excuses.length > 0
    ? excuses.map((e) => `${e.startDate}${e.startDate !== e.endDate ? ` – ${e.endDate}` : ''}${e.reason ? ` (${e.reason})` : ''}`).join(', ')
    : 'No upcoming excuses';

  const blocks = buildMeHubBlocks({ remindersLabel, offsetsLabel, excusesLabel });

  await respond({
    blocks,
    text: 'Your Stand-up Preferences',
    response_type: 'ephemeral',
  });
}

async function handleRemindersModal(
  command: SlackCommandMiddlewareArgs['command'],
  client: SlackCommandMiddlewareArgs['client'],
  workspace: { id: string; reminderOffsets: string }
): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: command.user_id } },
    include: { preference: true },
  });

  const modal = buildRemindersModal({
    remindersEnabled: member?.preference?.remindersEnabled ?? null,
    reminderOffsets: member?.preference?.reminderOffsets ?? null,
    workspaceDefault: workspace.reminderOffsets,
  });

  await openModal(client, command.trigger_id, modal);
}

async function handleExcuseSubcommand(
  command: SlackCommandMiddlewareArgs['command'],
  respond: SlackCommandMiddlewareArgs['respond'],
  client: SlackCommandMiddlewareArgs['client'],
  workspace: { id: string; timezone: string },
  args: string
): Promise<void> {
  const parts = args.replace(/^excuse\s*/, '').trim().split(/\s+/);
  const firstArg = parts[0] || '';

  // No args → open modal
  if (!firstArg) {
    const modal = buildExcuseModal();
    await openModal(client, command.trigger_id, modal);
    return;
  }

  // Cancel → show active excuses
  if (firstArg === 'cancel') {
    const memberId = await getMemberIdByUserId(workspace.id, command.user_id);
    if (!memberId) {
      await respond({ text: '❌ You are not a member of this workspace. Run `/standup optin` first.', response_type: 'ephemeral' });
      return;
    }

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: workspace.timezone }).format(new Date());
    const excuses = await getActiveExcuses(memberId, today);

    if (excuses.length === 0) {
      await respond({ text: 'No active or upcoming excuses to cancel.', response_type: 'ephemeral' });
      return;
    }

    await respond({
      text: 'Your active excuses:',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*Your Active Excuses:*',
          },
        },
        ...excuses.map((e) => ({
          type: 'section' as const,
          text: {
            type: 'mrkdwn' as const,
            text: `${e.startDate}${e.startDate !== e.endDate ? ` – ${e.endDate}` : ''}${e.reason ? ` (${e.reason})` : ''}`,
          },
          accessory: {
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: 'Cancel' },
            action_id: `cancel_excuse_${e.id}`,
            value: e.id,
            style: 'danger' as const,
          },
        })),
      ],
      response_type: 'ephemeral',
    });
    return;
  }

  // Quick excuse: today, tomorrow, or date range
  const startDate = parseDateArg(firstArg, workspace.timezone);
  if (!startDate) {
    await respond({
      text: '❌ Invalid date. Use `today`, `tomorrow`, or `YYYY-MM-DD`.',
      response_type: 'ephemeral',
    });
    return;
  }

  const secondArg = parts[1];
  const endDate = secondArg ? parseDateArg(secondArg, workspace.timezone) : startDate;
  if (!endDate) {
    await respond({
      text: '❌ Invalid end date. Use `YYYY-MM-DD` format.',
      response_type: 'ephemeral',
    });
    return;
  }

  if (endDate < startDate) {
    await respond({
      text: '❌ End date must be on or after start date.',
      response_type: 'ephemeral',
    });
    return;
  }

  const memberId = await getMemberIdByUserId(workspace.id, command.user_id);
  if (!memberId) {
    await respond({
      text: '❌ You are not a member of this workspace. Run `/standup optin` first.',
      response_type: 'ephemeral',
    });
    return;
  }

  await createExcuse(memberId, startDate, endDate);
  const rangeText = startDate === endDate ? startDate : `${startDate} – ${endDate}`;
  await respond({
    text: `✅ You're excused for ${rangeText}. You won't receive standup prompts during this period.`,
    response_type: 'ephemeral',
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/standup-me.ts
git commit -m "feat: add /standup me hub with reminders and excuse subcommands"
```

---

### Task 11: Modal Handlers — Reminders and Excuse Submissions

**Files:**
- Create: `src/modals/me-reminders.ts`
- Create: `src/modals/me-excuse.ts`

- [ ] **Step 1: Create reminders modal handler**

Create `src/modals/me-reminders.ts`:

```typescript
import { AllMiddlewareArgs, SlackViewMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { upsertMemberPreference } from '../services/preferences.js';
import { validateReminderOffsets, parseReminderOffsets, formatOffsets } from '../utils/date.js';

export async function handleRemindersSubmission({
  ack,
  view,
  body,
}: SlackViewMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    const values = view.state.values;
    const enabledValue = values.reminders_enabled_block.reminders_enabled_select.selected_option?.value;
    const offsetsInput = values.reminder_offsets_block?.reminder_offsets_input?.value || '';

    // Validate offsets if provided
    if (offsetsInput.trim()) {
      const error = validateReminderOffsets(offsetsInput);
      if (error) {
        await ack({
          response_action: 'errors',
          errors: { reminder_offsets_block: error },
        });
        return;
      }
    }

    await ack();

    const userId = 'user' in body ? body.user.id : '';
    const teamId = ('team' in body ? body.team?.id : undefined) || ('user' in body ? body.user.team_id : '');

    if (!userId || !teamId) {
      logger.error({ body }, 'Missing user or team ID');
      return;
    }

    const member = await prisma.member.findFirst({
      where: {
        userId,
        workspace: { teamId },
      },
    });

    if (!member) {
      logger.error({ userId, teamId }, 'Member not found for preference update');
      return;
    }

    const remindersEnabled =
      enabledValue === 'default' ? null : enabledValue === 'on';
    const reminderOffsets = offsetsInput.trim()
      ? formatOffsets(parseReminderOffsets(offsetsInput))
      : null;

    await upsertMemberPreference(member.id, { remindersEnabled, reminderOffsets });

    logger.info({ userId, memberId: member.id }, 'Reminder preferences saved');
  } catch (error) {
    logger.error({ error }, 'Failed to handle reminders submission');
    await ack({
      response_action: 'errors',
      errors: { reminders_enabled_block: 'Failed to save preferences. Please try again.' },
    });
  }
}
```

- [ ] **Step 2: Create excuse modal handler**

Create `src/modals/me-excuse.ts`:

```typescript
import { AllMiddlewareArgs, SlackViewMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { createExcuse } from '../services/excuses.js';

export async function handleExcuseSubmission({
  ack,
  view,
  body,
}: SlackViewMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
  try {
    const values = view.state.values;
    const startDate = values.start_date_block.start_date_picker.selected_date as string;
    const endDate = values.end_date_block.end_date_picker.selected_date as string;
    const reason = values.reason_block?.reason_input?.value || undefined;

    if (endDate < startDate) {
      await ack({
        response_action: 'errors',
        errors: { end_date_block: 'End date must be on or after start date' },
      });
      return;
    }

    await ack();

    const userId = 'user' in body ? body.user.id : '';
    const teamId = ('team' in body ? body.team?.id : undefined) || ('user' in body ? body.user.team_id : '');

    if (!userId || !teamId) {
      logger.error({ body }, 'Missing user or team ID');
      return;
    }

    const member = await prisma.member.findFirst({
      where: {
        userId,
        workspace: { teamId },
      },
    });

    if (!member) {
      logger.error({ userId, teamId }, 'Member not found for excuse creation');
      return;
    }

    await createExcuse(member.id, startDate, endDate, reason);

    logger.info({ userId, memberId: member.id, startDate, endDate }, 'Excuse created via modal');
  } catch (error) {
    logger.error({ error }, 'Failed to handle excuse submission');
    await ack({
      response_action: 'errors',
      errors: { start_date_block: 'Failed to save absence. Please try again.' },
    });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modals/me-reminders.ts src/modals/me-excuse.ts
git commit -m "feat: add modal handlers for reminder preferences and excuse creation"
```

---

### Task 12: Weekly Summary Service and Command

**Files:**
- Create: `src/services/weekly-summary.ts`
- Create: `src/commands/standup-weekly.ts`
- Create: `tests/services/weekly-summary.test.ts`

- [ ] **Step 1: Write tests for weekly date range calculation**

Create `tests/services/weekly-summary.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getWeekDateRange } from '../../src/services/weekly-summary.js';

describe('getWeekDateRange', () => {
  it('returns Monday–Friday for a Wednesday', () => {
    // 2026-03-25 is a Wednesday
    const { start, end } = getWeekDateRange('2026-03-25');
    expect(start).toBe('2026-03-23'); // Monday
    expect(end).toBe('2026-03-27'); // Friday
  });

  it('returns Monday–Friday for a Monday', () => {
    const { start, end } = getWeekDateRange('2026-03-23');
    expect(start).toBe('2026-03-23');
    expect(end).toBe('2026-03-27');
  });

  it('returns Monday–Friday for a Friday', () => {
    const { start, end } = getWeekDateRange('2026-03-27');
    expect(start).toBe('2026-03-23');
    expect(end).toBe('2026-03-27');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/services/weekly-summary.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement weekly summary service**

Create `src/services/weekly-summary.ts`:

```typescript
import { prisma } from '../db/prismaClient.js';
import { logger } from '../utils/logger.js';
import { SummarizerProvider } from './summarizer/provider.js';

export function getWeekDateRange(todayDate: string): { start: string; end: string } {
  const date = new Date(todayDate + 'T12:00:00Z');
  const dayOfWeek = date.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Calculate Monday of this week
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() + mondayOffset);

  // Friday is Monday + 4
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  const format = (d: Date) => d.toISOString().split('T')[0];
  return { start: format(monday), end: format(friday) };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function getDayName(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00Z');
  return DAY_NAMES[date.getUTCDay()];
}

export async function getUserWeeklyEntries(
  userId: string,
  workspaceId: string,
  todayDate: string
): Promise<Array<{
  date: string;
  dayName: string;
  yesterday: string;
  today: string;
  blockers?: string;
}>> {
  const { start, end } = getWeekDateRange(todayDate);

  const entries = await prisma.entry.findMany({
    where: {
      userId,
      standup: {
        workspaceId,
        date: { gte: start, lte: end },
      },
    },
    include: {
      standup: { select: { date: true } },
    },
    orderBy: {
      standup: { date: 'asc' },
    },
  });

  return entries.map((e) => ({
    date: e.standup.date,
    dayName: getDayName(e.standup.date),
    yesterday: e.yesterday,
    today: e.today,
    blockers: e.blockers || undefined,
  }));
}

export async function generatePersonalWeeklySummary(
  entries: Array<{ date: string; dayName: string; yesterday: string; today: string; blockers?: string }>,
  summarizer: SummarizerProvider
): Promise<string> {
  const formatted = entries
    .map(
      (e) =>
        `${e.dayName} (${e.date}):\n` +
        `Yesterday: ${e.yesterday}\n` +
        `Today: ${e.today}` +
        (e.blockers ? `\nBlockers: ${e.blockers}` : '')
    )
    .join('\n\n');

  const result = await summarizer.generateSummary([
    {
      userId: 'Weekly entries',
      yesterday: formatted,
      today: 'Summarize this person\'s week based on their daily standup entries. Focus on: accomplishments, ongoing work, blockers encountered, and trajectory. Keep it concise (3-5 bullet points).',
    },
  ]);

  return result.highlights || 'Unable to generate summary.';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm vitest run tests/services/weekly-summary.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Create weekly command handler**

Create `src/commands/standup-weekly.ts`:

```typescript
import { SlackCommandMiddlewareArgs, AllMiddlewareArgs } from '@slack/bolt';
import { logger } from '../utils/logger.js';
import { prisma } from '../db/prismaClient.js';
import { getTodayDate } from '../utils/date.js';
import { getUserWeeklyEntries, generatePersonalWeeklySummary, getWeekDateRange } from '../services/weekly-summary.js';
import { buildWeeklySummaryBlocks } from '../utils/formatting.js';
import { SummarizerProvider } from '../services/summarizer/provider.js';

export function createStandupWeeklyHandler(summarizer: SummarizerProvider | null) {
  return async function handleStandupWeekly({
    command,
    ack,
    respond,
  }: SlackCommandMiddlewareArgs & AllMiddlewareArgs): Promise<void> {
    try {
      await ack();

      const workspace = await prisma.workspace.findUnique({
        where: { teamId: command.team_id },
      });

      if (!workspace) {
        await respond({
          text: '❌ Workspace not configured. Please run `/standup init` first.',
          response_type: 'ephemeral',
        });
        return;
      }

      const today = getTodayDate(workspace.timezone);
      const { start, end } = getWeekDateRange(today);
      const entries = await getUserWeeklyEntries(command.user_id, workspace.id, today);

      let aiSummary: string | undefined;
      if (summarizer && entries.length > 0) {
        try {
          aiSummary = await generatePersonalWeeklySummary(entries, summarizer);
        } catch (error) {
          logger.error({ error }, 'Failed to generate weekly AI summary');
        }
      }

      const dateRange = `${start} – ${end}`;
      const blocks = buildWeeklySummaryBlocks(dateRange, entries, aiSummary);

      await respond({
        blocks,
        text: `Your Week (${dateRange})`,
        response_type: 'ephemeral',
      });

      logger.info({ userId: command.user_id, entryCount: entries.length }, 'Weekly summary generated');
    } catch (error) {
      logger.error({ error, userId: command.user_id }, 'Failed to generate weekly summary');
      await respond({
        text: '❌ Failed to generate weekly summary. Please try again.',
        response_type: 'ephemeral',
      });
    }
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/services/weekly-summary.ts src/commands/standup-weekly.ts tests/services/weekly-summary.test.ts
git commit -m "feat: add personal weekly summary service and command"
```

---

### Task 13: Register Everything in App + Cancel Excuse Action

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Add imports and register new handlers**

Add to imports in `src/app.ts`:

```typescript
import { handleStandupMe } from './commands/standup-me.js';
import { createStandupWeeklyHandler } from './commands/standup-weekly.js';
import { handleRemindersSubmission } from './modals/me-reminders.js';
import { handleExcuseSubmission } from './modals/me-excuse.js';
import { buildRemindersModal, buildExcuseModal } from './utils/formatting.js';
import { deleteExcuse } from './services/excuses.js';
import { openModal } from './services/slack.js';
```

- [ ] **Step 2: Update the `/standup` command router**

Add cases to the switch statement in the `/standup` command handler:

```typescript
      case 'me':
        // Forward to me handler with full command context
        await handleStandupMe({ command, ack: async () => {}, respond, client, say: respond as any, context: {} as any, body: {} as any, payload: command, logger: undefined as any, next: async () => {} });
        break;
      case 'weekly':
        await createStandupWeeklyHandler(summarizer)({ command, ack: async () => {}, respond, client, say: respond as any, context: {} as any, body: {} as any, payload: command, logger: undefined as any, next: async () => {} });
        break;
```

Actually, this is messy. Better approach: register dedicated commands and route from the switch:

Instead, register `handleStandupMe` and the weekly handler as separate `/standup-me` and `/standup-weekly` commands, and add routing in the `/standup` switch:

```typescript
      case 'me':
        // Re-dispatch to standup-me handler
        break;
      case 'weekly':
        break;
```

The cleaner approach is to handle `me` and `weekly` subcommands inline in the switch, since they need the command context. Let's just call the handler functions directly. But they need the full middleware args.

The simplest approach: register `/standup-me` and `/standup-weekly` as separate Slack commands (they already follow the pattern), and in the `/standup` switch, tell users to use the full command:

Actually, looking at the existing pattern — the `/standup` switch doesn't call handlers, it just shows help. The actual handlers are on `/standup-init`, `/standup-today`, etc. Follow the same pattern:

```typescript
  app.command('/standup-me', handleStandupMe);
  app.command('/standup-weekly', createStandupWeeklyHandler(summarizer));
```

And update the help text in the `/standup` switch:

```typescript
        await respond({
          text:
            '📋 *Stand-up Bot Commands*\n\n' +
            '• `/standup init` - Set up stand-ups\n' +
            '• `/standup today` - Run stand-up now\n' +
            '• `/standup summary` - Generate summary\n' +
            '• `/standup recompile` - Update message with late submissions\n' +
            '• `/standup config` - Update config\n' +
            '• `/standup optin` - Opt in\n' +
            '• `/standup optout` - Opt out\n' +
            '• `/standup status` - View status\n' +
            '• `/standup me` - Your preferences (reminders, excuses)\n' +
            '• `/standup weekly` - Your personal weekly summary',
          response_type: 'ephemeral',
        });
```

- [ ] **Step 3: Register modal view handlers**

```typescript
  app.view('standup_me_reminders_modal', handleRemindersSubmission);
  app.view('standup_me_excuse_modal', handleExcuseSubmission);
```

- [ ] **Step 4: Register action handlers for hub buttons and cancel excuse**

```typescript
  // Hub action buttons
  app.action('open_reminders_modal', async ({ ack, body, client }) => {
    await ack();
    if (!('trigger_id' in body)) return;
    // Open with defaults — the modal will be populated when the user accesses via /standup me reminders
    const modal = buildRemindersModal();
    await openModal(client, body.trigger_id, modal);
  });

  app.action('open_excuse_modal', async ({ ack, body, client }) => {
    await ack();
    if (!('trigger_id' in body)) return;
    const modal = buildExcuseModal();
    await openModal(client, body.trigger_id, modal);
  });

  // Cancel excuse action (dynamic action_id)
  app.action(/^cancel_excuse_/, async ({ ack, action, respond }) => {
    await ack();
    const excuseId = 'value' in action ? (action.value as string) : '';
    if (excuseId) {
      try {
        await deleteExcuse(excuseId);
        await respond({ text: '✅ Excuse cancelled.', response_type: 'ephemeral', replace_original: false });
      } catch (error) {
        logger.error({ error, excuseId }, 'Failed to cancel excuse');
        await respond({ text: '❌ Failed to cancel excuse.', response_type: 'ephemeral', replace_original: false });
      }
    }
  });
```

- [ ] **Step 5: Update `createSetupConfigHandler` call (remove collectionWindowMin param)**

```typescript
  app.view(
    'standup_config_modal',
    createSetupConfigHandler(client, summarizer)
  );
```

And update `createStandupTodayHandler` call:

```typescript
  app.command('/standup-today', createStandupTodayHandler(summarizer));
```

- [ ] **Step 6: Verify typecheck**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm typecheck`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/app.ts
git commit -m "feat: register new commands, modals, and actions in app"
```

---

### Task 14: Update `/standup-today` Handler

**Files:**
- Modify: `src/commands/standup-today.ts`

- [ ] **Step 1: Read current file and update to read window from workspace**

Update `createStandupTodayHandler` to remove the `collectionWindowMin` parameter and read it from the workspace:

```typescript
export function createStandupTodayHandler(
  summarizer: SummarizerProvider | null
) {
```

Inside the handler, after finding the workspace:

```typescript
    const collectionWindowMin = workspace.collectionWindowMin;
```

Use this value when calling `createStandup`.

- [ ] **Step 2: Read the file**

Read `src/commands/standup-today.ts` to make the exact edit.

- [ ] **Step 3: Verify typecheck**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/standup-today.ts
git commit -m "feat: standup-today reads collection window from workspace config"
```

---

### Task 15: Run Full Test Suite + Typecheck

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm typecheck`
Expected: No errors.

- [ ] **Step 2: Run all tests**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Run lint**

Run: `cd /Users/renatobeltrao/Projects/sup && pnpm lint`
Expected: No errors (or only pre-existing ones).

- [ ] **Step 4: Fix any issues found**

If any tests, type errors, or lint errors are found, fix them.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve typecheck and lint issues from advanced config feature"
```

---

### Task 16: Update Slack App Manifest

**Files:**
- Modify: `docs/manifest.yaml` (if it exists and needs new slash commands)

- [ ] **Step 1: Check if manifest needs updating**

Read `docs/manifest.yaml` to see if `/standup-me` and `/standup-weekly` need to be added as slash commands.

- [ ] **Step 2: Add new slash commands to manifest**

Add entries for `/standup-me` and `/standup-weekly` following the existing pattern.

- [ ] **Step 3: Commit**

```bash
git add docs/manifest.yaml
git commit -m "feat: add new slash commands to Slack app manifest"
```
