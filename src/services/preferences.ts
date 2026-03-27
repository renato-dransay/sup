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
