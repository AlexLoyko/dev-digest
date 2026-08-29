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
| `context-tabs-and-trace` | `specs/09-context-tabs-and-trace.flow.json` | **Partially passing — see note below.** Agent Context tab: seeded attachments (`security-baseline.md`, `public-api.md`, `deleted-doc.md`) render, "missing in repo" badge appears for the deliberately-deleted fixture (EC-7), footer token-total line renders. Skill Context tab: the "SERIALIZES AS" preview panel contains the real `## Project context` heading and the `<untrusted source="spec:` delimiter, scoped to the panel's own `pre.mono` element (AC-9). Run drawer leg does not currently pass — see below. |
| `pr-brief` | `specs/10-pr-brief.flow.json` | PR #482 Overview tab (default tab, no click needed): the seeded, non-stale brief (`server/src/db/seed.ts`'s `seedBrief`, `head_sha` pinned to the PR's own `headSha`) renders its "what" prose in the brief card, the risk title "Auth surface touched" in the Intent card's Risk areas section, and the review-focus location "src/config.ts:12" in the Review focus card. Final `get text body` / `stdoutExcludes` step asserts the page never shows the generating-state headline ("Generating brief", `brief.json` `card.generating.headline`). **Limitation, stated plainly:** a browser flow can only observe rendered DOM, not network traffic the server made — this flow proves the seeded prose renders and the card never enters the generating state for a non-stale brief; it does **not** and cannot prove that zero model calls occurred (AC-1's "without making a model call"). That guarantee is proved by `server/test/brief-routes.it.test.ts` against a call-counting stub, not by this flow. The root-redirect check right after the opening `open {BASE}/` step asserts via `wait --text "Pull Requests"` (DOM-polled) rather than `wait --load networkidle` — on a warm dev server the redirect's fetch can settle before a fresh `networkidle` listener attaches, so that wait hangs to its timeout even though the page already redirected correctly; the text wait doesn't have that race and keeps this flow's first assertion true regardless of what the immediately preceding flow (09, currently failing) left the browser doing. |

<!-- updated from: e2e/specs/09-context-tabs-and-trace.flow.json, docs/plans/project-context.run.md -->

### `09-context-tabs-and-trace` — known-failing leg

The run-drawer leg (leg 3) reproducibly fails: after expanding "Prompt assembly" in the run drawer,
the "Project context — attached specs (untrusted)" segment label does not render, even though the
seeded run's `prompt_assembly.specs` is populated. Root cause is unresolved as of this writing. Legs 1
(agent Context tab) and 2 (skill Context tab preview) pass. Treat this flow as **partially passing**,
not green, until the render gap is diagnosed and fixed.

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
