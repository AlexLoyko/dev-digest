# `server/docs` — long-form documentation

Durable documentation that is too big for [`../README.md`](../README.md): deep dives,
runbooks, and decision records. The reader is a human onboarding, or an agent doing
research before a change.

**Not here:**

| Goes elsewhere | Where | Why |
|---|---|---|
| Forward-looking feature specs | [`../specs/`](../specs/) | written *before* the code; a spec is intent, not documentation |
| Non-obvious traps and hard-won lessons | [`../INSIGHTS.md`](../INSIGHTS.md) | dated append-log, not curated prose |
| Anything an agent needs on every task | [`../CLAUDE.md`](../CLAUDE.md) | that file loads constantly — keep it short |
| Architecture overview, env table, API map | [`../README.md`](../README.md) | already documented there |

## Related deep dives already in the tree

- [`../src/modules/repo-intel/README.md`](../src/modules/repo-intel/README.md) — the
  codebase indexer: pipeline, the `repoIntel.*` facade, full vs incremental indexing.
  It lives next to the code deliberately and stays there.
- [`../../docs/agent-prompts/README.md`](../../docs/agent-prompts/README.md) — how a
  review agent's system prompt becomes the messages a model sees.

## Index

_Nothing here yet._ Add one markdown file per topic, kebab-cased
(`run-lifecycle.md`, `secrets-and-keys.md`), and list it here with a one-line summary.
