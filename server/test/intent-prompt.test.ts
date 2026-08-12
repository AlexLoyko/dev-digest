import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { buildIntentPrompt, type PromptPart } from '../src/modules/intent/prompt.js';
import {
  MAX_BODY_CHARS,
  MAX_DIGEST_FILES,
  MAX_DOC_CHARS,
  SYSTEM_PROMPT,
} from '../src/modules/intent/constants.js';

/**
 * `buildIntentPrompt` — the classifier's request assembly, extracted out of
 * `service.ts` so the exact bytes sent to the model can be logged part by part.
 *
 * Two properties matter here and are asserted throughout: the assembled prompt
 * is byte-identical to what the inline assembly produced, and `parts` accounts
 * for every character of `user` (nothing falls between the parts, so a reader of
 * the log can attribute anything odd to the source it came in through).
 */

function makeDiff(files: { path: string; additions?: number; deletions?: number }[]): UnifiedDiff {
  return {
    raw: 'diff --git a/x b/x\n@@ -1 +1 @@\n-secret\n+SHOULD_NEVER_REACH_THE_PROMPT\n',
    files: files.map((f) => ({
      path: f.path,
      additions: f.additions ?? 1,
      deletions: f.deletions ?? 0,
      hunks: [],
    })),
  } as unknown as UnifiedDiff;
}

const ONE_FILE = makeDiff([{ path: 'src/config.ts', additions: 3, deletions: 1 }]);

function partOf(parts: PromptPart[], kind: PromptPart['kind']): PromptPart {
  const found = parts.filter((p) => p.kind === kind);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe('buildIntentPrompt — the prompt itself is unchanged', () => {
  it('the system message is SYSTEM_PROMPT verbatim, and is parts[0]', () => {
    const p = buildIntentPrompt({ title: 'T', body: null, docTexts: [], diff: ONE_FILE });
    expect(p.system).toBe(SYSTEM_PROMPT);
    expect(p.parts[0]!.kind).toBe('system');
    expect(p.parts[0]!.text).toBe(SYSTEM_PROMPT);
    expect(p.systemChars).toBe(SYSTEM_PROMPT.length);
  });

  it('the user message keeps the four fixed sections, joined by a blank line', () => {
    const p = buildIntentPrompt({
      title: 'Add rate limiting',
      body: 'Some description.',
      docTexts: [{ path: 'docs/plan.md', text: 'The plan.', sourceChars: 9 }],
      diff: ONE_FILE,
    });
    expect(p.user).toContain('PR title: Add rate limiting');
    expect(p.user).toContain('PR description:\nSome description.');
    expect(p.user).toContain('Doc "docs/plan.md":\nThe plan.');
    expect(p.user).toContain('Code digest:\nChanged files:');
    expect(p.user).toContain('+3/-1  src/config.ts');
  });

  it('an absent body still emits the "(none given)" section', () => {
    const p = buildIntentPrompt({ title: 'T', body: null, docTexts: [], diff: ONE_FILE });
    expect(p.user).toContain('PR description: (none given)');
    expect(partOf(p.parts, 'pr_body').truncated).toBe(false);
  });

  it('a whitespace-only body reads as absent — the one deliberate change from the inline assembly', () => {
    // The old `pull.body ?` branch was raw-truthy but sent `body.trim()`, so this
    // input produced a dangling `PR description:\n` while `sources.ts` recorded
    // the same body as unresolved. Now both agree.
    const p = buildIntentPrompt({ title: 'T', body: '   \n  ', docTexts: [], diff: ONE_FILE });
    expect(p.user).toContain('PR description: (none given)');
    expect(p.user).not.toContain('PR description:\n');
  });

  it('never lets diff content in — only the changed-file list from the hunk headers', () => {
    const p = buildIntentPrompt({ title: 'T', body: null, docTexts: [], diff: ONE_FILE });
    expect(p.user).toContain('src/config.ts');
    expect(p.user).not.toContain('SHOULD_NEVER_REACH_THE_PROMPT');
    expect(p.user).not.toContain('diff --git');
    expect(p.user).not.toContain('@@');
  });
});

describe('buildIntentPrompt — parts account for the whole user message', () => {
  it('the non-system parts, rejoined, reconstruct `user` exactly', () => {
    const p = buildIntentPrompt({
      title: 'Add rate limiting',
      body: 'Some description.',
      docTexts: [
        { path: 'docs/plan.md', text: 'The plan.', sourceChars: 9 },
        { path: 'specs/0002.md', text: 'The spec.', sourceChars: 9 },
      ],
      diff: ONE_FILE,
    });
    const rejoined = p.parts
      .filter((part) => part.kind !== 'system')
      .map((part) => part.text)
      .join('\n\n');
    expect(rejoined).toBe(p.user);
  });

  it('parts arrive in prompt order, one per doc', () => {
    const p = buildIntentPrompt({
      title: 'T',
      body: 'B',
      docTexts: [
        { path: 'docs/a.md', text: 'A', sourceChars: 1 },
        { path: 'docs/b.md', text: 'B', sourceChars: 1 },
      ],
      diff: ONE_FILE,
    });
    expect(p.parts.map((part) => part.kind)).toEqual([
      'system',
      'pr_title',
      'pr_body',
      'doc',
      'doc',
      'code_digest',
    ]);
    expect(p.parts.filter((part) => part.kind === 'doc').map((part) => part.ref)).toEqual([
      'docs/a.md',
      'docs/b.md',
    ]);
  });

  it('`ref` is set for docs only', () => {
    const p = buildIntentPrompt({
      title: 'T',
      body: 'B',
      docTexts: [{ path: 'docs/a.md', text: 'A', sourceChars: 1 }],
      diff: ONE_FILE,
    });
    for (const part of p.parts) {
      if (part.kind === 'doc') expect(part.ref).toBe('docs/a.md');
      else expect(part.ref).toBeUndefined();
    }
  });
});

describe('buildIntentPrompt — truncation is reported, never applied to the log', () => {
  it('a body over MAX_BODY_CHARS is capped, and says so with its pre-cap length', () => {
    const body = 'b'.repeat(MAX_BODY_CHARS + 250);
    const p = buildIntentPrompt({ title: 'T', body, docTexts: [], diff: ONE_FILE });
    const bodyPart = partOf(p.parts, 'pr_body');
    expect(bodyPart.truncated).toBe(true);
    expect(bodyPart.chars).toBe('PR description:\n'.length + MAX_BODY_CHARS);
    expect(bodyPart.sourceChars).toBe('PR description:\n'.length + MAX_BODY_CHARS + 250);
    // The part still carries the text that was SENT, in full — not an excerpt.
    expect(bodyPart.text).toBe(`PR description:\n${'b'.repeat(MAX_BODY_CHARS)}`);
  });

  it('a body of exactly MAX_BODY_CHARS is not reported as truncated', () => {
    const p = buildIntentPrompt({
      title: 'T',
      body: 'b'.repeat(MAX_BODY_CHARS),
      docTexts: [],
      diff: ONE_FILE,
    });
    expect(partOf(p.parts, 'pr_body').truncated).toBe(false);
  });

  it('a doc the resolver already capped reports truncated via its sourceChars', () => {
    const p = buildIntentPrompt({
      title: 'T',
      body: null,
      docTexts: [
        { path: 'docs/big.md', text: 'd'.repeat(MAX_DOC_CHARS), sourceChars: MAX_DOC_CHARS + 500 },
        { path: 'docs/small.md', text: 'ok', sourceChars: 2 },
      ],
      diff: ONE_FILE,
    });
    const [big, small] = p.parts.filter((part) => part.kind === 'doc');
    expect(big!.truncated).toBe(true);
    expect(big!.ref).toBe('docs/big.md');
    expect(small!.truncated).toBe(false);
  });

  it('digest overflow is counted from the file cap, not from a length comparison', () => {
    const many = makeDiff(
      Array.from({ length: MAX_DIGEST_FILES + 5 }, (_, i) => ({ path: `src/f${i}.ts` })),
    );
    const p = buildIntentPrompt({ title: 'T', body: null, docTexts: [], diff: many });
    expect(p.digestFilesTotal).toBe(MAX_DIGEST_FILES + 5);
    expect(p.digestFilesListed).toBe(MAX_DIGEST_FILES);
    expect(p.digestOverflow).toBe(5);
    expect(partOf(p.parts, 'code_digest').truncated).toBe(true);
    expect(p.user).toContain('… and 5 more files');
  });

  it('a diff under the file cap overflows by zero', () => {
    const p = buildIntentPrompt({ title: 'T', body: null, docTexts: [], diff: ONE_FILE });
    expect(p.digestFilesTotal).toBe(1);
    expect(p.digestFilesListed).toBe(1);
    expect(p.digestOverflow).toBe(0);
    expect(partOf(p.parts, 'code_digest').truncated).toBe(false);
  });
});

describe('buildIntentPrompt — token estimate', () => {
  it('every part estimates ceil(chars / 4)', () => {
    const p = buildIntentPrompt({
      title: 'Add rate limiting',
      body: 'Some description.',
      docTexts: [{ path: 'docs/plan.md', text: 'The plan.', sourceChars: 9 }],
      diff: ONE_FILE,
    });
    for (const part of p.parts) {
      expect(part.estTokens).toBe(Math.ceil(part.chars / 4));
    }
  });

  it('estTokensIn is the system estimate plus the whole user message estimate', () => {
    const p = buildIntentPrompt({
      title: 'Add rate limiting',
      body: 'Some description.',
      docTexts: [],
      diff: ONE_FILE,
    });
    expect(p.userChars).toBe(p.user.length);
    expect(p.estTokensIn).toBe(Math.ceil(SYSTEM_PROMPT.length / 4) + Math.ceil(p.user.length / 4));
  });
});
