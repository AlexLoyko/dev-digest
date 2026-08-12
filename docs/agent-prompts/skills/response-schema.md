---
name: response-schema
description: Flags drift in response shape — field types, nullability, optionality, and schema/handler disagreement.
type: convention
source: manual
---

# Response Schema Gate

Check that what a handler can actually return still matches what its schema
promises. Trace EVERY exit path — success, empty, and error — not just the happy
path.

## Rules

Flag as **CRITICAL**:
- A response field whose type changes (`string` → `number`, scalar → object,
  object → array) or that switches between a value and `null`.
- A field declared required by the schema that some code path omits or returns as
  `null` / `undefined`.
- A previously non-nullable field that becomes nullable, or an optional field that
  becomes required, without the callers being able to see it coming.
- Schema and handler disagreeing: the handler returns keys the schema strips, or
  the schema declares keys no branch produces.
- A response object wrapped into — or unwrapped out of — an envelope
  (`{ items, nextCursor }` vs a bare array).
- A discriminated union gaining or losing a variant, or a discriminator value
  changing.

Flag as **WARNING**:
- "Nothing found" represented inconsistently across sibling endpoints — `[]` on one,
  `null` on another, key omitted on a third.
- A changed default `limit`, cursor format, or sort order that callers page against.
- A field documented as always present that is only present under a condition the
  caller cannot check.

**Not a finding**: a new optional field added to a response; internal DTO shapes
never serialized to a caller.

## Good

```ts
// Empty result is still the declared shape: an array, never null, never absent.
const ListResponse = z.object({
  items: z.array(Item),
  nextCursor: z.string().nullable(),
});

async function list(req): Promise<ListResponse> {
  const rows = await repo.find(req.query);
  return { items: rows, nextCursor: rows.length === limit ? cursorOf(rows) : null };
}
```

## Bad

```ts
// Schema says `items` is an array and `nextCursor` is a string,
// but the empty path returns null and the last page omits the cursor entirely.
const ListResponse = z.object({
  items: z.array(Item),
  nextCursor: z.string(),
});

async function list(req) {
  const rows = await repo.find(req.query);
  if (!rows.length) return { items: null };            // wrong type, missing key
  return { items: rows, nextCursor: cursorOf(rows) };  // absent on last page
}
```
