# INSIGHTS — `@devdigest/reviewer-core`

Non-obvious things learned the hard way. **Append newest-first; never rewrite or
delete.** When an entry stops being true, mark it `[resolved YYYY-MM-DD]` and say what
changed — the history is the value.

Each entry: a dated title, the trap, the fix, and a `file:line` or commit reference.

---

## 2026-07-31 — npm, not pnpm — and its `node_modules` is the API's boot dependency

This package has a `package-lock.json` while `server`/`client` use pnpm. It also never
emits JS (`build` is `tsc --noEmit`); the server imports `src/` directly through a
tsconfig alias. So a missing `reviewer-core/node_modules` crashes the **API** at boot
with `ERR_MODULE_NOT_FOUND`, with nothing in `server/package.json` to hint at why.
→ `scripts/dev.sh` runs `npm ci` here (commit `66727c8`).

## 2026-07-31 — `zod` is hard-pinned to this package's own `node_modules`

`tsconfig.json` maps `zod` and `zod/*` explicitly, to keep type identity stable when
this source is compiled inside the server's program. Duplicate zod instances are a real
problem in this repo — they are why `instanceof z.ZodError` is unreliable on the server
(`server/src/app.ts:135-142`). Don't remove that mapping to "clean up" the tsconfig.

## 2026-07-31 — `@devdigest/shared` here resolves to the SERVER's copy

`tsconfig.json:22-23` points `@devdigest/shared` at `../server/src/vendor/shared`. There
is no shared copy inside this package. Changing a contract for the engine means editing
the server's files — and then mirroring into `client/src/vendor/shared/`, which has
already drifted. `reviewer-core.yml` includes `server/src/vendor/shared/**` in its CI
path filter for exactly this reason.

## 2026-07-31 — a run that drops every finding is a success, not a failure

`groundFindings()` drops any finding that doesn't cite a real line in the diff, and the
score is then recomputed from the survivors — the model's self-reported score is
discarded entirely. A model that hallucinated all of its locations yields a completed
run with zero findings and a clean verdict. Read the grounding summary (`N/M passed`)
before concluding the model "found nothing".

## 2026-06-14 — `ReviewOutcome` already carries cost; never recompute it

`reviewPullRequest` returns `tokensIn` / `tokensOut` / `costUsd` on `ReviewOutcome`, so a
consumer that wants cost READS it from the outcome — recomputing means extra model calls
for a number you already have. Cost accumulates per chunk and collapses to `null` if ANY
chunk lacked one (deliberately conservative). The OpenRouter provider prefers the real
`usage.cost` and only falls back to `estimateCost`.
`reviewer-core/src/review/run.ts:110,184` · `src/llm/openrouter.ts`.
