# Client UI Architecture

## RSC vs Client Components

Default is React Server Component (RSC). Add `"use client"` only when you need:
- Browser APIs (`window`, `document`, `localStorage`)
- Event handlers (`onClick`, `onChange`)
- React hooks (`useState`, `useEffect`, `useQuery`)
- Real-time subscriptions (SSE)

**Boundary pattern:** RSC fetches initial data and passes it as props to a client component that handles interactivity.

```
page.tsx (RSC)
  → fetches initial repo list via direct DB/API call (server-side)
  → passes to <RepoList repos={initialData} /> (client component)
  → client component hydrates TanStack Query cache with initialData
```

## Data Fetching

All client-side data fetching goes through TanStack Query:

```
src/lib/api.ts          ← raw fetch functions (one per endpoint)
src/lib/hooks/          ← useQuery / useMutation wrappers
  useRepos.ts
  usePulls.ts
  useReview.ts
  useRunEvents.ts       ← SSE hook (special)
  ...
```

Never call `fetch` directly inside a component. Always use a hook from `src/lib/hooks/`.

## SSE Subscription (useRunEvents)

`useRunEvents(runId)` subscribes to `GET /runs/:id/events` and returns an array of `RunEvent` objects that grows as events arrive.

Lifecycle:
1. `EventSource` opens on mount
2. Each `message` event pushes a parsed `RunEvent` into local state
3. On `completed` or `failed` event, `EventSource` closes automatically
4. On unmount, `EventSource` closes (cleanup in `useEffect` return)

**Do not instantiate `EventSource` directly in components.** Use `useRunEvents`.

## Type Imports

```typescript
// Correct — types come from shared contracts
import type { Review, Finding } from "@devdigest/shared"

// Wrong — never redefine types locally that exist in shared
type Review = { ... }
```

`@devdigest/shared` resolves to `../server/src/vendor/shared` via the TypeScript alias in `tsconfig.json`. No npm package exists.

## Internationalization

All user-facing strings use `next-intl`:

```typescript
// In a client component
const t = useTranslations("pulls")
return <h1>{t("title")}</h1>

// In a server component
const t = await getTranslations("pulls")
```

Message files live in `messages/`. Never hardcode English strings directly in JSX.

## Shared feature components across pages

<!-- updated from: client/src/components/context-picker/ContextPicker.tsx -->

Most components are colocated under one route's `_components/`. Some are mounted by more than one
page or tab instead — `src/components/context-picker/ContextPicker.tsx` is the example: it is the
Project Context attach/detach/reorder UI, and both the Agent Editor's Context tab and the Skill
Editor's Context tab mount the same component rather than each implementing their own. It takes a
`namespace: "agents" | "skills"` prop so tab-specific copy (heading, helper text, attach/detach
labels) resolves from the right `next-intl` catalogue, while document-catalog labels that do not vary
by mounting page (source root, threat level, token count) always resolve from the shared `context`
catalogue. Reordering ships as move-up/move-down buttons with `aria-label`s plus an
`aria-live="polite"` announcement region, not drag-only — drag-and-drop alone is not
keyboard-operable.
