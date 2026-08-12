import type { Intent } from '@devdigest/shared';

/**
 * Build the INNER payload string for reviewer-core's `## Derived intent
 * (advisory)` prompt slot. reviewer-core owns the heading and the untrusted
 * wrapper (`assemblePrompt` / `wrapUntrusted('intent', …)`); this module only
 * produces what goes inside it.
 *
 * The confidence line always names which sources were used and which were
 * missing, so a weak hint self-discloses to the model. When the intent was
 * inferred purely from the diff (no doc, ticket, or substantive body — the
 * only resolved evidence is source kind `diff`), the line says so explicitly.
 * That disclosure mitigates circular anchoring (plan Risk R9): the reviewer
 * must not mistake our own reading of the code for a statement of intent.
 */
export function renderIntentBlock(intent: Intent): string {
  const resolved = intent.sources.filter((s) => s.resolved);
  const missing = intent.sources.filter((s) => !s.resolved);

  const label = (kind: string): string => {
    switch (kind) {
      case 'pr_title':
        return 'PR title';
      case 'pr_body':
        return 'PR description';
      case 'doc':
        return 'linked plan or spec doc';
      case 'diff':
        return 'the diff itself';
      default:
        return kind;
    }
  };

  const nonDiffResolved = resolved.filter((s) => s.kind !== 'diff');
  const inferredFromDiff = nonDiffResolved.length === 0;

  const confidenceLine = inferredFromDiff
    ? `Confidence: ${intent.confidence} — INFERRED FROM THE DIFF; the author gave no ` +
      'description, ticket, or spec. Treat this as our own reading of the code, not as ' +
      'a statement of intent.'
    : `Confidence: ${intent.confidence} — based on: ${resolved.map((s) => label(s.kind)).join(', ')}` +
      (missing.length > 0 ? `. Not found: ${missing.map((s) => label(s.kind)).join(', ')}.` : '.');

  // The block is newline-delimited `Key: value` prose, and every value below is
  // model output steered by an attacker-controlled PR body. A surviving newline
  // forges a sibling line INSIDE the block the reviewer's trusted scope
  // instruction points at — e.g. an extra `Out of scope:` section, or a
  // `Confidence: high — based on: linked plan or spec doc.` line that overrides
  // the band `confidence.ts` computed and defeats its downward clamp. Collapse
  // all whitespace so a value can only ever be one line.
  const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

  // Scope suppression is gated on confidence. A `low` band means nothing but the
  // diff resolved — the block itself says "our own reading of the code, not a
  // statement of intent" — so letting it silence findings would give the
  // least-evidenced classification the same force as a doc-grounded one, and
  // would make the whole confidence computation buy nothing downstream.
  const scopeIsActionable = intent.confidence !== 'low';

  const lines = [
    `Type: ${oneLine(intent.type)}`,
    `Summary: ${oneLine(intent.intent)}`,
    'In scope:',
    ...(intent.in_scope.length > 0
      ? intent.in_scope.map((s) => `- ${oneLine(s)}`)
      : ['- (none stated)']),
    ...(scopeIsActionable
      ? [
          'Out of scope:',
          ...(intent.out_of_scope.length > 0
            ? intent.out_of_scope.map((s) => `- ${oneLine(s)}`)
            : ['- (none stated)']),
        ]
      : [
          'Out of scope: (withheld — confidence is low, so this scope statement is not ' +
            'reliable enough to narrow the review; review every changed file normally)',
        ]),
    oneLine(confidenceLine),
  ];

  return lines.join('\n');
}
