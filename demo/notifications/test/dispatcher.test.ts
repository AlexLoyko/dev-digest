/**
 * DEMO FIXTURE tests. Not run by any CI lane — `demo/` is outside every
 * workflow's paths filter. They exist so the fixture reads like real code.
 */
import { describe, it, expect, vi } from 'vitest';
import { deliver, deliverAll, summarise, type Subscriber, type Transport } from '../src/dispatcher.js';

const transport = (): Transport => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendSlack: vi.fn().mockResolvedValue(undefined),
  postWebhook: vi.fn().mockResolvedValue(undefined),
});

const subscriber = (over: Partial<Subscriber> = {}): Subscriber => ({
  id: 's-1',
  email: 'dev@example.com',
  channels: ['email'],
  ...over,
});

const event = { kind: 'review.completed', subjectId: 'pr-1', payload: { prNumber: 42 } };

describe('deliver', () => {
  it('delivers to every enabled channel', async () => {
    const t = transport();
    const results = await deliver(
      t,
      subscriber({ channels: ['email', 'slack'], slackUserId: 'U1' }),
      event,
    );
    expect(results.map((r) => r.channel)).toEqual(['email', 'slack']);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('one channel failing does not stop the others', async () => {
    const t = transport();
    (t.sendEmail as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('smtp down'));
    const results = await deliver(
      t,
      subscriber({ channels: ['email', 'slack'], slackUserId: 'U1' }),
      event,
    );
    expect(results[0]!.ok).toBe(false);
    expect(results[1]!.ok).toBe(true);
  });

  it('reports a misconfigured channel rather than throwing', async () => {
    const results = await deliver(transport(), subscriber({ channels: ['slack'] }), event);
    expect(results[0]!.ok).toBe(false);
    expect(results[0]!.error).toMatch(/slack user id/);
  });
});

describe('deliverAll', () => {
  it('covers every subscriber', async () => {
    const subs = Array.from({ length: 9 }, (_, i) => subscriber({ id: `s-${i}` }));
    const results = await deliverAll(transport(), subs, event);
    expect(new Set(results.map((r) => r.subscriberId)).size).toBe(9);
  });
});

describe('summarise', () => {
  it('splits delivered from failed', () => {
    expect(
      summarise([
        { subscriberId: 's', channel: 'email', ok: true },
        { subscriberId: 's', channel: 'slack', ok: false, error: 'x' },
      ]),
    ).toEqual({ attempted: 2, delivered: 1, failed: 1 });
  });
});
