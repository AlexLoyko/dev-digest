---
name: semver-discipline
description: Checks that the declared version matches what the diff actually does to the contract — major for breaks, minor for additive.
type: convention
source: manual
---

# Semver Discipline

Decide the version the diff *earns*, then compare it with the version the diff
*declares* (package version, API version segment, schema version field, changelog
entry). Report the mismatch, not the number you would have picked.

## Rules

The change earns a **MAJOR** bump when it removes, renames, or narrows anything a
caller can reach: a deleted field or route, a newly required input, tightened
validation, a changed status code for an unchanged failure, or changed semantics
under an unchanged name.

It earns a **MINOR** bump when it is purely additive: a new optional field, a new
route, a new enum member that only new code produces.

It earns a **PATCH** bump when caller-visible behaviour is unchanged: internal
refactor, performance, or a fix that brings behaviour back in line with the
documented contract.

Flag as **CRITICAL**:
- A major-earning change shipped without a major bump, a new versioned route, or a
  gating flag.
- Declared version metadata that contradicts the diff (patch bump alongside a
  removed field; unchanged `/v1` path with incompatible payloads).
- Client and server copies of a shared schema bumped out of step, so one side ships
  a version the other cannot parse.

Flag as **WARNING**:
- A minor-earning change released as patch, or an over-declared major with no
  breaking content (noisy for consumers either way).
- A new enum member on a response union whose callers switch exhaustively — additive
  on paper, breaking in practice for strict consumers.

**Not a finding**: pre-1.0 packages where the repo has an explicit "0.x may break"
policy; version files untouched by this diff.

## Good

```jsonc
// package.json — 2.4.1 → 3.0.0, and the break is routed, not silently swapped
{ "version": "3.0.0" }
```

```ts
app.get('/api/v2/orders', listOrdersV2); // new shape lives on a new version
app.get('/api/v1/orders', listOrdersV1); // old shape still served until sunset
```

## Bad

```jsonc
// package.json — patch bump …
{ "version": "2.4.2" }
```

```diff
  // … while the same PR deletes a response field callers read today.
  const OrderResponse = z.object({
    id: z.string(),
-   total: z.number(),
  });
```
