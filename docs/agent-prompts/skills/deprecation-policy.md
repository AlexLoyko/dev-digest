---
name: deprecation-policy
description: Requires deprecation with a named replacement and a migration window instead of silent removal.
type: convention
source: manual
---

# Deprecation Policy

Nothing public disappears without first being marked deprecated, pointed at a
replacement, and left working for a stated window. Deletion is the second PR, never
the first.

## Rules

A compliant deprecation has all four:
1. A marker on the old surface (`@deprecated` tag, `Deprecation` / `Sunset` header,
   docs note) — not a comment buried in the handler.
2. A named replacement: the exact field, route, or symbol to call instead.
3. A stated window — a version or date after which removal happens.
4. The old surface still fully functional during that window.

Flag as **CRITICAL**:
- A public field, route, event, or exported symbol deleted in this diff with no
  prior deprecation marker anywhere in the code or docs.
- A surface marked deprecated and simultaneously made non-functional — returning
  `null`, throwing, or 410 — in the same release.
- A replacement that does not actually cover the old use case, so migrating callers
  lose behaviour.

Flag as **WARNING**:
- A deprecation marker with no replacement named, or no removal version/date.
- A forced migration with no note in the changelog or migration guide.
- No way to tell whether the old path is still in use (no usage metric or log)
  before a removal date is committed to.

Flag as **SUGGESTION**:
- A deprecation whose message is vague ("will be removed soon") but otherwise
  complete.

**Not a finding**: removing something already deprecated in an earlier release past
its stated window; deleting a surface introduced and never released.

## Good

```ts
const UserResponse = z.object({
  displayName: z.string(),
  /**
   * @deprecated since 4.2 — use `displayName`. Still populated; removed in 5.0.
   */
  name: z.string(),
});

// Old route keeps serving, and announces its sunset.
app.get('/api/users/:id/profile', async (req, reply) => {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', 'Wed, 01 Oct 2026 00:00:00 GMT');
  reply.header('Link', '</api/users/:id>; rel="successor-version"');
  return getUser(req.params.id);
});
```

## Bad

```diff
- app.get('/api/users/:id/profile', getProfile)   // deleted outright, no notice
```

```ts
// Marked deprecated and broken in the same release — the marker is decoration.
/** @deprecated use `displayName` */
get name() {
  throw new Error('removed');
}
```
