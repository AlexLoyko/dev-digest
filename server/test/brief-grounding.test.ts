import { describe, it, expect } from 'vitest';
import type { PrBrief, Risk, ReviewFocusEntry } from '@devdigest/shared';
import { groundBrief } from '../src/modules/brief/grounding.js';

function risk(partial: Partial<Risk>): Risk {
  return {
    kind: 'other',
    title: 'r',
    explanation: 'e',
    severity: 'medium',
    file_refs: [{ path: 'src/real.ts' }],
    ...partial,
  };
}

function focus(partial: Partial<ReviewFocusEntry>): ReviewFocusEntry {
  return {
    file: { path: 'src/real.ts' },
    reason: 'because',
    ...partial,
  };
}

function brief(partial: Partial<PrBrief>): PrBrief {
  return {
    what: 'w',
    why: 'y',
    risk_level: 'medium',
    risks: [],
    review_focus: [],
    ...partial,
  };
}

describe('groundBrief', () => {
  it('keeps a risk file_ref that names a real changed path and drops an invented one', () => {
    const input = brief({
      risks: [
        risk({
          file_refs: [{ path: 'src/real.ts' }, { path: 'src/invented.ts' }],
        }),
      ],
    });

    const { brief: out, dropped } = groundBrief(input, ['src/real.ts']);

    expect(out.risks).toHaveLength(1);
    expect(out.risks[0].file_refs).toEqual([{ path: 'src/real.ts' }]);
    expect(dropped).toContainEqual({ kind: 'risk_file_ref', detail: 'src/invented.ts' });
  });

  it('dedupes review-focus entries by path:start_line, first occurrence wins', () => {
    const first = focus({ file: { path: 'src/real.ts', start_line: 10 }, reason: 'first' });
    const second = focus({ file: { path: 'src/real.ts', start_line: 10 }, reason: 'second' });
    const input = brief({ review_focus: [first, second] });

    const { brief: out } = groundBrief(input, ['src/real.ts']);

    expect(out.review_focus).toEqual([first]);
  });

  it('drops a risk entirely when its only file ref is invented (AC-4 needs >=1)', () => {
    const input = brief({
      risks: [risk({ title: 'bad', file_refs: [{ path: 'src/invented.ts' }] })],
    });

    const { brief: out, dropped } = groundBrief(input, ['src/real.ts']);

    expect(out.risks).toHaveLength(0);
    expect(dropped).toContainEqual({ kind: 'risk', detail: 'bad' });
  });

  it('drops a review-focus entry whose file is not in changedPaths', () => {
    const input = brief({
      review_focus: [focus({ file: { path: 'src/invented.ts' } })],
    });

    const { brief: out, dropped } = groundBrief(input, ['src/real.ts']);

    expect(out.review_focus).toHaveLength(0);
    expect(dropped).toContainEqual({ kind: 'review_focus_entry', detail: 'src/invented.ts' });
  });

  it('preserves input order among surviving entries', () => {
    const a = focus({ file: { path: 'a.ts' }, reason: 'a' });
    const b = focus({ file: { path: 'b.ts' }, reason: 'b' });
    const c = focus({ file: { path: 'c.ts' }, reason: 'c' });
    const input = brief({ review_focus: [c, a, b] });

    const { brief: out } = groundBrief(input, ['a.ts', 'b.ts', 'c.ts']);

    expect(out.review_focus).toEqual([c, a, b]);
  });

  it('returns empty risks and review_focus with zero changed files, without throwing', () => {
    const input = brief({
      risks: [risk({})],
      review_focus: [focus({})],
    });

    expect(() => groundBrief(input, [])).not.toThrow();
    const { brief: out } = groundBrief(input, []);
    expect(out.risks).toEqual([]);
    expect(out.review_focus).toEqual([]);
  });

  it('does not mutate the input brief', () => {
    const input = brief({
      risks: [risk({ file_refs: [{ path: 'src/real.ts' }, { path: 'src/invented.ts' }] })],
    });
    const snapshot = JSON.parse(JSON.stringify(input));

    groundBrief(input, ['src/real.ts']);

    expect(input).toEqual(snapshot);
  });
});
