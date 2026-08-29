# API Contracts

Base URL: `http://localhost:3001`

All routes use `fastify-type-provider-zod`. Every input and output is validated by Zod schemas defined in `src/vendor/shared/` (the `@devdigest/shared` package).

## Routes

### Repos

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos` | List all repos |
| `POST` | `/repos` | Add a repo (by GitHub URL or local path) |
| `GET` | `/repos/:id` | Get repo details |

### Pulls

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos/:repoId/pulls` | List PRs for a repo |
| `POST` | `/repos/:repoId/pulls/import` | Import PRs from GitHub |
| `GET` | `/pulls/:id` | Get PR details (with diff) |
| `POST` | `/pulls/:id/review` | Start a review run → returns `{ runId }` |

Rate limit: `POST /pulls/:id/review` — 120/min globally.

### Reviews & Runs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pulls/:id/reviews` | List reviews for a PR |
| `GET` | `/reviews/:id` | Get review with findings |
| `GET` | `/runs/:id/events` | SSE stream of `RunEvent` objects |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List agents |
| `POST` | `/agents` | Create agent |
| `PUT` | `/agents/:id` | Update agent |
| `DELETE` | `/agents/:id` | Delete agent |

### Repo Intel

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repos/:id/index` | Trigger symbol/import indexing |
| `GET` | `/repos/:id/map` | Get repo map (for review context) |

### Project Context

<!-- updated from: server/src/modules/context/routes.ts, server/src/modules/context/service.ts, server/src/vendor/shared/contracts/platform.ts, server/src/vendor/shared/contracts/trace.ts -->

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos/:id/context` | List discovered context documents (`.md` files under a `specs/`, `docs/`, or `insights/` directory at any depth) + scan status for a repo |
| `POST` | `/repos/:id/context/reindex` | Re-scan the repo's clone and persist the fresh document set |
| `GET` | `/repos/:id/context/document?path=` | Read one document's full text, read-only |
| `GET` | `/agents/:id/context` | An agent's directly-attached documents plus its effective set (agent-attached + skill-inherited, deduped and ordered) |
| `PUT` | `/agents/:id/context` | Replace an agent's attached document paths, in order |
| `GET` | `/skills/:id/context` | A skill's attached documents |
| `PUT` | `/skills/:id/context` | Replace a skill's attached document paths, in order |
| `GET` | `/skills/:id/context/preview` | The verbatim `## Project context` block the skill's attachments would produce in a run's prompt |

Shapes are defined in `src/vendor/shared/contracts/platform.ts` (`SpecFile`, `ContextAttachment`,
`SetContextBody`, `EffectiveContextDoc`, `ContextListResponse`, `ContextPreview`, `IndexStatus`) and
`src/vendor/shared/contracts/trace.ts` (`SpecRead`, and `RunTrace.specs_read` / `specs_commit_sha`).
Routes: `src/modules/context/routes.ts`.

Behavior notes:

- **Zero LLM calls.** Discovery, attach, count, read, and inject never reach for an `LLMProvider` on
  this path.
- Documents are always read from the **default-branch clone**, never a pull request's head commit.
- Both `PUT` routes validate every path in the request body before persisting any of them — a single
  invalid path (traversal, a symlink that resolves outside the clone root, or a document the scanner
  flagged with a non-null `excluded_reason`) fails the whole request with `400` and writes nothing.
- Agents and skills are workspace-scoped, not repo-scoped, so `/agents/:id/context` and
  `/skills/:id/context` carry no `:repoId`. The service resolves which repo's clone to validate paths
  / hydrate tokens / build the preview against by picking the first repo in the workspace that has a
  clone, falling back to the first repo overall (`repos.find(r => r.clonePath) ?? repos[0]`) — a
  known single-repo-per-workspace limitation. See `server/docs/architecture.md`.
- `GET /skills/:id/context/preview` returns the actual `## Project context` heading plus the
  delimited document text (built via `reviewer-core`'s `buildProjectContextSection`), not a bare list
  of attached paths.

### Settings & Workspace

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Get current settings (providers, models) |
| `PUT` | `/settings` | Update settings |
| `GET` | `/workspace` | Workspace status |

## SSE Protocol — `GET /runs/:id/events`

The client subscribes with `EventSource`. The server emits `RunEvent` objects as newline-delimited JSON in the `data` field of each SSE message.

```typescript
// RunEvent union — defined in @devdigest/shared
type RunEvent =
  | { type: "started";   runId: string }
  | { type: "log";       runId: string; message: string }
  | { type: "progress";  runId: string; step: string; percent: number }
  | { type: "completed"; runId: string; reviewId: string }
  | { type: "failed";    runId: string; error: string }
```

Connection closes automatically on `completed` or `failed`.

## Zod Schema Locations

All schemas are in `server/src/vendor/shared/`. Key files:

| File | Contains |
|------|---------|
| `review.ts` | `Review`, `Finding`, `Severity`, `Verdict` |
| `agent.ts` | `Agent`, `CreateAgentBody` |
| `repo.ts` | `Repo`, `Pull` |
| `settings.ts` | `Settings`, `LLMProvider` enum |
| `run.ts` | `Run`, `RunEvent` |

## Error Format

All errors return:
```json
{ "statusCode": 422, "error": "Unprocessable Entity", "message": "..." }
```

Zod validation failures return `422` with the full Zod error tree in `message`.
