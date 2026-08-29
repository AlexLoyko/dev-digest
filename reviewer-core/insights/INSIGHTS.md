# reviewer-core Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-06-22 — `PromptAssembly` is a FIXED Zod shape (not a bag of arbitrary keys). When adding a new prompt section (like `intent`), do NOT add a field to `PromptAssembly` — it is a named-slot trace contract stored in `run_traces`. New sections render in the assembled `user` string (and thus appear in `assembly.user`) without needing their own `PromptAssembly` field. ref: server/src/vendor/shared/contracts/trace.ts:39

2026-06-22 — Adding an optional prompt section that is omit-when-empty is the established pattern: check `parts.X && parts.X.trim().length > 0` before pushing to `userSections`, and wrap the content with `wrapUntrusted('label', parts.X)`. The existing `callers`, `repoMap`, and `prDescription` fields all follow this pattern. ref: reviewer-core/src/prompt.ts:115

## What Doesn't Work

## Codebase Patterns

2026-06-22 — New `PromptParts` fields should be added between `callers` and `diff` (not after `diff`) when the intent is to provide context before the diff. The rendering order in `assemblePrompt` follows the field declaration order in `PromptParts` conceptually: skills → memory → repoMap → specs → callers → [new context] → diff. ref: reviewer-core/src/prompt.ts:111

2026-06-22 — `INJECTION_GUARD` already names "derived intent/scope" as untrusted content. Do NOT add new text about intent to the guard — it would duplicate the existing coverage and bloat the system prompt on every review. ref: reviewer-core/src/prompt.ts:16

2026-08-28 — `PromptAssembly.specs` (persisted into `RunTrace.prompt_assembly.specs`) never contains the `## Project context` heading — `assemblePrompt` builds `specsBlock` via `buildProjectContextSection` (delimited blocks only) and stores THAT in `assembly.specs`; the heading is prepended only when the block is spliced into the `user` message string (`## Project context\n${specsBlock}`), which is never persisted as a separate field. Any code or UI that expects `assembly.specs` / `trace.prompt_assembly.specs` to start with the heading is wrong — the run drawer's "Project context — attached specs (untrusted)" text is a client-only label (`client/messages/en/runs.json`'s `trace.prompt.specs`) rendered next to the block, not part of it. This distinction has already tripped up agents working on the project-context feature. ref: reviewer-core/src/prompt.ts:143-163

## Tool & Library Notes

## Recurring Errors & Fixes

2026-06-22 — `npm run typecheck` in reviewer-core fails with "Invalid character" errors in `server/src/vendor/shared/contracts/platform.ts` if that file contains smart/curly apostrophes (U+2018/U+2019) inside a single-quoted TypeScript string. TypeScript treats the curly quote as a non-ASCII character, not a string delimiter match, causing a cascade of parse errors. Fix: replace the smart apostrophe with a regular ASCII apostrophe (') or switch the string delimiter to double-quotes. ref: server/src/vendor/shared/contracts/platform.ts:54

## Session Notes

2026-06-22 — T1 intent layer prompt seam: added `intent?: string` to `PromptParts` and `ReviewInput`, added `## Intent` section rendering between callers and diff in `assemblePrompt`, threaded `intent` through `promptParts` in `reviewPullRequest`. Also fixed pre-existing smart-apostrophe parse error in `platform.ts:54` that blocked all typecheck. Files: reviewer-core/src/prompt.ts, reviewer-core/src/review/run.ts, server/src/vendor/shared/contracts/platform.ts.

## Open Questions
