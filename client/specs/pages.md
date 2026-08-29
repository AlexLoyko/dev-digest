# Spec: Pages & Data Flow

Each page, its data sources, and TanStack Query keys.

## `/` — Dashboard

**Component:** `app/page.tsx` (RSC)
**Data:** Repo list via `GET /repos`
**Query key:** `["repos"]`
**Behavior:** If no repos exist, redirects to `/onboarding`.

## `/onboarding` — First-Run Setup

**Component:** `app/onboarding/page.tsx` (client)
**Data:** `GET /settings` to check if API keys are configured
**Query key:** `["settings"]`
**Behavior:** Multi-step wizard. On completion, navigates to `/`.

## `/repos/:id/pulls` — PR List

**Component:** `app/repos/[id]/pulls/page.tsx` (RSC shell + client list)
**Data:**
- `GET /repos/:id` — repo details
- `GET /repos/:id/pulls` — PR list
**Query keys:** `["repo", id]`, `["pulls", repoId]`
**Actions:** "Import PRs" button → `POST /repos/:id/pulls/import`

## `/pulls/:id` — PR Detail

**Component:** `app/pulls/[id]/page.tsx` (RSC shell + client detail)
**Data:**
- `GET /pulls/:id` — PR with diff
- `GET /pulls/:id/reviews` — list of reviews with findings
**Query keys:** `["pull", id]`, `["reviews", pullId]`
**Actions:**
- "Run Review" → `POST /pulls/:id/review` → receives `runId` → subscribes to `useRunEvents(runId)`
- Reviews list updates via `invalidateQueries(["reviews", pullId])` on `completed` SSE event

## `/agents` — Agent Management

**Component:** `app/agents/page.tsx` (client)
**Data:** `GET /agents`
**Query key:** `["agents"]`
**Actions:** Create / edit / delete agents. All mutations invalidate `["agents"]`.

## `/repos/:repoId/context` — Project Context

<!-- updated from: client/src/app/repos/[repoId]/context/page.tsx, client/src/app/repos/[repoId]/context/_components/ProjectContextView/ProjectContextView.tsx, client/src/lib/hooks/context-files.ts -->

**Component:** `app/repos/[repoId]/context/page.tsx` (client) → delegates to
`_components/ProjectContextView`
**Data:**
- `GET /repos/:id/context` — discovered documents + scan status
- `GET /repos/:id/context/document?path=` — one document's full text, fetched only once selected
**Query keys:** `["context", repoId]`, `["context", repoId, "document", path]`
**Behavior:** Read-only — no edit/upload/delete affordance anywhere in this tree (AC-2). No local
clone → an explanatory empty state, no documents listed, no attachment possible (EC-1). Document
bodies render through the shared `Markdown` primitive, never raw HTML. The list is filterable and
capped for display so a repository with thousands of matching documents stays interactive (EC-10).
**Actions:** "Re-index" → `POST /repos/:id/context/reindex`, invalidates `["context", repoId]` on
success.

## Context tabs — Agent & Skill editors

<!-- updated from: client/src/app/agents/[id]/_components/AgentEditor/_components/ContextTab/ContextTab.tsx, client/src/app/skills/[id]/_components/SkillEditor/_components/ContextTab/ContextTab.tsx, client/src/lib/hooks/context-attachments.ts -->

Both the Agent Editor (`app/agents/[id]`) and the Skill Editor (`app/skills/[id]`) gained a Context
tab (`?tab=context`) mounting the shared `ContextPicker` (`src/components/context-picker/`) against
the active repo's document catalog (`useContextFiles`, the same hook and query key as the Project
Context page above).

**Data:**
- Agent tab — `GET /agents/:id/context` / `PUT /agents/:id/context`, query key
  `["agent-context", agentId]`
- Skill tab — `GET /skills/:id/context` / `PUT /skills/:id/context`, query key
  `["skill-context", skillId]`, plus `GET /skills/:id/context/preview`, query key
  `["skill-context-preview", skillId]` — invalidated alongside `["skill-context", skillId]` on every
  attach/detach so the preview can never go stale relative to the current attachment set (AC-9)
**Behavior:** The skill tab's preview panel renders the server's actual `## Project context`
serialization inside a `<pre>` as a plain text node — never through Markdown, never
`dangerouslySetInnerHTML` — so a repository-controlled document cannot render as markup even in the
preview. A document that was attached but no longer resolves in the clone is shown "missing in repo"
(EC-7) rather than being silently dropped from the list.

## `/settings` — Settings

**Component:** `app/settings/page.tsx` (client)
**Data:** `GET /settings`
**Query key:** `["settings"]`
**Actions:** `PUT /settings` — updates API keys and LLM provider. Keys are never returned in full (masked). Mutation invalidates `["settings"]`.
