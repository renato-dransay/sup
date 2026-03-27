# Advanced Configuration: Response Window, Excuses, Reminders, Weekly Summary

**Date:** 2026-03-27
**Status:** Draft

## Summary

Extend the standup bot with per-workspace response window configuration, user absence/excuse management, configurable reminders with per-user overrides, auto-recompilation for late answers, and an on-demand personal weekly summary.

## Decisions from User

| Feature | Decision |
|---------|----------|
| Late answers | Always accepted, auto-recompile — no toggle needed |
| Response window | Per-workspace, configurable via `/standup config` modal |
| Excuses | Skip DM + show as "excused" in compiled standup |
| Reminder toggle | Both: workspace default + per-user override |
| Reminder offsets | Both: workspace default + per-user override |
| Weekly summary | Personal only, on-demand via command |
| User settings UX | Hub-and-spoke: `/standup me` shows hub, `/standup me reminders` and `/standup me excuse` jump directly to modals |

---

## 1. Data Model Changes

### 1.1 Workspace (add fields)

```prisma
model Workspace {
  // ... existing fields ...
  collectionWindowMin Int     @default(45)     // Response window in minutes (10-120)
  remindersEnabled    Boolean @default(true)    // Workspace-level reminder toggle
  reminderOffsets     String  @default("15,5")  // Comma-separated minutes before deadline
}
```

- `collectionWindowMin` replaces the env-var-only approach. The env var `COLLECTION_WINDOW_MIN` becomes the default for new workspaces only.
- `reminderOffsets` stored as comma-separated string, parsed to `number[]` at runtime. Max 5 values, each 1-60.

### 1.2 MemberPreference (new model)

```prisma
model MemberPreference {
  id               String   @id @default(uuid())
  memberId         String   @unique
  remindersEnabled Boolean?  // null = inherit workspace default
  reminderOffsets  String?   // null = inherit workspace default
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  member Member @relation(fields: [memberId], references: [id], onDelete: Cascade)
}
```

Resolution logic: if `MemberPreference.remindersEnabled` is `null`, use `Workspace.remindersEnabled`. Same for `reminderOffsets`. This is a simple null-coalesce pattern.

### 1.3 Excuse (new model)

```prisma
model Excuse {
  id        String   @id @default(uuid())
  memberId  String
  startDate String   // YYYY-MM-DD
  endDate   String   // YYYY-MM-DD (same as startDate for single day)
  reason    String?
  createdAt DateTime @default(now())

  member Member @relation(fields: [memberId], references: [id], onDelete: Cascade)

  @@index([memberId, startDate, endDate])
}
```

### 1.4 Member (add relations)

```prisma
model Member {
  // ... existing fields ...
  preference MemberPreference?
  excuses    Excuse[]
}
```

---

## 2. Workspace Config Modal Changes

### `/standup config` modal — new fields

Add to the existing modal:

1. **Response Window** — plain text input, number in minutes. Placeholder: `45`. Validated: integer 10-120.
2. **Reminders Enabled** — checkbox. Defaults to checked.
3. **Reminder Offsets** — plain text input, comma-separated. Placeholder: `15,5`. Validated: each value 1-60, max 5 entries, sorted descending on save.

### Setup config handler changes

- Save `collectionWindowMin`, `remindersEnabled`, `reminderOffsets` to workspace.
- Pass `workspace.collectionWindowMin` to scheduler instead of `config.collectionWindowMin`.
- Reschedule compilation task based on new window.

### Scheduler changes

- `scheduleWorkspaceJob()` reads `collectionWindowMin` from workspace record instead of config param.
- `getReminderOffsets()` becomes `getWorkspaceReminderOffsets(workspaceId)` — reads from DB.
- `scheduleStandupReminders()` resolves per-user offsets: for each opted-in user, check `MemberPreference.reminderOffsets` ?? `Workspace.reminderOffsets`, and `MemberPreference.remindersEnabled` ?? `Workspace.remindersEnabled`.
- Reminder dispatches are seeded per-user with their resolved offsets (not a global set).

---

## 3. Excuse System

### Command: `/standup me excuse`

Parsing:
- `/standup me excuse` — opens a modal with date picker(s) and optional reason
- `/standup me excuse today` — creates excuse for today, no modal
- `/standup me excuse tomorrow` — creates excuse for tomorrow, no modal
- `/standup me excuse 2026-04-01 2026-04-05` — creates excuse for date range, no modal
- `/standup me excuse cancel` — shows list of active/future excuses with cancel buttons

### Excuse Modal

- **Start Date** — date picker, defaults to today
- **End Date** — date picker, defaults to start date
- **Reason** — optional plain text input (e.g., "Vacation", "Sick leave")

### Collection Flow Changes

When `collectFromUsers()` runs:
1. For each opted-in user, check if they have an active excuse for today's date.
2. Query: `Excuse WHERE memberId = X AND startDate <= today AND endDate >= today`
3. If excused: skip sending DM, skip seeding reminders for this user.

### Compilation Flow Changes

When `compileStandup()` runs:
1. Query excused users for today.
2. In the compiled message, add a new section after entries and before missed:
   - "🏖 Excused" section listing excused users (with reason if provided).
3. Excused users are **not** counted as "missed".

### Formatting

New function `buildExcusedSection()` in `formatting.ts`:
```
*🏖 Excused*
• UserName (Vacation)
• UserName2
```

---

## 4. Reminders Configuration

### Workspace Level

Handled via `/standup config` modal (Section 2 above).

### User Level

#### `/standup me reminders` — opens modal

Modal fields:
- **Reminders Enabled** — radio buttons: "Use workspace default", "On", "Off"
- **Reminder Times** — plain text input for comma-separated minutes. Placeholder shows workspace default. Helper text: "Leave empty to use workspace default."

#### Resolution Logic (utility function)

```typescript
function resolveReminderConfig(
  workspace: { remindersEnabled: boolean; reminderOffsets: string },
  preference: { remindersEnabled: boolean | null; reminderOffsets: string | null } | null
): { enabled: boolean; offsets: number[] } {
  const enabled = preference?.remindersEnabled ?? workspace.remindersEnabled;
  const offsetsStr = preference?.reminderOffsets ?? workspace.reminderOffsets;
  const offsets = parseOffsets(offsetsStr);
  return { enabled, offsets };
}
```

### Seeding Changes

`seedReminderDispatches()` becomes per-user aware:
- For each user, resolve their reminder config.
- If reminders disabled for user: skip seeding.
- If custom offsets: seed with user's offsets instead of workspace offsets.
- ReminderDispatch records are created per-user with their individual offset values.

### Timer Scheduling Changes

`scheduleStandupReminders()` changes:
- Collect all unique offset values across all users.
- For each unique offset, schedule one timer.
- `sendRemindersForOffset()` already filters by pending status, so it naturally handles per-user differences.

---

## 5. Auto-Recompile for Late Answers

### Behavior

When a user submits after the deadline:
1. Entry is saved with `submissionStatus: "late"` (existing behavior).
2. If the standup has already been compiled (`compiledAt` is set), automatically call `recompileStandup()`.
3. This replaces the need for manual `/standup recompile`.

### Implementation

In `saveEntry()` or in the modal submission handler (`handleStandupSubmission`):
- After saving a late entry, check if standup is already compiled.
- If yes, trigger `recompileStandup()` in the background (fire-and-forget with error logging).

### Excused users in recompile

`recompileStandup()` updated to:
1. Query excused users for the standup date.
2. Exclude excused users from "missed" list.
3. Add excused section to the grouped blocks.

---

## 6. `/standup me` Hub

### Command: `/standup me`

Sends an ephemeral message with the user's current settings and action buttons:

```
👤 *Your Stand-up Preferences*

*Reminders:* Using workspace default (On) | Offsets: 15, 5 min
*Excuses:* No upcoming excuses

[🔔 Reminders]  [🏖 Excuse]
```

Buttons:
- **Reminders** → opens reminders modal (`standup_me_reminders_modal`)
- **Excuse** → opens excuse modal (`standup_me_excuse_modal`)

### Subcommand routing

In the `/standup` command handler, add:
- `me` → show hub
- `me reminders` → open reminders modal directly
- `me excuse [args]` → parse excuse args or open modal

---

## 7. Weekly Summary

### Command: `/standup weekly`

Generates a personal weekly summary for the requesting user.

### Behavior

1. Fetch all entries by the requesting user for the current week (Monday–Friday, or last 5 weekdays if mid-week).
2. If no entries found, respond with "No standup entries found for this week."
3. If summarizer is available, send entries to AI with a personal-summary prompt.
4. If summarizer is not available, format a simple text recap of the user's entries.
5. Send result as an ephemeral message (only visible to the user).

### AI Prompt

```
Summarize this person's week based on their daily standup entries.
Focus on: accomplishments, ongoing work, blockers encountered, and trajectory.
Keep it concise (3-5 bullet points).
```

### Fallback (no AI)

Simple formatted list:
```
📅 *Your Week (Mar 24 – Mar 28)*

*Monday:*
Yesterday: ...
Today: ...

*Tuesday:*
...
```

---

## 8. Command Registration Summary

### New Slash Commands (Slack app manifest)

No new top-level slash commands needed. Everything routes through existing `/standup` with subcommands:

| Subcommand | Action |
|------------|--------|
| `me` | Show personal settings hub |
| `me reminders` | Open reminders preference modal |
| `me excuse` | Open excuse modal |
| `me excuse today` | Quick-excuse for today |
| `me excuse tomorrow` | Quick-excuse for tomorrow |
| `me excuse YYYY-MM-DD YYYY-MM-DD` | Excuse for date range |
| `me excuse cancel` | Show active excuses with cancel buttons |
| `weekly` | Generate personal weekly summary |

### New Modal Callback IDs

| Callback ID | Handler |
|-------------|---------|
| `standup_me_reminders_modal` | Save reminder preferences |
| `standup_me_excuse_modal` | Save excuse |

### New Action IDs

| Action ID | Handler |
|-----------|---------|
| `open_reminders_modal` | Open reminders modal from hub |
| `open_excuse_modal` | Open excuse modal from hub |
| `cancel_excuse_{id}` | Cancel a specific excuse |

---

## 9. Files to Create/Modify

### New Files
- `src/commands/standup-me.ts` — Hub command + subcommand routing
- `src/commands/standup-weekly.ts` — Weekly summary command
- `src/modals/me-reminders.ts` — Reminders preference modal handler
- `src/modals/me-excuse.ts` — Excuse modal handler
- `src/services/excuses.ts` — Excuse CRUD + "is user excused today" query
- `src/services/preferences.ts` — Preference CRUD + resolution logic
- `src/services/weekly-summary.ts` — Weekly summary generation
- `prisma/migrations/XXXX_advanced_config/migration.sql` — Auto-generated

### Modified Files
- `prisma/schema.prisma` — Add new models and workspace fields
- `src/app.ts` — Register new commands, modals, actions
- `src/config.ts` — Keep env var as default, no longer pass to scheduler
- `src/utils/formatting.ts` — Add `buildConfigModal` new fields, `buildExcusedSection`, `buildMeHubMessage`, `buildRemindersModal`, `buildExcuseModal`, `buildWeeklySummaryBlocks`
- `src/modals/setup-config.ts` — Handle new config fields
- `src/services/scheduler.ts` — Read window/offsets from workspace, per-user reminder resolution
- `src/services/collector.ts` — Skip excused users in collection, per-user reminder seeding
- `src/services/compiler.ts` — Add excused section, auto-recompile on late submission
- `src/services/users.ts` — Add `getExcusedUsers(workspaceId, date)` helper or use excuses service
- `src/commands/standup-config.ts` — Pass new fields to modal builder
