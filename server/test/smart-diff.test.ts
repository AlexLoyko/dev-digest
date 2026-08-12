import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import { buildSmartDiff, classifyFile } from '../src/modules/reviews/smart-diff.js';
import { MAX_FINDING_LINE_SPAN } from '../src/modules/reviews/constants.js';

/**
 * Smart Diff (L03) — the pure grouping/ordering logic.
 *
 * Hermetic by construction: `buildSmartDiff` takes rows and returns a document,
 * so there is no container, no DB, and nothing to mock. Acceptance criteria come
 * from `specs/0003-smart-diff.md`.
 */

const file = (path: string, additions = 10, deletions = 0) => ({ path, additions, deletions });
const finding = (f: string, startLine: number | null, endLine: number | null = startLine) => ({
  file: f,
  startLine,
  endLine,
});

describe('classifyFile', () => {
  it.each([
    ['src/middleware/ratelimit.ts', 'core'],
    ['src/api/public/webhooks.ts', 'core'],
    ['src/api/public/index.ts', 'wiring'],
    ['src/routes.ts', 'wiring'],
    ['src/config.ts', 'wiring'],
    ['src/app.module.ts', 'wiring'],
    ['package.json', 'boilerplate'],
    ['pnpm-lock.yaml', 'boilerplate'],
    ['tsconfig.json', 'boilerplate'],
    ['README.md', 'boilerplate'],
    ['LICENSE', 'boilerplate'],
    ['src/__snapshots__/a.snap', 'boilerplate'],
    ['db/migrations/0001_init.sql', 'boilerplate'],
    ['src/api.generated.ts', 'boilerplate'],
  ])('%s → %s', (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it('tests boilerplate BEFORE wiring — dist/index.ts is generated, not wiring', () => {
    // Both patterns match this path; order is what decides it.
    expect(classifyFile('dist/index.ts')).toBe('boilerplate');
  });

  it.each([
    'server/test/intent-service.test.ts',
    'src/lib/helpers.spec.ts',
    'src/__tests__/thing.tsx',
    'test/setup.ts',
    'tests/e2e/flow.js',
  ])('%s is boilerplate — not the substance of the change', (path) => {
    // Tests are the biggest source of changed lines here; in `core` they sort
    // above the code they test, which is backwards for "review closely".
    expect(classifyFile(path)).toBe('boilerplate');
  });

  it('does not mistake a path merely CONTAINING "test" for a test file', () => {
    expect(classifyFile('src/latest/value.ts')).toBe('core');
    expect(classifyFile('src/contest.ts')).toBe('core');
  });

  it('is case-insensitive', () => {
    expect(classifyFile('LICENSE.MD')).toBe('boilerplate');
    expect(classifyFile('src/Config.ts')).toBe('wiring');
  });
});

describe('buildSmartDiff — shape', () => {
  it('returns a document the SmartDiff contract accepts', () => {
    const doc = buildSmartDiff(
      [file('src/a.ts', 84, 0), file('package.json', 3, 1)],
      [finding('src/a.ts', 28, 30)],
    );
    expect(() => SmartDiff.parse(doc)).not.toThrow();
  });

  it('always sets pseudocode_summary to null — it needs a model, which is out of scope', () => {
    const doc = buildSmartDiff([file('src/a.ts')], []);
    expect(doc.groups[0]!.files[0]!.pseudocode_summary).toBeNull();
  });

  it('handles a PR with no changed files', () => {
    const doc = buildSmartDiff([], []);
    expect(doc.groups).toEqual([]);
    expect(doc.split_suggestion).toEqual({
      too_big: false,
      total_lines: 0,
      proposed_splits: [],
    });
  });
});

describe('buildSmartDiff — finding_lines', () => {
  it('is empty for every file when no review has run yet', () => {
    const doc = buildSmartDiff([file('src/a.ts'), file('src/b.ts')], []);
    const lines = doc.groups.flatMap((g) => g.files.map((f) => f.finding_lines));
    expect(lines).toEqual([[], []]);
  });

  it('expands start..end inclusive', () => {
    const doc = buildSmartDiff([file('src/a.ts')], [finding('src/a.ts', 28, 30)]);
    expect(doc.groups[0]!.files[0]!.finding_lines).toEqual([28, 29, 30]);
  });

  it('dedupes overlapping findings and sorts ascending', () => {
    const doc = buildSmartDiff(
      [file('src/a.ts')],
      [finding('src/a.ts', 28, 30), finding('src/a.ts', 29, 31), finding('src/a.ts', 5)],
    );
    expect(doc.groups[0]!.files[0]!.finding_lines).toEqual([5, 28, 29, 30, 31]);
  });

  it('skips a finding with no start line — it anchors to nothing', () => {
    const doc = buildSmartDiff([file('src/a.ts')], [finding('src/a.ts', null, 30)]);
    expect(doc.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });

  it('collapses an inverted range to the start line rather than emitting nothing', () => {
    const doc = buildSmartDiff([file('src/a.ts')], [finding('src/a.ts', 30, 12)]);
    expect(doc.groups[0]!.files[0]!.finding_lines).toEqual([30]);
  });

  it('clamps an absurd span — one bad finding cannot paint a whole file', () => {
    const doc = buildSmartDiff([file('src/a.ts')], [finding('src/a.ts', 1, 99999)]);
    const lines = doc.groups[0]!.files[0]!.finding_lines;
    expect(lines).toHaveLength(MAX_FINDING_LINE_SPAN);
    expect(lines.at(-1)).toBe(MAX_FINDING_LINE_SPAN);
  });

  it('ignores findings whose file is not in the diff', () => {
    const doc = buildSmartDiff([file('src/a.ts')], [finding('src/gone.ts', 4)]);
    expect(doc.groups[0]!.files[0]!.finding_lines).toEqual([]);
  });
});

describe('buildSmartDiff — grouping and order', () => {
  it('emits groups in the fixed order core → wiring → boilerplate', () => {
    const doc = buildSmartDiff(
      [file('package.json'), file('src/index.ts'), file('src/logic.ts')],
      [],
    );
    expect(doc.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
  });

  it('omits a role with no files rather than emitting it empty', () => {
    const doc = buildSmartDiff([file('src/logic.ts'), file('package.json')], []);
    expect(doc.groups.map((g) => g.role)).toEqual(['core', 'boilerplate']);
  });

  it('sorts a file with findings above a larger file without them', () => {
    const doc = buildSmartDiff(
      [file('src/big.ts', 500, 0), file('src/small.ts', 3, 0)],
      [finding('src/small.ts', 7)],
    );
    expect(doc.groups[0]!.files.map((f) => f.path)).toEqual(['src/small.ts', 'src/big.ts']);
  });

  it('falls back to change size, then path, so the order is deterministic', () => {
    const doc = buildSmartDiff(
      [file('src/b.ts', 5, 0), file('src/a.ts', 5, 0), file('src/c.ts', 40, 0)],
      [],
    );
    expect(doc.groups[0]!.files.map((f) => f.path)).toEqual([
      'src/c.ts',
      'src/a.ts',
      'src/b.ts',
    ]);
  });
});

describe('buildSmartDiff — split nudge', () => {
  it('counts total_lines as additions + deletions across every file', () => {
    const doc = buildSmartDiff([file('src/a.ts', 200, 47), file('package.json', 30, 8)], []);
    expect(doc.split_suggestion.total_lines).toBe(285);
    expect(doc.split_suggestion.too_big).toBe(false);
  });

  it('trips on line count: 401 is too big, 400 is not', () => {
    expect(buildSmartDiff([file('src/a.ts', 400, 0)], []).split_suggestion.too_big).toBe(false);
    expect(buildSmartDiff([file('src/a.ts', 400, 1)], []).split_suggestion.too_big).toBe(true);
  });

  it('trips on file count: 13 is too big, 12 is not', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => file(`src/f${i}.ts`, 1, 0));
    expect(buildSmartDiff(many(12), []).split_suggestion.too_big).toBe(false);
    expect(buildSmartDiff(many(13), []).split_suggestion.too_big).toBe(true);
  });

  it('proposes one split per non-empty group, and none when not too big', () => {
    const small = buildSmartDiff([file('src/a.ts', 1, 0)], []);
    expect(small.split_suggestion.proposed_splits).toEqual([]);

    const big = buildSmartDiff([file('src/a.ts', 300, 0), file('package.json', 200, 0)], []);
    expect(big.split_suggestion.proposed_splits).toEqual([
      { name: 'core', files: ['src/a.ts'] },
      { name: 'boilerplate', files: ['package.json'] },
    ]);
  });
});
