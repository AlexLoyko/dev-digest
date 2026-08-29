/**
 * Shared token/cost formatting — the product's single convention for rendering
 * token volumes and USD spend. Originally defined in RunTraceDrawer/helpers.ts;
 * lifted here once a second consumer needed it (AC-22).
 *
 * The lowercase `k` suffix ("8k→1.3k") is the established product convention
 * and wins over any uppercase form shown in design assets — see spec Q-8 and
 * design/design-notes.md for the supersession record. Do not "correct" it.
 */

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}

/** USD cost or "n/a". */
export function formatCost(usd: number | null | undefined): string {
  return usd == null ? "n/a" : `$${usd.toFixed(3)}`;
}
