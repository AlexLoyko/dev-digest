/**
 * Review module constants.
 */

/**
 * Studio review strategy. 'single-pass' = send the WHOLE diff in ONE LLM call.
 * We deliberately do NOT use 'auto'/map-reduce by default: map-reduce makes one
 * call PER FILE, which is slow and fragile (any single file's transient 5xx
 * fails the entire run) and unnecessary — the whole diff already fits the
 * model's context.
 */
export const REVIEW_STRATEGY = 'single-pass' as const;

// ---- Smart Diff (L03) ------------------------------------------------------

/** A PR past either threshold gets the "consider splitting this" nudge. */
export const SPLIT_TOO_BIG_LINES = 400;
export const SPLIT_TOO_BIG_FILES = 12;

/**
 * Defensive cap on how many lines ONE finding may mark. A model can emit
 * `start_line: 1, end_line: 99999`; without this, one bad finding allocates a
 * 99999-element array and paints a whole file as findings.
 */
export const MAX_FINDING_LINE_SPAN = 500;

/**
 * Generated / mechanical files — skim, don't review. Tested FIRST, which is
 * what keeps `dist/index.ts` boilerplate rather than wiring.
 *
 * Tests are in here deliberately. They are not generated, but they are not the
 * substance of the change either, and they are the single biggest source of
 * changed lines in this repo — leaving them in `core` put a 746-line
 * `intent-service.test.ts` above the 233-line service it tests, which is
 * exactly backwards for a "review closely" bucket.
 */
export const BOILERPLATE_RE =
  /(package\.json|package-lock|pnpm-lock|yarn\.lock|tsconfig|\.lock$|\.snap$|\.md$|license|\.gitignore|dist\/|\.generated\.|migrations?\/|\.(test|spec)\.[tj]sx?$|(^|\/)(__tests__|tests?)\/)/i;

/** Files that hook the core into the app rather than carrying behaviour. */
export const WIRING_RE = /(index\.(ts|tsx|js)$|routes?\.|config\.|\.module\.|setup\.|register|barrel)/i;
