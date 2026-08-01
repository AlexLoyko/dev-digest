# `e2e/docs` — long-form documentation

Durable documentation that is too big for [`../README.md`](../README.md): deep dives,
runbooks, and decision records. The reader is a human onboarding, or an agent doing
research before a change.

**Not here:**

| Goes elsewhere | Where | Why |
|---|---|---|
| Non-obvious traps and hard-won lessons | [`../INSIGHTS.md`](../INSIGHTS.md) | dated append-log, not curated prose |
| Anything an agent needs on every task | [`../CLAUDE.md`](../CLAUDE.md) | that file loads constantly — keep it short |
| Flow format, locator rules, how to run | [`../README.md`](../README.md) | already documented there |

> This package has **no `specs/` directory in the repo-wide sense**.
> [`../specs/`](../specs/) holds the `*.flow.json` browser flows, which are consumed by
> `run.ts`. A forward-looking feature spec for a journey belongs in the package that
> owns the feature (`server/specs/`, `client/specs/`).

## Index

_Nothing here yet._ Add one markdown file per topic, kebab-cased
(`flakiness-playbook.md`, `ci-stack-boot.md`), and list it here with a one-line
summary.
