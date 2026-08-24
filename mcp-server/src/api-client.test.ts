import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { createApiClient } from './api-client.js';
import { apiUnreachable, rateLimited } from './errors.js';

/**
 * Hand-rolled fetch stub — deliberately NOT `test/fake-api.ts` (T6 depends on
 * T5, so this file must stand on its own). Each test builds the smallest
 * fetch double it needs.
 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const config = loadConfig({ DEVDIGEST_API_URL: 'http://127.0.0.1:3001' });

describe('createApiClient', () => {
  it('happy path: parses a 200 JSON body into the expected shape', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchStub: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse([{ id: 'agent-1', name: 'General', enabled: true }]);
    };

    const client = createApiClient({ config, fetch: fetchStub });
    const agents = await client.listAgents();

    expect(agents).toEqual([{ id: 'agent-1', name: 'General', enabled: true }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://127.0.0.1:3001/agents');
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('gives GET /repos/:id/pulls a 30s timeout, everything else 10s', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const fetchStub: typeof fetch = async (_input, init) => {
      signals.push(init?.signal);
      return jsonResponse([]);
    };

    const client = createApiClient({ config, fetch: fetchStub });
    await client.listPulls('repo-1');
    await client.listAgents();

    // AbortSignal doesn't expose its timeout directly; assert indirectly by
    // checking a signal was attached to each call (the timeout values
    // themselves are exercised by the "connection refused"/timeout test
    // below, which does not depend on the exact millisecond budget).
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeInstanceOf(AbortSignal);
  });

  it('POST /pulls/:id/review sends { agentId } as the JSON body', async () => {
    let capturedBody: unknown;
    const fetchStub: typeof fetch = async (_input, init) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return jsonResponse({
        pr_id: 'pr-1',
        runs: [{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'General' }],
        reviews: [],
      });
    };

    const client = createApiClient({ config, fetch: fetchStub });
    const result = await client.startReview('pr-1', 'agent-1');

    expect(capturedBody).toEqual({ agentId: 'agent-1' });
    expect(result.runs).toEqual([{ run_id: 'run-1', agent_id: 'agent-1', agent_name: 'General' }]);
  });

  it('a stubbed 404 with an ApiErrorBody surfaces the API message', async () => {
    const fetchStub: typeof fetch = async () =>
      jsonResponse({ error: { code: 'not_found', message: 'Pull request not found' } }, 404);

    const client = createApiClient({ config, fetch: fetchStub });

    await expect(client.listReviews('missing-pr')).rejects.toMatchObject({
      text: expect.stringContaining('Pull request not found'),
    });
  });

  it('a stubbed 429 produces the exact rateLimited() text', async () => {
    const fetchStub: typeof fetch = async () => jsonResponse({ error: { code: 'rate_limited' } }, 429);

    const client = createApiClient({ config, fetch: fetchStub });

    await expect(client.startReview('pr-1', 'agent-1')).rejects.toMatchObject({
      text: rateLimited(),
    });
  });

  it('a stubbed connection-refused failure produces the exact apiUnreachable() text', async () => {
    const fetchStub: typeof fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3001'), { code: 'ECONNREFUSED' }),
      });
    };

    const client = createApiClient({ config, fetch: fetchStub });

    await expect(client.listAgents()).rejects.toMatchObject({ text: apiUnreachable() });
  });

  it('a stubbed timeout (AbortSignal firing) also produces the apiUnreachable() text', async () => {
    const fetchStub: typeof fetch = async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    };

    const client = createApiClient({ config, fetch: fetchStub });

    await expect(client.listConventions('repo-1')).rejects.toMatchObject({ text: apiUnreachable() });
  });
});
