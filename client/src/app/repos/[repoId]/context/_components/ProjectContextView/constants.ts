/**
 * NFR-2 / EC-10: the repo can contain thousands of matching documents. The
 * list stays usable via the filter input rather than rendering (or
 * virtualizing — no such library is in the project) every row eagerly.
 */
export const LIST_RENDER_CAP = 200;

/** Order the three scanned roots are named in (empty state copy). Mirrors
 * the server's `CONTEXT_ROOT_DIRS` (server/src/modules/context/constants.ts)
 * — not re-imported since it isn't exported through `@devdigest/shared`. */
export const CONTEXT_ROOTS = ["specs", "docs", "insights"] as const;

/** Marker used to key the EC-1 not-cloned state off `index.message` — a
 * sentinel, never rendered as display text (see `service.ts`'s
 * `NOT_CLONED_INDEX`). */
export const NOT_CLONED_MARKER = "not_cloned";
