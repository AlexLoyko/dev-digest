/**
 * blast module constants.
 *
 * MAX_CALLERS_PER_SYMBOL is intentionally applied PER changed symbol (not
 * across the whole result) — this is the fix for the repo-intel bug where
 * `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` sliced a flat list across ALL
 * symbols, starving later symbols of their own callers.
 */
export const MAX_CALLERS_PER_SYMBOL = 20;
export const MAX_DEPTH = 2;
export const MAX_FACTS_PER_SYMBOL = 20;
export const MAX_PRIOR_PRS = 5;
