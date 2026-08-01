# `client/docs` — long-form documentation

Durable documentation that is too big for [`../README.md`](../README.md): deep dives,
runbooks, and decision records. The reader is a human onboarding, or an agent doing
research before a change.

**Not here:**

| Goes elsewhere | Where | Why |
|---|---|---|
| Forward-looking feature specs | [`../specs/`](../specs/) | written *before* the code; a spec is intent, not documentation |
| Non-obvious traps and hard-won lessons | [`../INSIGHTS.md`](../INSIGHTS.md) | dated append-log, not curated prose |
| Anything an agent needs on every task | [`../CLAUDE.md`](../CLAUDE.md) | that file loads constantly — keep it short |
| Route map, stack, testing setup | [`../README.md`](../README.md) | already documented there |

## Related deep dives already in the tree

- [`../src/vendor/ui/README.md`](../src/vendor/ui/README.md) — the vendored UI kit.
  Check it before writing a new primitive.

## Index

_Nothing here yet._ Add one markdown file per topic, kebab-cased
(`data-fetching.md`, `theming.md`), and list it here with a one-line summary.
