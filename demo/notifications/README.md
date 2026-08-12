# Demo fixture — notification service

**This is not part of DevDigest.** It exists only to give the review agents and the
Smart Diff view a realistic, self-contained change to work on.

It lives at the repo root under `demo/`, which is outside every package and outside
every CI workflow's `paths:` filter (`client/**`, `server/**`, `reviewer-core/**`,
`e2e/**`) — so nothing here is built, typechecked, linted, or tested.

## What it models

A small service that fans one event out to a subscriber's enabled channels.

| File | Role |
|---|---|
| `src/dispatcher.ts` | fan-out, per-channel delivery, batch summary |
| `src/templates.ts` | event kind → subject + body |
| `src/retry.ts` | backoff for transient transport failures |
| `src/routes.ts` | HTTP surface |
| `src/config.ts` | env-backed settings |
| `src/index.ts` | public exports |

## Do not merge

Any pull request built on this fixture is a demo. It is never intended to land on
`main`, and the code is written to be *reviewable*, not to be correct.
