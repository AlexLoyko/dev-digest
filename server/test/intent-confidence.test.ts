import { describe, it, expect } from 'vitest';
import type { IntentSource } from '@devdigest/shared';
import { computeConfidence, normalizeKind } from '../src/modules/intent/confidence.js';
import { MEDIUM_BODY_CHARS } from '../src/modules/intent/constants.js';

/**
 * `computeConfidence` (§1 of the L03 plan / step 7) — the rubric, computed by
 * OUR code from which sources actually RESOLVED, clamped downward by what the
 * model claims it used. Never self-reported, never raised by the model.
 *
 * The rubric collapsed from three inputs to two when L03 §1 removed
 * linked-issue resolution: `high` needs a resolved `doc`, `medium` needs
 * enough PR-body prose, everything else is `low`. `linked_issue` stays a
 * valid `IntentSourceKind` (deprecated, for rows persisted before this
 * change) but the rubric no longer grants it any weight — a fixture that
 * still carries one (`linkedIssue`, below) exercises exactly that: it must
 * be inert.
 */

const doc = (resolved: boolean): IntentSource => ({ kind: 'doc', ref: 'docs/plan.md', resolved });
const linkedIssue = (resolved: boolean): IntentSource => ({ kind: 'linked_issue', ref: '#471', resolved });
const title: IntentSource = { kind: 'pr_title', ref: 'Add rate limiting', resolved: true };
const body = (resolved: boolean): IntentSource => ({ kind: 'pr_body', ref: 'body', resolved });
const diffSrc: IntentSource = { kind: 'diff', ref: 'diff', resolved: true };

describe('computeConfidence — rubric table', () => {
  it('>= 1 doc resolved → high', () => {
    const sources = [title, doc(true), diffSrc];
    const { confidence, clamped } = computeConfidence(sources, ['pr_title', 'doc', 'diff'], 0);
    expect(confidence).toBe('high');
    expect(clamped).toBe(false);
  });

  it('a legacy resolved linked_issue source carries no weight — no doc, short body → low, not medium', () => {
    const sources = [title, linkedIssue(true), diffSrc];
    const { confidence, clamped } = computeConfidence(sources, ['pr_title', 'linked_issue'], 0);
    expect(confidence).toBe('low');
    expect(clamped).toBe(false);
  });

  it('no doc, no ticket, body >= MEDIUM_BODY_CHARS of prose → medium', () => {
    const sources = [title, body(true), diffSrc];
    const { confidence, clamped } = computeConfidence(
      sources,
      ['pr_title', 'pr_body'],
      MEDIUM_BODY_CHARS,
    );
    expect(confidence).toBe('medium');
    expect(clamped).toBe(false);
  });

  it('nothing resolved / title only / blank body → low', () => {
    const sources = [title, body(false), diffSrc];
    const { confidence, clamped } = computeConfidence(sources, ['pr_title', 'diff'], 0);
    expect(confidence).toBe('low');
    expect(clamped).toBe(false);
  });

  it('a body just under MEDIUM_BODY_CHARS stays low, not medium (boundary)', () => {
    const sources = [title, body(true), diffSrc];
    const { confidence } = computeConfidence(sources, ['pr_title', 'pr_body'], MEDIUM_BODY_CHARS - 1);
    expect(confidence).toBe('low');
  });
});

describe('computeConfidence — downward-only clamp', () => {
  it('model claiming sources_used including "doc" when NO doc actually resolved must NOT raise above what evidence supports', () => {
    // Evidence: only pr_title resolved (no doc, no ticket, short body) → low.
    // Model dishonestly claims it used a doc.
    const sources = [title, body(false)];
    const { confidence, clamped } = computeConfidence(sources, ['doc'], 0);
    expect(confidence).toBe('low');
    // The model's over-claim didn't LOWER anything below the (already low)
    // evidence band, so this is not what `clamped` tracks.
    expect(clamped).toBe(false);
  });

  it('model reporting FEWER sources than resolved must lower the band and set clamped: true', () => {
    // Evidence: a doc resolved (plus a legacy, now-inert linked_issue row) → high.
    const sources = [title, doc(true), linkedIssue(true), diffSrc];
    // Model only admits to using the title — the evidence-supported band (high)
    // must be pulled down to what the model actually claims (low).
    const { confidence, clamped } = computeConfidence(sources, ['pr_title'], 0);
    expect(confidence).toBe('low');
    expect(clamped).toBe(true);
  });

  it('model under-reporting from high evidence to medium self-report clamps to medium, clamped: true', () => {
    const sources = [title, doc(true), diffSrc];
    // fromEvidence = high (doc resolved, regardless of bodyChars). Model doesn't
    // claim the doc, but the objective bodyChars alone clears MEDIUM_BODY_CHARS,
    // so fromModel = medium → min → medium, a downward move.
    const { confidence, clamped } = computeConfidence(sources, ['pr_title'], MEDIUM_BODY_CHARS);
    expect(confidence).toBe('medium');
    expect(clamped).toBe(true);
  });

  it('code-only inference (kind "diff") never grades above low, even if claimed', () => {
    const sources = [title, body(false), diffSrc];
    const { confidence, clamped } = computeConfidence(sources, ['diff'], 0);
    expect(confidence).toBe('low');
    expect(clamped).toBe(false);
  });
});

/**
 * Regression: live PR #901 resolved a doc (its own summary quoted the
 * doc's path) yet graded `medium`, because `sources_used` is deliberately
 * free-text (`z.array(z.string())`, not the `IntentSourceKind` enum — an
 * array-of-enum schema hung generation outright against
 * openrouter/deepseek-v4-flash, see `constants.ts`/`server/INSIGHTS.md`) and
 * the old exact-match `Set` never recognised the model's actual label as
 * `doc`, so the downward clamp misread "doc unused" and lowered `high` to
 * `medium`. Fixed by `normalizeKind` mapping free-text labels onto kinds.
 */
describe('computeConfidence — regression: a resolved doc must grade high regardless of the model\'s label for it (bug found in live testing, PR #901)', () => {
  it('sources_used containing the doc\'s own PATH (as the model literally emitted on PR #901) → high, not medium', () => {
    const sources = [title, doc(true), diffSrc];
    const { confidence, clamped } = computeConfidence(
      sources,
      ['pr_title', 'docs/agent-prompts/security-reviewer.md', 'diff'],
      0,
    );
    expect(confidence).toBe('high');
    expect(clamped).toBe(false);
  });

  it('sources_used labelled "spec" for a resolved doc → high, not medium', () => {
    const sources = [title, doc(true), diffSrc];
    const { confidence, clamped } = computeConfidence(sources, ['pr_title', 'spec', 'diff'], 0);
    expect(confidence).toBe('high');
    expect(clamped).toBe(false);
  });

  it('sources_used labelled "documentation" for a resolved doc → high, not medium', () => {
    const sources = [title, doc(true), diffSrc];
    const { confidence, clamped } = computeConfidence(sources, ['pr_title', 'documentation', 'diff'], 0);
    expect(confidence).toBe('high');
    expect(clamped).toBe(false);
  });
});

describe('normalizeKind — free-text label → IntentSourceKind aliases', () => {
  it('title-ish labels → pr_title', () => {
    expect(normalizeKind('pr_title')).toBe('pr_title');
    expect(normalizeKind('PR title')).toBe('pr_title');
    expect(normalizeKind('Title')).toBe('pr_title');
  });

  it('body/description labels → pr_body', () => {
    expect(normalizeKind('pr_body')).toBe('pr_body');
    expect(normalizeKind('PR description')).toBe('pr_body');
    expect(normalizeKind('body')).toBe('pr_body');
  });

  it('diff/code/patch labels → diff', () => {
    expect(normalizeKind('diff')).toBe('diff');
    expect(normalizeKind('code')).toBe('diff');
    expect(normalizeKind('patch')).toBe('diff');
    expect(normalizeKind('the code digest')).toBe('diff');
  });

  it('doc/spec/plan/*.md labels → doc', () => {
    expect(normalizeKind('doc')).toBe('doc');
    expect(normalizeKind('spec')).toBe('doc');
    expect(normalizeKind('plan')).toBe('doc');
    expect(normalizeKind('docs/agent-prompts/security-reviewer.md')).toBe('doc');
    expect(normalizeKind('design doc')).toBe('doc');
  });

  it('an unrecognised label returns undefined and is simply ignored', () => {
    expect(normalizeKind('something else entirely')).toBeUndefined();
    expect(normalizeKind('')).toBeUndefined();
    expect(normalizeKind('   ')).toBeUndefined();
  });
});

describe('normalizeKind — issue/ticket labels are no longer mapped (L03 §1 removed linked-issue resolution)', () => {
  it('the linked_issue alias arm is gone: issue/ticket-shaped labels now return undefined', () => {
    expect(normalizeKind('linked_issue')).toBeUndefined();
    expect(normalizeKind('issue')).toBeUndefined();
    expect(normalizeKind('ticket')).toBeUndefined();
    expect(normalizeKind('Linked ticket #471')).toBeUndefined();
  });
});

/**
 * The safety property that makes generous normalisation safe BY
 * CONSTRUCTION: `normalizeKind` can widen what counts as "used", but the
 * result only ever feeds the downward `Math.min` against the OBJECTIVE
 * resolved-evidence rubric — so a false positive can never raise the band
 * above what actually resolved, no matter how liberally the label is read.
 */
describe('computeConfidence — safety property: normalization can never raise the band above the resolved evidence', () => {
  it('no doc resolved (evidence caps at medium via a long body), model claims "doc" → still medium, never high', () => {
    const sources = [title, body(true)];
    const { confidence, clamped } = computeConfidence(
      sources,
      ['doc', 'spec', 'documentation'],
      MEDIUM_BODY_CHARS,
    );
    expect(confidence).toBe('medium');
    expect(clamped).toBe(false);
  });

  it('no doc, no ticket, short body (evidence caps at low), model claims "doc"/"spec" → still low, never high or medium', () => {
    const sources = [title, body(false)];
    const { confidence, clamped } = computeConfidence(sources, ['doc', 'spec', 'plan', 'documentation'], 0);
    expect(confidence).toBe('low');
    expect(clamped).toBe(false);
  });
});
