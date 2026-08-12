import { describe, it, expect } from 'vitest';
import { buildCodeDigest } from '../src/modules/intent/digest.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { MAX_DIGEST_FILES } from '../src/modules/intent/constants.js';

/**
 * `buildCodeDigest` (§1 of the L03 plan, "Narrow the classifier inputs") —
 * source 4 of the classifier's exactly-four inputs: the changed-file list
 * from hunk headers, path + `+adds/-dels`. No hunk content, ever — this is
 * the central point of the narrowing, and the tests below assert it directly
 * on the output string rather than via a proxy such as a flag.
 *
 * Fixtures are built via the real `parseUnifiedDiff` (same parser the app
 * uses) so they exercise the exact `UnifiedDiff.files` shape `digest.ts`
 * depends on.
 */

function diffFor(raw: string) {
  return parseUnifiedDiff(raw);
}

describe('buildCodeDigest — the changed-file list (path + adds/dels), always present', () => {
  it('lists every changed file with path + adds/dels', () => {
    const raw = [
      'diff --git a/src/api/public.ts b/src/api/public.ts',
      '--- a/src/api/public.ts',
      '+++ b/src/api/public.ts',
      '@@ -1,0 +1,2 @@',
      '+line one',
      '+line two',
    ].join('\n');
    const digest = buildCodeDigest(diffFor(raw));

    expect(digest).toContain('Changed files:');
    expect(digest).toContain('+2/-0');
    expect(digest).toContain('src/api/public.ts');
  });

  it('lists multiple files, each with its own adds/dels', () => {
    const raw = [
      'diff --git a/src/big.ts b/src/big.ts',
      '--- a/src/big.ts',
      '+++ b/src/big.ts',
      '@@ -1,0 +1,9 @@',
      Array.from({ length: 9 }, () => '+x').join('\n'),
      'diff --git a/src/small.ts b/src/small.ts',
      '--- a/src/small.ts',
      '+++ b/src/small.ts',
      '@@ -1,0 +1,1 @@',
      '+hello',
    ].join('\n');

    const digest = buildCodeDigest(diffFor(raw));
    expect(digest).toContain('+9/-0');
    expect(digest).toContain('src/big.ts');
    expect(digest).toContain('+1/-0');
    expect(digest).toContain('src/small.ts');
  });
});

describe('buildCodeDigest — no hunk content ever reaches the digest (the central point of L03 §1)', () => {
  it('the digest contains the changed file path but none of the hunk-body content lines', () => {
    const raw = [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      '@@ -10,3 +10,4 @@',
      '   port: 3000,',
      '+  stripeKey: "sk_live_DISTINCTIVE_SECRET_VALUE",',
      '-  redisUrl: OLD_DISTINCTIVE_REMOVED_VALUE,',
      '   redisUrl: x,',
    ].join('\n');

    const digest = buildCodeDigest(diffFor(raw));

    expect(digest).toContain('src/config.ts');
    expect(digest).not.toContain('stripeKey');
    expect(digest).not.toContain('sk_live_DISTINCTIVE_SECRET_VALUE');
    expect(digest).not.toContain('OLD_DISTINCTIVE_REMOVED_VALUE');
    expect(digest).not.toContain('port: 3000');
    // No raw diff markup at all — only the summary line format.
    expect(digest).not.toContain('@@');
    expect(digest).not.toContain('diff --git');
  });

  it('a large multi-file diff with distinctive added/removed lines never leaks any of them', () => {
    const raw = [
      'diff --git a/src/api/public.ts b/src/api/public.ts',
      '--- a/src/api/public.ts',
      '+++ b/src/api/public.ts',
      '@@ -1,0 +1,1 @@',
      '+export const SECRET_TOKEN_ONE = "abc123";',
      'diff --git a/src/api/private.ts b/src/api/private.ts',
      '--- a/src/api/private.ts',
      '+++ b/src/api/private.ts',
      '@@ -5,2 +5,1 @@',
      '-export const REMOVED_TOKEN_TWO = "xyz789";',
      ' const unrelated = 1;',
    ].join('\n');

    const digest = buildCodeDigest(diffFor(raw));

    expect(digest).toContain('src/api/public.ts');
    expect(digest).toContain('src/api/private.ts');
    expect(digest).not.toContain('SECRET_TOKEN_ONE');
    expect(digest).not.toContain('REMOVED_TOKEN_TWO');
    expect(digest).not.toContain('abc123');
    expect(digest).not.toContain('xyz789');
  });
});

describe('buildCodeDigest — MAX_DIGEST_FILES cap', () => {
  function manyFilesDiff(count: number): string {
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      parts.push(
        `diff --git a/src/file${i}.ts b/src/file${i}.ts`,
        `--- a/src/file${i}.ts`,
        `+++ b/src/file${i}.ts`,
        '@@ -1,0 +1,1 @@',
        `+content ${i}`,
      );
    }
    return parts.join('\n');
  }

  it('lists at most MAX_DIGEST_FILES files and notes the overflow, rather than silently truncating', () => {
    const count = MAX_DIGEST_FILES + 25;
    const digest = buildCodeDigest(diffFor(manyFilesDiff(count)));

    expect(digest).toContain('src/file0.ts');
    expect(digest).toContain(`src/file${MAX_DIGEST_FILES - 1}.ts`);
    expect(digest).not.toContain(`src/file${MAX_DIGEST_FILES}.ts`);
    expect(digest).toContain('… and 25 more files');
  });

  it('does not mention an overflow when the file count is within the cap', () => {
    const digest = buildCodeDigest(diffFor(manyFilesDiff(3)));
    expect(digest).not.toContain('more files');
  });
});
