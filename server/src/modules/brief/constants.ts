/**
 * constants.ts — fixed numeric/version constants for the brief module.
 *
 * Onion layer: pure constants, no I/O.
 */

/** Token budget the assembled brief prompt must fit within (AC-14). */
export const BRIEF_TOKEN_BUDGET = 8000;

/** Cap on PR description characters included in the prompt (mirrors
 *  `platform/prompt.ts`'s `MAX_PR_DESCRIPTION_CHARS`, kept local so this
 *  module never imports reviewer-core's internal constant directly). */
export const MAX_PR_DESCRIPTION_CHARS = 4000;

/** Cap on linked-issue body characters included in the prompt. */
export const MAX_ISSUE_BODY_CHARS = 4000;

/** Current schema version of the stored brief envelope (`StoredBrief.schema_version`). */
export const BRIEF_SCHEMA_VERSION = 1;
