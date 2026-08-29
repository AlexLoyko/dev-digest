import { describe, it, expect } from 'vitest';
import type { Intent } from '@devdigest/shared';
import type { Tokenizer } from '../src/adapters/tokenizer/index.js';
import { fitToBudget } from '../src/modules/brief/budget.js';
import { buildBriefUserMessage } from '../src/modules/brief/prompt.js';
import type { BriefInputParts, BriefChangedFile } from '../src/modules/brief/types.js';
import {
  BRIEF_TOKEN_BUDGET,
  MAX_ISSUE_BODY_CHARS,
  MAX_PR_DESCRIPTION_CHARS,
} from '../src/modules/brief/constants.js';

/**
 * Deterministic, call-counting stand-in for `Tokenizer`. `ratio` is
 * injectable so the same test can be run against two different
 * character-to-token ratios — simulating both the real cl100k_base encoder
 * and its `ceil(chars/4)` fallback (adapters/tokenizer/index.ts:40-46) —
 * without ever depending on chars/4 as a hardcoded assumption inside
 * `budget.ts` itself.
 */
class CountingTokenizer implements Tokenizer {
  calls = 0;
  constructor(private readonly ratio: (text: string) => number) {}
  count(text: string): number {
    this.calls++;
    return this.ratio(text);
  }
  countDetailed(text: string): { tokens: number; approximate: boolean } {
    return { tokens: this.count(text), approximate: false };
  }
}

const charsOverFour = (text: string) => Math.ceil(text.length / 4);
const charsOverTwo = (text: string) => Math.ceil(text.length / 2);

function baseParts(overrides: Partial<BriefInputParts> = {}): BriefInputParts {
  return {
    pr: {
      title: 'Add retry logic to the webhook dispatcher',
      body: null,
      author: 'octocat',
      branch: 'feat/retry-webhooks',
      base: 'main',
      headSha: 'abc1234',
      status: 'needs_review',
    },
    diffStats: { additions: 42, deletions: 10, filesCount: 1 },
    changedFiles: [{ path: 'src/webhooks/dispatcher.ts', additions: 42, deletions: 10 }],
    intent: null,
    blastSummary: null,
    linkedIssue: null,
    projectContextDocs: [],
    ...overrides,
  };
}

function manyChangedFiles(n: number): BriefChangedFile[] {
  return Array.from({ length: n }, (_, i) => ({
    path: `src/services/module-${String(i).padStart(3, '0')}/handler-${String(i).padStart(3, '0')}.ts`,
    additions: (n - i) * 3,
    deletions: i,
  }));
}

describe('fitToBudget — under-budget path', () => {
  it.each([
    ['chars/4 (fallback-shaped)', charsOverFour],
    ['chars/2 (real-encoder-shaped)', charsOverTwo],
  ])('records only the project_context omission, leaves every other part byte-identical (%s)', (_label, ratio) => {
    const tokenizer = new CountingTokenizer(ratio);
    const parts = baseParts();

    const result = fitToBudget(parts, tokenizer, BRIEF_TOKEN_BUDGET);

    expect(result.degraded).toEqual([{ input: 'project_context', action: 'omitted' }]);
    expect(result.parts).toEqual(parts);
    expect(result.tokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
  });
});

describe('fitToBudget — NFR-2: 400-file PR', () => {
  it.each([
    ['chars/4 (fallback-shaped)', charsOverFour],
    ['chars/2 (real-encoder-shaped)', charsOverTwo],
  ])('fits within the 8000-token budget with far fewer than 30 count() calls (%s)', (_label, ratio) => {
    const tokenizer = new CountingTokenizer(ratio);
    const parts = baseParts({
      diffStats: { additions: 12000, deletions: 4000, filesCount: 400 },
      changedFiles: manyChangedFiles(400),
    });

    const result = fitToBudget(parts, tokenizer, BRIEF_TOKEN_BUDGET);

    expect(result.tokens).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
    expect(result.parts.changedFiles.length).toBeGreaterThan(0);
    expect(result.parts.changedFiles.length).toBeLessThan(400);
    expect(result.degraded).toContainEqual(
      expect.objectContaining({ input: 'changed_files', action: 'reduced' }),
    );
    expect(tokenizer.calls).toBeLessThan(30);

    // The final candidate genuinely fits when re-measured (not just the
    // internally tracked count from the binary search).
    const remeasured = ratio(buildBriefUserMessage(result.parts));
    expect(remeasured).toBeLessThanOrEqual(BRIEF_TOKEN_BUDGET);
  });
});

describe('fitToBudget — changed-file ranking', () => {
  it('keeps the highest additions+deletions files first, in rank order', () => {
    const files: BriefChangedFile[] = [
      { path: 'src/e.ts', additions: 100, deletions: 0 },
      { path: 'src/d.ts', additions: 200, deletions: 0 },
      { path: 'src/c.ts', additions: 300, deletions: 0 },
      { path: 'src/b.ts', additions: 400, deletions: 0 },
      { path: 'src/a.ts', additions: 500, deletions: 0 },
    ];
    const parts = baseParts({ changedFiles: files });
    const rankOrdered = [files[4], files[3], files[2], files[1], files[0]]; // a,b,c,d,e

    // Budget = exact size of the rank-ordered 2-file candidate: fits 2, not 3
    // (each candidate is strictly longer than the last — monotonic growth).
    const twoFileCandidate = buildBriefUserMessage({
      ...parts,
      changedFiles: rankOrdered.slice(0, 2),
    });
    const tokenizer = new CountingTokenizer((t) => t.length);
    const budget = tokenizer.count(twoFileCandidate);
    tokenizer.calls = 0; // don't count the setup measurement against the assertion below

    const result = fitToBudget(parts, tokenizer, budget);

    expect(result.parts.changedFiles).toEqual(rankOrdered.slice(0, 2));
  });
});

describe('fitToBudget — never sheds structural PR metadata or diff stats', () => {
  it('keeps title, branch, base, author, head sha, status and diff stats even under an impossible budget', () => {
    const tokenizer = new CountingTokenizer(charsOverFour);
    const parts = baseParts({
      intent: { intent: 'Do a thing', in_scope: ['a'], out_of_scope: ['b'] },
      blastSummary: 'x'.repeat(1000),
      linkedIssue: { title: 'Some issue', body: 'y'.repeat(6000) },
      pr: { ...baseParts().pr, body: 'z'.repeat(6000) },
      changedFiles: manyChangedFiles(20),
    });

    const result = fitToBudget(parts, tokenizer, 1);

    expect(result.parts.pr.title).toBe(parts.pr.title);
    expect(result.parts.pr.branch).toBe(parts.pr.branch);
    expect(result.parts.pr.base).toBe(parts.pr.base);
    expect(result.parts.pr.author).toBe(parts.pr.author);
    expect(result.parts.pr.headSha).toBe(parts.pr.headSha);
    expect(result.parts.pr.status).toBe(parts.pr.status);
    expect(result.parts.diffStats).toEqual(parts.diffStats);
  });
});

describe('fitToBudget — shed order (R-3)', () => {
  it('sheds project_context, changed_files, linked_issue, blast, pr_description, then intent, in that order', () => {
    const tokenizer = new CountingTokenizer(charsOverFour);
    const intent: Intent = { intent: 'Do a thing', in_scope: ['a'], out_of_scope: [] };
    const parts = baseParts({
      changedFiles: manyChangedFiles(20),
      linkedIssue: { title: 'Kept title', body: 'y'.repeat(6000) },
      blastSummary: 'b'.repeat(800),
      pr: { ...baseParts().pr, body: 'z'.repeat(6000) },
      intent,
    });

    const result = fitToBudget(parts, tokenizer, 10);

    const inputsInOrder = result.degraded.map((d) => d.input);
    expect(inputsInOrder[0]).toBe('project_context');
    expect(inputsInOrder.indexOf('changed_files')).toBeGreaterThan(inputsInOrder.indexOf('project_context'));
    expect(inputsInOrder.indexOf('linked_issue')).toBeGreaterThan(inputsInOrder.indexOf('changed_files'));
    expect(inputsInOrder.indexOf('blast')).toBeGreaterThan(inputsInOrder.lastIndexOf('linked_issue'));
    expect(inputsInOrder.indexOf('pr_description')).toBeGreaterThan(inputsInOrder.lastIndexOf('blast'));
    expect(inputsInOrder.lastIndexOf('intent')).toBe(inputsInOrder.length - 1);

    // Fully shed by the time we reach intent.
    expect(result.parts.linkedIssue?.body).toBeNull();
    expect(result.parts.linkedIssue?.title).toBe('Kept title');
    expect(result.parts.blastSummary).toBeNull();
    expect(result.parts.pr.body).toBeNull();
    expect(result.parts.intent).toBeNull();
  });

  it('slices the linked-issue body to MAX_ISSUE_BODY_CHARS, then drops it, keeping the title', () => {
    // `prompt.ts` itself always renders a linked-issue body capped at
    // MAX_ISSUE_BODY_CHARS (constants.ts), so a body already longer than
    // that cap renders identically whether or not `budget.ts` pre-slices it
    // — the "reduce" step is a real, recorded reduction of the STORED value
    // (useful downstream), not something that changes the measured token
    // count on its own. It is therefore always immediately followed by the
    // "omitted" step whenever the capped-length render still doesn't fit.
    const tokenizer = new CountingTokenizer(charsOverFour);
    const longBody = 'y'.repeat(MAX_ISSUE_BODY_CHARS + 2000);
    const parts = baseParts({
      changedFiles: manyChangedFiles(20),
      linkedIssue: { title: 'Kept title', body: longBody },
    });

    const result = fitToBudget(parts, tokenizer, 1);

    const linkedIssueSteps = result.degraded.filter((d) => d.input === 'linked_issue');
    expect(linkedIssueSteps.map((d) => d.action)).toEqual(['reduced', 'omitted']);
    expect(result.parts.linkedIssue?.body).toBeNull();
    expect(result.parts.linkedIssue?.title).toBe('Kept title');
  });

  it('truncates the PR description to MAX_PR_DESCRIPTION_CHARS, then to 1000 chars, before dropping it', () => {
    const tokenizer = new CountingTokenizer(charsOverFour);
    const longBody = 'z'.repeat(MAX_PR_DESCRIPTION_CHARS + 5000);
    const parts = baseParts({ pr: { ...baseParts().pr, body: longBody } });

    const result = fitToBudget(parts, tokenizer, 1);

    const prDescriptionSteps = result.degraded.filter((d) => d.input === 'pr_description');
    expect(prDescriptionSteps.map((d) => d.action)).toEqual(['reduced', 'reduced', 'omitted']);
    expect(result.parts.pr.body).toBeNull();
  });
});
