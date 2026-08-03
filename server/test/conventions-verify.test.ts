import { describe, it, expect } from 'vitest';
import {
  consistencyScore,
  findSnippetLines,
  isSafeRepoPath,
  verifyEvidence,
  type RawCandidate,
} from '../src/modules/conventions/verify.js';
import { buildSkillBody, evidenceRef, slugify } from '../src/modules/conventions/helpers.js';

/**
 * The conventions evidence gate — the conventions analogue of the citation
 * grounding gate. A candidate survives only if its cited file exists in the
 * sampled set AND its snippet really occurs there; the line span it claimed is
 * always replaced by the one we compute.
 */

const USERS_TS = [
  "import { db } from '../lib/db';", // 1
  '', // 2
  'export async function getUser(id: string) {', // 3
  '  const user = await db.users.find(id);', // 4
  '  const posts = await db.posts.findMany({ userId });', // 5
  '  return { user, posts };', // 6
  '}', // 7
].join('\n');

function candidate(over: Partial<RawCandidate> = {}): RawCandidate {
  return {
    category: 'async',
    rule: 'Always use async/await instead of .then() chains',
    evidence_path: 'src/api/users.ts',
    evidence_start_line: 1,
    evidence_end_line: 2,
    evidence_snippet: '  const user = await db.users.find(id);',
    occurrences_seen: 5,
    counterexamples_seen: 0,
    enforced_by_config: false,
    confidence: 0.9,
    ...over,
  };
}

const files = () => new Map([['src/api/users.ts', USERS_TS]]);

describe('isSafeRepoPath', () => {
  it('accepts ordinary repo-relative paths', () => {
    expect(isSafeRepoPath('src/api/users.ts')).toBe(true);
    expect(isSafeRepoPath('tsconfig.json')).toBe(true);
  });

  it('rejects traversal, absolute paths and NUL bytes', () => {
    expect(isSafeRepoPath('../../../../etc/passwd')).toBe(false);
    expect(isSafeRepoPath('src/../../etc/passwd')).toBe(false);
    expect(isSafeRepoPath('/etc/passwd')).toBe(false);
    expect(isSafeRepoPath('C:/Windows/System32/config')).toBe(false);
    expect(isSafeRepoPath('src\\..\\..\\etc\\passwd')).toBe(false);
    expect(isSafeRepoPath('src/api\0.ts')).toBe(false);
    expect(isSafeRepoPath('')).toBe(false);
  });
});

describe('verifyEvidence', () => {
  it('keeps a grounded candidate and RECOMPUTES its line span', () => {
    // The model claimed 1-2; the snippet actually lives on line 4.
    const { kept, dropped } = verifyEvidence([candidate()], files());
    expect(dropped).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidence_start_line).toBe(4);
    expect(kept[0]!.evidence_end_line).toBe(4);
  });

  it('grounds a multi-line snippet across its real span', () => {
    const { kept } = verifyEvidence(
      [
        candidate({
          evidence_snippet: [
            '  const user = await db.users.find(id);',
            '  const posts = await db.posts.findMany({ userId });',
          ].join('\n'),
        }),
      ],
      files(),
    );
    expect(kept[0]!.evidence_start_line).toBe(4);
    expect(kept[0]!.evidence_end_line).toBe(5);
  });

  it('tolerates re-indentation and collapsed whitespace', () => {
    const { kept } = verifyEvidence(
      [candidate({ evidence_snippet: 'const   user = await   db.users.find(id);' })],
      files(),
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidence_start_line).toBe(4);
  });

  it('drops a traversal path WITHOUT consulting the file map', () => {
    const map = files();
    // Poison the map: if the gate ever looked this path up it would "ground".
    map.set('../../../../etc/passwd', 'root:x:0:0:');
    const { kept, dropped } = verifyEvidence(
      [
        candidate({
          evidence_path: '../../../../etc/passwd',
          evidence_snippet: 'root:x:0:0:',
        }),
      ],
      map,
    );
    expect(kept).toEqual([]);
    expect(dropped[0]!.reason).toBe('unsafe_path');
  });

  it('drops a file that is not in the map', () => {
    const { kept, dropped } = verifyEvidence(
      [candidate({ evidence_path: 'src/api/ghost.ts' })],
      files(),
    );
    expect(kept).toEqual([]);
    expect(dropped[0]!.reason).toBe('file_not_found');
  });

  it('drops an invented snippet even when the file is real', () => {
    const { kept, dropped } = verifyEvidence(
      [candidate({ evidence_snippet: 'const totallyMadeUp = 42;' })],
      files(),
    );
    expect(kept).toEqual([]);
    expect(dropped[0]!.reason).toBe('snippet_not_found');
  });

  it('drops low-confidence and duplicate rules', () => {
    const { kept, dropped } = verifyEvidence(
      [candidate({ confidence: 0.2 }), candidate(), candidate({ rule: 'ALWAYS use   async/await instead of .then() chains' })],
      files(),
    );
    expect(kept).toHaveLength(1);
    expect(dropped.map((d) => d.reason)).toEqual(['low_confidence', 'duplicate_rule']);
  });
});

describe('consistencyScore — reconcile the model score with its own evidence', () => {
  it('clamps a score that contradicts the counts the model just wrote', () => {
    // "1.0 consistent" while admitting 3 of 4 files do it differently.
    expect(
      consistencyScore(candidate({ confidence: 1, occurrences_seen: 1, counterexamples_seen: 3 })),
    ).toBe(0.25);
  });

  it('never RAISES a score — a harsh self-rating is left alone', () => {
    expect(
      consistencyScore(candidate({ confidence: 0.4, occurrences_seen: 9, counterexamples_seen: 0 })),
    ).toBe(0.4);
  });

  it('exempts config-enforced rules — a lint rule holds beyond the sample', () => {
    expect(
      consistencyScore(
        candidate({
          confidence: 1,
          enforced_by_config: true,
          occurrences_seen: 1,
          counterexamples_seen: 5,
        }),
      ),
    ).toBe(1);
  });

  it('leaves the score alone when nothing was observed either way', () => {
    expect(
      consistencyScore(candidate({ confidence: 0.8, occurrences_seen: 0, counterexamples_seen: 0 })),
    ).toBe(0.8);
  });

  it('bounds a malformed score into 0..1', () => {
    expect(consistencyScore(candidate({ confidence: 4 }))).toBe(1);
    expect(consistencyScore(candidate({ confidence: -2 }))).toBe(0);
    expect(consistencyScore(candidate({ confidence: NaN }))).toBe(0);
  });
});

describe('findSnippetLines', () => {
  it('matches a partial quote of a single line', () => {
    expect(findSnippetLines(USERS_TS, 'db.users.find(id)')).toEqual({ start: 4, end: 4 });
  });

  it('returns null for an empty snippet', () => {
    expect(findSnippetLines(USERS_TS, '   \n  ')).toBeNull();
  });
});

describe('skill body assembly', () => {
  it('slugifies rules and renders evidence refs', () => {
    expect(slugify('Always use async/await instead of .then() chains')).toBe(
      'always-use-async-await-instead-of-then-chains',
    );
    // Long rules trim at a word boundary, never mid-word.
    expect(
      slugify('Normalize all API errors to a custom ApiError class with status, code and details'),
    ).toBe('normalize-all-api-errors-to-a-custom-apierror-class-with');
    expect(evidenceRef('src/a.ts', 23, 31)).toBe('src/a.ts:23-31');
    expect(evidenceRef('src/a.ts', 23, 23)).toBe('src/a.ts:23');
  });

  it('renders one section per rule, each carrying its own evidence', () => {
    const body = buildSkillBody('payments-api', [
      {
        id: '1',
        rule: 'Always use async/await instead of .then() chains',
        category: 'async',
        evidence_path: 'src/api/users.ts',
        evidence_snippet: 'const user = await db.users.find(id);',
        evidence_start_line: 23,
        evidence_end_line: 31,
        confidence: 0.91,
        accepted: true,
      },
    ]);
    expect(body).toContain('# payments-api-conventions');
    expect(body).toContain('## always-use-async-await-instead-of-then-chains');
    expect(body).toContain('Detected in `src/api/users.ts:23-31`:');
    expect(body).toContain('```ts');
  });
});
