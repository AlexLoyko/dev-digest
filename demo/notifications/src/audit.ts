/**
 * Delivery audit log — records what was sent to whom, so a support request
 * ("I never got the email") has an answer.
 *
 * DEMO FIXTURE. Not wired into any package; see ../README.md.
 */
import type { DeliveryResult, NotificationEvent, Subscriber } from './dispatcher.js';
import { config } from './config.js';

export interface AuditEntry {
  at: string;
  subscriberId: string;
  email: string;
  channel: string;
  eventKind: string;
  ok: boolean;
  error?: string;
  payload: Record<string, unknown>;
}

export interface AuditSink {
  write(entries: AuditEntry[]): Promise<void>;
}

/** In-memory sink, kept for the lifetime of the process. */
export class MemoryAuditSink implements AuditSink {
  private entries: AuditEntry[] = [];

  async write(entries: AuditEntry[]): Promise<void> {
    this.entries.push(...entries);
  }

  all(): AuditEntry[] {
    return this.entries;
  }

  /** Everything recorded for one subscriber, newest first. */
  forSubscriber(subscriberId: string): AuditEntry[] {
    return this.entries.filter((e) => e.subscriberId === subscriberId).reverse();
  }

  clear(): void {
    this.entries = [];
  }
}

/**
 * Turn a delivery batch into audit entries. The event payload is stored whole
 * so support can see exactly what the subscriber would have received.
 */
export function toEntries(
  results: DeliveryResult[],
  subscribers: Subscriber[],
  event: NotificationEvent,
): AuditEntry[] {
  const byId = new Map(subscribers.map((s) => [s.id, s]));
  const at = new Date().toISOString();

  return results.map((r) => ({
    at,
    subscriberId: r.subscriberId,
    email: byId.get(r.subscriberId)?.email ?? '',
    channel: r.channel,
    eventKind: event.kind,
    ok: r.ok,
    error: r.error,
    payload: event.payload,
  }));
}

/**
 * Record a batch. Failures to audit are swallowed — losing the log is not a
 * reason to fail a delivery that already happened.
 */
export async function record(
  sink: AuditSink,
  results: DeliveryResult[],
  subscribers: Subscriber[],
  event: NotificationEvent,
): Promise<void> {
  try {
    await sink.write(toEntries(results, subscribers, event));
  } catch {
    // ignored on purpose
  }
}

/** A support-facing line for one entry. */
export function formatEntry(entry: AuditEntry): string {
  const status = entry.ok ? 'delivered' : `failed (${entry.error ?? 'no reason'})`;
  const link = `${config.studioBaseUrl}/audit/${entry.subscriberId}`;
  return `${entry.at} ${entry.channel} → ${entry.email}: ${status} — ${link}`;
}
