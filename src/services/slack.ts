import { WebClient } from '@slack/web-api';
import { logger } from '../utils/logger.js';

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 1000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const delay = INITIAL_DELAY_MS * Math.pow(2, i);

      // Check if it's a rate limit error
      if ((error as { data?: { error?: string } }).data?.error === 'rate_limited') {
        logger.warn({ attempt: i + 1, delay }, 'Rate limited, retrying...');
        await sleep(delay);
        continue;
      }

      // For other errors, don't retry if it's the last attempt
      if (i === retries - 1) break;

      logger.warn({ attempt: i + 1, error, delay }, 'Request failed, retrying...');
      await sleep(delay);
    }
  }

  throw lastError || new Error('Failed after retries');
}

export async function getUserInfo(client: WebClient, userId: string) {
  return retryWithBackoff(async () => {
    const result = await client.users.info({ user: userId });
    return result.user;
  });
}

export async function getChannelInfo(client: WebClient, channelId: string) {
  return retryWithBackoff(async () => {
    const result = await client.conversations.info({ channel: channelId });
    return result.channel;
  });
}

export async function postMessage(
  client: WebClient,
  channelId: string,
  blocks: unknown[],
  text?: string
) {
  return retryWithBackoff(async () => {
    return await client.chat.postMessage({
      channel: channelId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      blocks: blocks as any,
      text: text || 'Stand-up update',
    });
  });
}

export async function updateMessage(
  client: WebClient,
  channelId: string,
  messageTs: string,
  blocks: unknown[],
  text?: string
) {
  return retryWithBackoff(async () => {
    return await client.chat.update({
      channel: channelId,
      ts: messageTs,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      blocks: blocks as any,
      text: text || 'Stand-up update',
    });
  });
}

export async function postThreadReply(
  client: WebClient,
  channelId: string,
  threadTs: string,
  blocks: unknown[],
  text?: string
) {
  return retryWithBackoff(async () => {
    return await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      blocks: blocks as any,
      text: text || 'Thread reply',
    });
  });
}

export async function openModal(client: WebClient, triggerId: string, view: unknown) {
  return retryWithBackoff(async () => {
    return await client.views.open({
      trigger_id: triggerId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      view: view as any,
    });
  });
}

export async function openDMChannel(client: WebClient, userId: string): Promise<string> {
  return retryWithBackoff(async () => {
    const result = await client.conversations.open({
      users: userId,
    });
    return result.channel?.id as string;
  });
}

export async function getWorkspaceMembers(client: WebClient): Promise<string[]> {
  return retryWithBackoff(async () => {
    const result = await client.users.list({
      limit: 1000,
    });

    const members = result.members || [];
    return members
      .filter((member) => !member.is_bot && !member.deleted && member.id !== 'USLACKBOT')
      .map((member) => member.id as string);
  });
}
