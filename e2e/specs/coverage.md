# Spec: E2E Coverage

What is covered, what is not, and why.

## Covered Flows (L01)

| Flow | File | What it verifies |
|------|------|-----------------|
| `boot` | `flows/boot.json` | App loads at `/`, no JS crash, page title renders |
| `repo-list` | `flows/repo-list.json` | Repos page shows seeded `acme/payments-api` |
| `repo-detail` | `flows/repo-detail.json` | PR list loads for the seeded repo |
| `agents` | `flows/agents.json` | Agents page renders both seeded agents |
| `findings` | `flows/findings.json` | PR detail page shows findings after a review |
| `diff` | `flows/diff.json` | Diff view renders for the seeded PR |
| `onboarding` | `flows/onboarding.json` | Onboarding wizard loads and first step renders |
| `settings` | `flows/settings.json` | Settings page loads, provider selector visible |
| `project-context` | `specs/08-project-context.flow.json` | Project Context: seeded document (`specs/public-api.md`) renders read-only with its H1 body; page text excludes any Upload/Delete/Edit control (AC-2); re-scan settles to the "files indexed" status line, not the spinner; second seeded repo (`acme/docs-portal`, null clone path) shows the not-cloned empty state. Does **not** cover the root-only-clone empty-state leg (EC-2) — no seeded repo is cloned with zero matching specs/docs/insights files. |

## What Is Not Covered

| Scenario | Why not covered |
|----------|----------------|
| Actually running a review end-to-end | Requires LLM API keys — non-deterministic, not suitable for e2e |
| Creating a new repo via UI | Requires GitHub token + live repo — non-deterministic |
| Importing PRs | Requires GitHub API — non-deterministic |
| Error states (API down, bad key) | Would require killing the server mid-flow — complex setup |
| Mobile / responsive layout | agent-browser runs at desktop viewport only |

## Coverage Principles

E2E tests cover **rendering and navigation** — that the right data appears on the right page given the seeded state. They do not cover **business logic** — that is covered by server unit/integration tests and reviewer-core tests.

The goal is to catch: broken routes, missing components, failed API connections, and deployment regressions. Not to duplicate unit test assertions.

## Seed Dependency

All flows depend on the demo seed (`pnpm db:seed`):
- Repo: `acme/payments-api`
- PR: `#482`
- Agents: `General Reviewer` and `Security Reviewer`

If the seed changes, flow assertions that check for these values must be updated.

## Adding Coverage for a New Feature

When a new lesson adds a new page or significant UI feature:
1. Add a flow that verifies the page renders with seeded data
2. Do not add flows for features that require external API calls (LLM, GitHub)
3. Add the `data-testid` attributes to new components before writing the flow
