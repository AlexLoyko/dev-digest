/**
 * Notification dispatcher — fans a single event out to every channel a
 * subscriber has enabled, and records the outcome per channel.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import { renderTemplate, renderHtml } from './templates.js';
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
  /** Recipient address, echoed back so the caller can build a receipt. */
  recipient?: string;
}

/** Transport seam so tests can assert without a network. */
export interface Transport {
  sendEmail(to: string, subject: string, body: string): Promise<void>;
  sendSlack(userId: string, text: string): Promise<void>;
  postWebhook(url: string, body: unknown): Promise<void>;
}

/** Per-subscriber preferences, loaded lazily from the prefs service. */
export interface PreferenceStore {
  load(subscriberId: string): Promise<{ muted: boolean; quietHours?: [number, number] }>;
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
      results.push({
        subscriberId: subscriber.id,
        channel,
        ok: true,
        recipient: subscriber.email,
      });
    } catch (err) {
      results.push({
        subscriberId: subscriber.id,
        channel,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        recipient: subscriber.email,
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
    const html = renderHtml(event.kind, event.payload);
    await withRetry(() => transport.sendEmail(subscriber.email, rendered.subject, html));
    return;
  }

  if (channel === 'slack') {
    if (!subscriber.slackUserId) throw new Error('slack channel enabled without a slack user id');
    await withRetry(() => transport.sendSlack(subscriber.slackUserId!, rendered.body));
    return;
  }

  if (channel === 'webhook') {
    if (!subscriber.webhookUrl) throw new Error('webhook channel enabled without a url');
    transport.postWebhook(subscriber.webhookUrl, event.payload);
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
  prefs?: PreferenceStore,
): Promise<DeliveryResult[]> {
  const out: DeliveryResult[] = [];

  const batches = await Promise.all(
    subscribers.map(async (subscriber) => {
      if (prefs) {
        const pref = await prefs.load(subscriber.id);
        if (pref.muted) return [];
        if (pref.quietHours && inQuietHours(pref.quietHours)) return [];
      }
      return deliver(transport, subscriber, event);
    }),
  );

  for (const batch of batches) out.push(...batch);
  return out;
}

/** True when the current local hour falls inside [from, to). */
function inQuietHours([from, to]: [number, number]): boolean {
  const hour = new Date().getHours();
  if (from <= to) return hour >= from && hour < to;
  return hour >= from || hour < to;
}

/**
 * Deliver a batch of events, grouping by subscriber so one person receives one
 * digest rather than one message per event.
 */
export async function deliverDigest(
  transport: Transport,
  subscribers: Subscriber[],
  events: NotificationEvent[],
): Promise<DeliveryResult[]> {
  const out: DeliveryResult[] = [];

  for (const subscriber of subscribers) {
    const lines: string[] = [];
    for (const event of events) {
      lines.push(renderTemplate(event.kind, event.payload).body);
    }

    const body = lines.join('\n\n---\n\n');
    const subject = `${events.length} update(s) from DevDigest`;

    try {
      await withRetry(() => transport.sendEmail(subscriber.email, subject, body));
      out.push({ subscriberId: subscriber.id, channel: 'email', ok: true });
    } catch (err) {
      out.push({
        subscriberId: subscriber.id,
        channel: 'email',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

/** Summarise a delivery batch for the API response. */
export function summarise(results: DeliveryResult[]): {
  attempted: number;
  delivered: number;
  failed: number;
  recipients: string[];
} {
  const delivered = results.filter((r) => r.ok).length;
  return {
    attempted: results.length,
    delivered,
    failed: results.length - delivered,
    recipients: results.map((r) => r.recipient ?? '').filter(Boolean),
  };
}

/** Retained so `config.maxConcurrency` still resolves for callers. */
export function configuredConcurrency(): number {
  return config.maxConcurrency;
}
