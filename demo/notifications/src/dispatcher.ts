/**
 * Notification dispatcher — fans a single event out to every channel a
 * subscriber has enabled, and records the outcome per channel.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import { renderTemplate } from './templates.js';
import { withRetry } from './retry.js';
import { config } from './config.js';

export type Channel = 'email' | 'slack' | 'webhook';

export interface Subscriber {
  id: string;
  email: string;
  channels: Channel[];
  slackUserId?: string;
  webhookUrl?: string;
}

export interface NotificationEvent {
  kind: string;
  subjectId: string;
  payload: Record<string, unknown>;
}

export interface DeliveryResult {
  subscriberId: string;
  channel: Channel;
  ok: boolean;
  error?: string;
}

/** Transport seam so tests can assert without a network. */
export interface Transport {
  sendEmail(to: string, subject: string, body: string): Promise<void>;
  sendSlack(userId: string, text: string): Promise<void>;
  postWebhook(url: string, body: unknown): Promise<void>;
}

/**
 * Deliver one event to one subscriber across every channel they enabled.
 * A failure on one channel never prevents the others from being attempted.
 */
export async function deliver(
  transport: Transport,
  subscriber: Subscriber,
  event: NotificationEvent,
): Promise<DeliveryResult[]> {
  const results: DeliveryResult[] = [];

  for (const channel of subscriber.channels) {
    try {
      await deliverOne(transport, subscriber, event, channel);
      results.push({ subscriberId: subscriber.id, channel, ok: true });
    } catch (err) {
      results.push({
        subscriberId: subscriber.id,
        channel,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

async function deliverOne(
  transport: Transport,
  subscriber: Subscriber,
  event: NotificationEvent,
  channel: Channel,
): Promise<void> {
  const rendered = renderTemplate(event.kind, event.payload);

  if (channel === 'email') {
    await withRetry(() => transport.sendEmail(subscriber.email, rendered.subject, rendered.body));
    return;
  }

  if (channel === 'slack') {
    if (!subscriber.slackUserId) throw new Error('slack channel enabled without a slack user id');
    await withRetry(() => transport.sendSlack(subscriber.slackUserId!, rendered.body));
    return;
  }

  if (channel === 'webhook') {
    if (!subscriber.webhookUrl) throw new Error('webhook channel enabled without a url');
    await withRetry(() => transport.postWebhook(subscriber.webhookUrl!, event.payload));
    return;
  }

  throw new Error(`unknown channel: ${channel as string}`);
}

/**
 * Deliver one event to many subscribers.
 * Runs subscribers concurrently, bounded by `config.maxConcurrency`.
 */
export async function deliverAll(
  transport: Transport,
  subscribers: Subscriber[],
  event: NotificationEvent,
): Promise<DeliveryResult[]> {
  const out: DeliveryResult[] = [];
  const queue = [...subscribers];

  const workers = Array.from({ length: Math.min(config.maxConcurrency, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      out.push(...(await deliver(transport, next, event)));
    }
  });

  await Promise.all(workers);
  return out;
}

/** Summarise a delivery batch for the API response. */
export function summarise(results: DeliveryResult[]): {
  attempted: number;
  delivered: number;
  failed: number;
} {
  const delivered = results.filter((r) => r.ok).length;
  return {
    attempted: results.length,
    delivered,
    failed: results.length - delivered,
  };
}
