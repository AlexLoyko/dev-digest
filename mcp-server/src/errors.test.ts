import { describe, expect, it } from 'vitest';
import * as errorsModule from './errors.js';

/**
 * Any directive-sentence naming a concrete next action: a `devdigest_*`
 * tool name, the dev-server startup command, or a localhost URL the user
 * can open. Every builder's output must satisfy this — see design
 * principle 4, "an error leads somewhere".
 */
const DIRECTIVE_SENTENCE = /devdigest_[a-z_]+|\.\/scripts\/dev\.sh|http:\/\/localhost:3000/;

// Dummy args polymorphic enough to satisfy every builder's signature: each
// position is an array, which is safe both when a builder interpolates it
// directly into a template string (arrays stringify via Array#toString)
// and when a builder calls array methods on it (.join, .map) — covering
// both the plain-string params and the known-list params without having to
// hand-list each builder's exact signature here.
const DUMMY_ARGS: unknown[] = [['dummy-a', 'dummy-b'], ['dummy-a', 'dummy-b'], ['dummy-a', 'dummy-b']];

function isBuilder(name: string, value: unknown): value is (...args: unknown[]) => string {
  return typeof value === 'function' && name !== 'ToolError';
}

describe('errors — every exported builder', () => {
  const builders = Object.entries(errorsModule).filter(([name, value]) => isBuilder(name, value));

  it('exports at least the nine required builders', () => {
    expect(builders.length).toBeGreaterThanOrEqual(9);
  });

  it.each(builders)('%s() ends with a directive sentence naming a concrete next action', (_name, fn) => {
    const builder = fn as (...args: unknown[]) => string;
    const text = builder(...DUMMY_ARGS.slice(0, builder.length));

    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toMatch(DIRECTIVE_SENTENCE);
  });
});

describe('ToolError', () => {
  it('carries the given text on `.text`', () => {
    const err = new errorsModule.ToolError('boom');
    expect(err.text).toBe('boom');
    expect(err).toBeInstanceOf(Error);
  });

  it('carries an optional `.kind`, undefined when not given', () => {
    const untagged = new errorsModule.ToolError('boom');
    expect(untagged.kind).toBeUndefined();

    const tagged = new errorsModule.ToolError('boom', 'unknown_agent');
    expect(tagged.kind).toBe('unknown_agent');
  });
});

describe('TOOL_ERROR_KINDS', () => {
  it('lists exactly nine unique kind values', () => {
    expect(errorsModule.TOOL_ERROR_KINDS.length).toBe(9);
    expect(new Set(errorsModule.TOOL_ERROR_KINDS).size).toBe(9);
  });
});

describe('exact strings — from docs/plans/l04-devdigest-mcp.md "The five tools"', () => {
  it('apiUnreachable()', () => {
    expect(errorsModule.apiUnreachable()).toBe(
      'DevDigest API is not reachable at http://127.0.0.1:3001. Ask the user to start it with ' +
        './scripts/dev.sh, then retry. Do not retry in a loop.',
    );
  });

  it('unknownRepo(input, known)', () => {
    expect(errorsModule.unknownRepo('x/y', ['acme/api', 'acme/web'])).toBe(
      'Repository "x/y" is not in DevDigest. Known repositories: acme/api, acme/web. ' +
        'Add it at http://localhost:3000/repos, then retry.',
    );
  });

  it('unknownRepo(...) caps enumerated lists at 20 with a "(+N more)" suffix', () => {
    const many = Array.from({ length: 25 }, (_, i) => `acme/repo-${i}`);
    const text = errorsModule.unknownRepo('x/y', many);

    expect(text).toContain(many.slice(0, 20).join(', '));
    expect(text).toContain('(+5 more)');
    expect(text).not.toContain('acme/repo-20');
  });

  it('unknownPr(repo, pr, knownNumbers) — adds a directive URL (see plan-inconsistency note in errors.ts)', () => {
    expect(errorsModule.unknownPr('acme/api', 482, [481, 480, 479])).toBe(
      'PR #482 was not found in acme/api. Imported PR numbers include: 481, 480, 479. ' +
        'Open the repo in DevDigest at http://localhost:3000 to import more PRs, then retry.',
    );
  });

  it('unknownPr(...) caps enumerated lists at 20 with a "(+N more)" suffix', () => {
    const many = Array.from({ length: 22 }, (_, i) => i);
    const text = errorsModule.unknownPr('acme/api', 482, many);

    expect(text).toContain(many.slice(0, 20).join(', '));
    expect(text).toContain('(+2 more)');
  });

  it('unknownAgent(input)', () => {
    expect(errorsModule.unknownAgent('x')).toBe(
      'Agent "x" not found. Call devdigest_list_agents to get the valid agent ids, then retry.',
    );
  });

  it('agentDisabled(name)', () => {
    expect(errorsModule.agentDisabled('Security')).toBe(
      'Agent "Security" is disabled in DevDigest. Enable it at http://localhost:3000/agents, ' +
        'or call devdigest_list_agents and pick one whose "enabled" is true.',
    );
  });

  it('rateLimited()', () => {
    expect(errorsModule.rateLimited()).toBe(
      'DevDigest allows at most 10 review runs per minute. Wait ~60 seconds and call ' +
        'devdigest_run_agent_on_pr again — or, if you already started a run, call ' +
        'devdigest_get_findings with its run_id.',
    );
  });

  it('unknownRunId(runId)', () => {
    expect(errorsModule.unknownRunId('X')).toBe(
      'Unknown run_id "X". This server only knows runs it started. Call ' +
        'devdigest_run_agent_on_pr(repo, pr, agent_id) to start a review — it returns a run_id ' +
        'and waits for the findings.',
    );
  });

  it('runFailed(runId, error)', () => {
    expect(errorsModule.runFailed('X', 'boom')).toBe(
      'The review run failed: boom. Check the DevDigest API log, then call ' +
        'devdigest_run_agent_on_pr again to retry.',
    );
  });

  it('noReviewForRun(runId)', () => {
    expect(errorsModule.noReviewForRun('X')).toBe(
      'Run "X" finished but produced no review. Call devdigest_run_agent_on_pr(repo, pr, agent_id) ' +
        'to run it again.',
    );
  });
});
