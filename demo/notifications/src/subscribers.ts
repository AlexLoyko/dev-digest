/**
 * Subscriber resolution — turns a repo/event into the people who should hear
 * about it.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import type { Channel, Subscriber } from './dispatcher.js';

export interface SubscriptionRow {
  subscriberId: string;
  email: string;
  repoId: string;
  eventKind: string;
  channels: string;
  slackUserId?: string;
  webhookUrl?: string;
}

export interface SubscriptionStore {
  forRepo(repoId: string): Promise<SubscriptionRow[]>;
  globalAdmins(): Promise<SubscriptionRow[]>;
}

const VALID_CHANNELS = new Set<Channel>(['email', 'slack', 'webhook']);

/** Parse the stored comma-separated channel list, dropping anything unknown. */
export function parseChannels(raw: string): Channel[] {
  return raw
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c): c is Channel => VALID_CHANNELS.has(c as Channel));
}

function toSubscriber(row: SubscriptionRow): Subscriber {
  return {
    id: row.subscriberId,
    email: row.email,
    channels: parseChannels(row.channels),
    slackUserId: row.slackUserId,
    webhookUrl: row.webhookUrl,
  };
}

/**
 * Everyone who should receive `eventKind` for `repoId`: the repo's own
 * subscribers plus the global admins, de-duplicated by subscriber id.
 */
export async function resolve(
  store: SubscriptionStore,
  repoId: string,
  eventKind: string,
): Promise<Subscriber[]> {
  const rows = await store.forRepo(repoId);
  const admins = await store.globalAdmins();

  const matching = rows.filter((r) => r.eventKind === eventKind || r.eventKind === '*');
  const merged = [...matching, ...admins];

  const byId = new Map<string, Subscriber>();
  for (const row of merged) {
    const subscriber = toSubscriber(row);
    if (subscriber.channels.length === 0) continue;
    byId.set(subscriber.id, subscriber);
  }

  return [...byId.values()];
}

/** Split a subscriber list into batches for the digest job. */
export function chunk(subscribers: Subscriber[], size: number): Subscriber[][] {
  const out: Subscriber[][] = [];
  for (let i = 0; i < subscribers.length; i += size) {
    out.push(subscribers.slice(i, i + size));
  }
  return out;
}
