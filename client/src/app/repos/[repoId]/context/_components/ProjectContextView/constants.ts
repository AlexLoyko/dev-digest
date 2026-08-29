/**
 * NFR-2 / EC-10: the repo can contain thousands of matching documents. The
 * list stays usable via the filter input rather than rendering (or
 * virtualizing — no such library is in the project) every row eagerly.
 */
export const LIST_RENDER_CAP = 200;

/** Marker used to key the EC-1 not-cloned state off `index.message` — a
 * sentinel, never rendered as display text (see `service.ts`'s
 * `NOT_CLONED_INDEX`). */
export const NOT_CLONED_MARKER = "not_cloned";
