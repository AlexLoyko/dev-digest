/**
 * T20 — Token-budget and size-cap test.
 *
 * Measures the REAL serialized `tools/list` payload — assembled through
 * `createMcpServer()` and round-tripped through a real `Client` over
 * `InMemoryTransport.createLinkedPair()` — rather than the hand-written
 * source strings in each `tools/*.ts` file. The MCP SDK's Zod→JSON-Schema
 * conversion adds `$schema`, `type`, `properties`, `required` and enum
 * arrays that are a meaningful share of the budget (see the L04 plan,
 * "Tool annotations (R15)" and the R10/R10a/R15 requirements), so measuring
 * the hand-written strings alone would understate the true cost.
 *
 * Every assertion below iterates `client.listTools()`'s result dynamically
 * (`result.tools`) — no tool name is hard-coded as a loop driver — so a
 * sixth tool added later is automatically subjected to the same budget and
 * shape audit and cannot silently skip it.
 *
 * The cap was raised from the L04 plan's original 9000 to 9700 when
 * `devdigest_get_blast_radius` (T15) was wired to real data instead of its
 * `not_implemented` stub — its `symbols[].callers` array of `{file, symbol,
 * line}` objects is real, load-bearing shape (a caller's file/line is used
 * to build a source deep-link, and collapsing it into a formatted string
 * would lose that structure), so this budget grew to fit it rather than the
 * schema shrinking to fit the old budget. Re-measured at 9449 chars; the
 * extra headroom is for incidental drift, not an invitation to add more
 * unrelated schema weight.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../src/server.js';
import { INSTRUCTIONS } from '../src/instructions.js';

/** MCP spec (2026-07-28) JSON-Schema keywords banned from every tool schema (R10/R10a). */
const FORBIDDEN_SCHEMA_KEYS = ['oneOf', 'anyOf', 'allOf', '$ref', '$defs'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep equality for plain JSON values — no external dependency needed. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** Recursively collects every forbidden JSON-Schema keyword found anywhere in `node`. */
function findForbiddenKeys(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => findForbiddenKeys(item, `${path}[${i}]`));
  }
  if (isPlainObject(node)) {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN_SCHEMA_KEYS.includes(key)) hits.push(`${path}.${key}`);
      hits.push(...findForbiddenKeys(value, `${path}.${key}`));
    }
    return hits;
  }
  return [];
}

const NO_PARAM_FORM_ADDITIONAL_PROPERTIES = { type: 'object', additionalProperties: false };
const NO_PARAM_FORM_EMPTY_PROPERTIES = { type: 'object', properties: {} };

describe('tools/list — token budget and size caps (T20)', () => {
  let tools: Tool[];
  let serializedLength: number;

  beforeAll(async () => {
    const server = createMcpServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'tools-list-budget-test-client', version: '0.0.0' });

    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.listTools();
    tools = result.tools;
    serializedLength = JSON.stringify(result).length;

    const estimatedTokens = Math.ceil(serializedLength / 4);
    // eslint-disable-next-line no-console
    console.error(
      `[T20] tools/list serialized size: ${serializedLength} chars ≈ ${estimatedTokens} tokens (cap: 9700 chars / ~2425 tokens)`,
    );
  });

  it('serializes the real tools/list payload within the 9700-char budget', () => {
    expect(serializedLength).toBeLessThanOrEqual(9700);
  });

  it('every tool description and the server instructions stay under 2048 bytes', () => {
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(Buffer.byteLength(tool.description ?? '', 'utf8'), tool.name).toBeLessThan(2048);
    }
    expect(Buffer.byteLength(INSTRUCTIONS, 'utf8')).toBeLessThan(2048);
  });

  it('devdigest_list_agents declares one of the two spec-valid no-parameter input forms', () => {
    const listAgents = tools.find((tool) => tool.name === 'devdigest_list_agents');
    expect(listAgents).toBeDefined();

    // The SDK stamps `$schema` onto every converted schema uniformly (it is
    // present on every tool's input/output schema, not specific to the
    // no-params case) — strip it before comparing against the two
    // conceptual "no parameters" shapes the plan calls out.
    const { $schema: _schema, ...inputSchema } = listAgents!.inputSchema as Record<
      string,
      unknown
    >;
    const matchesForm =
      deepEqual(inputSchema, NO_PARAM_FORM_ADDITIONAL_PROPERTIES) ||
      deepEqual(inputSchema, NO_PARAM_FORM_EMPTY_PROPERTIES);

    expect(matchesForm, JSON.stringify(inputSchema)).toBe(true);
  });

  it('no tool schema (input or output) contains oneOf/anyOf/allOf/$ref/$defs', () => {
    for (const tool of tools) {
      const inputHits = findForbiddenKeys(tool.inputSchema);
      const outputHits = findForbiddenKeys(tool.outputSchema);
      expect([...inputHits, ...outputHits], tool.name).toEqual([]);
    }
  });

  it('no input property is declared type: object or type: array (flat-args guarantee)', () => {
    for (const tool of tools) {
      const inputSchema = tool.inputSchema as Record<string, unknown>;
      const properties = isPlainObject(inputSchema.properties) ? inputSchema.properties : {};
      for (const [propName, propSchema] of Object.entries(properties)) {
        const propType = isPlainObject(propSchema) ? propSchema.type : undefined;
        expect(propType, `${tool.name}.${propName}`).not.toBe('object');
        expect(propType, `${tool.name}.${propName}`).not.toBe('array');
      }
    }
  });

  it('every tool declares an outputSchema (R10a)', () => {
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it('every tool declares annotations (R15), with an explicit destructiveHint on any non-read-only tool', () => {
    for (const tool of tools) {
      expect(tool.annotations, tool.name).toBeDefined();
      expect(typeof tool.annotations!.readOnlyHint, tool.name).toBe('boolean');
    }

    // Readers: readOnlyHint === true (R15's four readers, discovered dynamically
    // by their own declared annotation — never hard-listed by name).
    const readOnlyTools = tools.filter((tool) => tool.annotations?.readOnlyHint === true);
    expect(readOnlyTools.length).toBeGreaterThan(0);

    // Any tool that is NOT read-only must carry an EXPLICIT destructiveHint,
    // because the spec default is `true` — a future refactor that drops the
    // field would silently reintroduce that default rather than failing loud.
    const nonReadOnlyTools = tools.filter((tool) => tool.annotations?.readOnlyHint === false);
    expect(nonReadOnlyTools.length).toBeGreaterThan(0);
    for (const tool of nonReadOnlyTools) {
      expect('destructiveHint' in (tool.annotations as object), tool.name).toBe(true);
      expect(tool.annotations!.destructiveHint, tool.name).toBe(false);
    }

    // Every tool must be classified as one or the other.
    expect(readOnlyTools.length + nonReadOnlyTools.length).toBe(tools.length);
  });

  it('no tool carries a title key in the real tools/list result', () => {
    for (const tool of tools) {
      expect(tool.title, tool.name).toBeUndefined();
    }
  });
});
