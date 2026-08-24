# mcp-server Gotchas

<!-- generated from: mcp-server/insights/INSIGHTS.md, mcp-server/src/index.ts, mcp-server/src/server.ts, mcp-server/vitest.config.ts, .mcp.json, mcp-server/src/errors.ts -->

Known quirks confirmed during implementation. See `insights/INSIGHTS.md` for the full,
session-by-session record this file was distilled from.

## `stdout` is the JSON-RPC channel — never `console.log`

`src/index.ts` connects a `StdioServerTransport`, which frames JSON-RPC messages over
stdout. A single stray `console.log(` call — here or in any imported module — corrupts
that framed stream, and the failure mode looks exactly like "the MCP server hangs": it
starts, but never produces a valid response. `console.error` (stderr) is safe and is
where all diagnostics go, gated behind `DEVDIGEST_MCP_DEBUG`.

Watch out for the acceptance-test version of this rule too: `grep -rn "console\.log("
mcp-server/src` matches the literal substring anywhere in a file, including inside doc
comments that are *explaining* the rule. A comment that spells out `` `console.log` ``
verbatim will make that grep — and any test built on it — report a false positive. Word
the rule without typing the literal token (e.g. "the `console` object's log method").

## `TSX_TSCONFIG_PATH` in `.mcp.json` is load-bearing, not decorative

`tsx` resolves `tsconfig.json` by walking up from the **spawned process's own cwd**, not
from the entry file's directory. Claude Code launches a project-scope `.mcp.json` server
with cwd = repo root — a directory that is not an ancestor of `mcp-server/tsconfig.json`
in the relevant sense `tsx` needs — so without `TSX_TSCONFIG_PATH` set, the
`@devdigest/reviewer-core` path alias never resolves and the process dies instantly with
`ERR_MODULE_NOT_FOUND`, on the very first deep import. This breaks **both** documented
command forms (`mcp-server/node_modules/.bin/tsx …` and `npx -y tsx …`) identically —
it is not a path-existence problem, and `test -x mcp-server/node_modules/.bin/tsx`
passing proves nothing about whether the script will actually run from a different cwd.

The fix is the third env entry in `.mcp.json`:

```json
"env": { "...": "...", "TSX_TSCONFIG_PATH": "mcp-server/tsconfig.json" }
```

**This package's own test suite cannot catch a regression here** — vitest always runs
with cwd = `mcp-server/`, where the bug does not reproduce. The only way to verify it is
to spawn the server exactly as `.mcp.json` specifies, with cwd = repo root.

## vitest does not read tsconfig `paths` — `resolve.alias` is mandatory

`tsx` resolves the `@devdigest/shared` / `@devdigest/reviewer-core` path aliases via
`mcp-server/tsconfig.json`'s `paths`, but vitest does not consult that file at all.
`mcp-server/vitest.config.ts` must carry a `resolve.alias` block mirroring the same
mappings, or every test file importing either alias fails to resolve. **Ordering
matters**: trailing-slash directory-prefix entries (`"@devdigest/reviewer-core/": "..."`)
must be listed before the bare, non-slash entry, or the bare alias matches first and
swallows every deeper import path that should have matched the prefixed one instead.

## `POST /pulls/:id/review` never returns findings — it is fire-and-forget

The route (`server/src/modules/reviews/service.ts:103`) creates the `agent_run` row(s)
and returns `{pr_id, runs:[{run_id, agent_id, agent_name}], reviews: []}` immediately;
`reviews` is always empty on this response. The actual findings only ever come from
`GET /pulls/:id/reviews` once the run's status is `done`. There is also no `GET
/runs/:id` route, and `RunTrace` carries no `pr_id` — which is exactly why
`devdigest_run_agent_on_pr` maintains its own `run_id → {pr_id, repo, pr, agent}`
mapping (the run index, persisted to `~/.devdigest/mcp/run-index.json`) rather than
trying to derive that context from the API on demand.

## The 10/min review rate limit is disabled server-side under `NODE_ENV=test`

`@fastify/rate-limit` is registered without a custom `errorResponseBuilder`, so a real
429 comes back in the plugin's own shape (`{statusCode, error, message}`), not the
`{error:{code,message,details}}` `ApiErrorBody` envelope every other error uses — branch
on `response.status === 429` **before** attempting to parse the body as `ApiErrorBody`.
Because the limit is disabled under `NODE_ENV=test`, this package's 429 handling
(`rateLimited()` in `errors.ts`) can only be exercised against a stubbed 429 response,
never a real one from a locally running API in test mode.

## SDK 1.30.0 specifics (pinned version — verify again on upgrade)

All of the following were found empirically by running the real assembled server, not
by reading the SDK's documentation:

- **The `"."` package export is broken.** `@modelcontextprotocol/sdk`'s `package.json`
  `exports` has no working root entry (`dist/esm/index.d.ts` doesn't exist on disk).
  Import SDK types from the wildcard path instead, e.g.
  `@modelcontextprotocol/sdk/types.js`, never a bare `@modelcontextprotocol/sdk` import.
- **An empty `ZodRawShape` serialises as `{"type":"object","properties":{}}`**, not the
  spec's commonly-recommended `{"type":"object","additionalProperties":false}`. A
  zero-key raw shape is special-cased through `zod/v4-mini`'s `object({})`, which omits
  `additionalProperties` entirely, instead of going through the vendored v3
  `zod-to-json-schema` converter used for every non-empty shape (which does default
  `additionalProperties: false`). Both forms are spec-valid for a no-parameter tool; a
  test asserting the schema must accept either.
- **Every tool schema (input and output) is stamped with a draft-07 `$schema`
  marker**, even though the only keywords these five tools actually emit are valid
  under 2020-12 too. Strip `$schema` before a deep-equal comparison, and before handing
  the schema to an `Ajv2020` validator — `Ajv2020` cannot resolve the draft-07 meta-schema
  `$ref` and fails to compile with `no schema with key or ref
  "http://json-schema.org/draft-07/schema#"` until `$schema` is deleted from a shallow
  copy of the schema first.
- **`Tool.title` survives a client-side Zod parse as an own key holding `undefined`**,
  even when the wire JSON has no `title` key at all. `toHaveProperty('title')` and
  `'title' in tool` both false-positive as "has a title" on this SDK version, for every
  tool, regardless of what `server.ts` actually registers — because Zod's `.parse()`
  sets every optional field as an own property with value `undefined` rather than
  omitting the key. Assert `tool.title === undefined`, or scan the raw
  `JSON.stringify()`'d payload (which correctly drops `undefined`-valued keys), never
  `toHaveProperty`/`in`.
- **Calling an unregistered tool does not reject at the protocol level.** `McpServer`'s
  internal handler throws an `McpError(ErrorCode.InvalidParams, "Tool ... not found")`,
  but its own surrounding `try/catch` converts that into an ordinary `CallToolResult`
  with `isError: true` — the client's `callTool()` promise *resolves*, it never
  rejects. Don't assume "unknown tool" needs protocol-level error handling on the
  caller side; it comes back exactly like any other tool-level failure.
- `registerTool()`'s config object does accept an arbitrary `_meta?: Record<string,
  unknown>` on this SDK version, and it round-trips correctly to `client.listTools()`'s
  `tool._meta` for exactly the tools that declare it, with no rejection or stripping
  observed. `server.ts` uses this to set `anthropic/maxResultSizeChars: 60000` on
  `devdigest_run_agent_on_pr` and `devdigest_get_findings` only (the two tools whose
  responses can legitimately be large).
- `Ajv` (draft-07, bundled by the SDK itself) also validates every `callTool()` result's
  `structuredContent` against the tool's `outputSchema` automatically, but only once
  `client.listTools()` has been called at least once in that client's lifetime (it warms
  a metadata cache as a side effect). Call `listTools()` before the first `callTool()` in
  a test to get this validation for free, on top of any explicit Ajv 2020-12 assertions.

## Not every non-2xx API response body is an `ApiErrorBody`

`server/`'s own error envelope is `{error:{code,message,details}}`, but a 429 from
`@fastify/rate-limit` uses the plugin's own shape (`{statusCode, error, message}`)
instead — `error` is a *string* there, not an object. `api-client.ts` branches on
`response.status === 429` before attempting to parse the body as an `ApiErrorBody`; a
naive "always parse `error.message`" implementation throws on a real 429.

## A source-scanning test cannot tell code from prose

Several tasks in this package enforce architectural rules with a raw-source `grep`/
`readFileSync(...).not.toContain(...)` assertion (e.g. "this tool file must never call
`deps.api.` directly", "this flow file must never import `JSON.stringify`", "no
`console.log(` anywhere under `src/`). Every one of these is a literal substring match
against the file's raw text — it does not parse the file and cannot distinguish a real
call site from a doc comment that merely *mentions* the forbidden token while explaining
why it's forbidden. Writing the enforced rule into a doc comment using the literal
banned substring makes the file fail its own test even though the code never does the
thing being checked for. When documenting a "no X substring" rule inside a file that is
itself scanned for X, paraphrase — never spell out the literal token.
