---
name: breaking-change
description: Flags removal, renaming, or narrowing of a public API contract that existing callers depend on.
type: convention
source: manual
---

# Breaking Change Gate

Flag any change that makes a request valid yesterday fail today, or removes
something a caller can already reach. Reconstruct the BEFORE and AFTER shape from
the diff and name the caller-visible delta — no delta, no finding.

## Rules

Flag as **CRITICAL**:
- A public route, path segment, HTTP method, response field, enum member, SSE event
  name, or exported symbol that is removed or renamed with no alias kept.
- A request field that becomes required, or a new required field on an existing
  endpoint.
- Validation tightened on an existing input: narrower enum, stricter format, lower
  `max`, higher `min` — payloads accepted before are now rejected.
- Same name, different meaning: changed unit, timezone, base, ordering, or
  pagination convention.
- A status code or error code that changes for an unchanged failure mode.
- Auth, scope, or tenancy requirements added to an existing route with no migration
  path.

Flag as **WARNING**:
- A break you can describe but whose caller you cannot evidence in the diff.
- A rename done consistently in-repo on a surface that may still be published
  (exported type, versioned route) — in-repo callers being updated is not proof the
  contract is private.

**Not a finding** — do not report these:
- New optional request fields, new response fields, new routes, new enum members
  consumed only by new code.
- Renames fully contained in the diff where nothing is exported and every reference
  is updated.

## Good

```ts
// The old field stays and keeps working; the new one is additive.
const OrderResponse = z.object({
  total_cents: z.number(),
  /** @deprecated use total_cents — removal scheduled for v3 */
  total: z.number(),
  currency: z.string().optional(),
});
```

## Bad

```ts
// `total` disappears and `currency` becomes mandatory in the same release:
// every existing client breaks on both read and write.
const OrderResponse = z.object({
  total_cents: z.number(),
  currency: z.string(),
});
```

```diff
- app.get('/api/orders/:id', handler)
+ app.get('/api/v1/order/:id', handler)   // path renamed, old route deleted
```
