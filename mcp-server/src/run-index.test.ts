import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { createRunIndex, type RunIndexEntry } from './run-index.js';

/**
 * Every test creates its own temp directory via `fs.mkdtemp` under the OS
 * temp dir — never under the real `$HOME` — per the L04 plan's T8 acceptance
 * criterion ("the suite creates no file under the real $HOME").
 */
function makeTempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'run-index-test-'));
}

function makeEntry(overrides: Partial<RunIndexEntry> = {}): RunIndexEntry {
  return {
    run_id: 'run-1',
    pr_id: 'pr-uuid-1',
    repo: 'acme/api',
    pr: 482,
    agent_id: 'agent-uuid-1',
    agent_name: 'Security',
    started_at: Date.now(),
    ...overrides,
  };
}

// Guards the "no file under the real $HOME" acceptance requirement: this
// module never calls `os.homedir()` internally (the caller decides `dir`),
// so the real `~/.devdigest/mcp` directory must be untouched by this suite.
const realDevdigestMcpDir = path.join(homedir(), '.devdigest', 'mcp');
const realDevdigestMcpDirExistedBefore = existsSync(realDevdigestMcpDir);

describe('createRunIndex', () => {
  it('round-trips a put entry through get, and reports size', () => {
    const dir = makeTempDir();
    const index = createRunIndex({ dir });

    expect(index.size()).toBe(0);
    expect(index.get('run-1')).toBeUndefined();

    const entry = makeEntry();
    index.put(entry);

    expect(index.size()).toBe(1);
    expect(index.get('run-1')).toEqual(entry);
    expect(index.get('unknown-run')).toBeUndefined();
  });

  it('persists entries to disk so a fresh instance over the same dir sees them', () => {
    const dir = makeTempDir();
    const first = createRunIndex({ dir });
    first.put(makeEntry({ run_id: 'run-a', pr: 100 }));
    first.put(makeEntry({ run_id: 'run-b', pr: 101 }));

    const second = createRunIndex({ dir });
    expect(second.size()).toBe(2);
    expect(second.get('run-a')?.pr).toBe(100);
    expect(second.get('run-b')?.pr).toBe(101);
  });

  it('writes the index file with mode 0600', () => {
    const dir = makeTempDir();
    const index = createRunIndex({ dir });
    index.put(makeEntry());

    const filePath = path.join(dir, 'run-index.json');
    const stats = statSync(filePath);
    // Mask to the permission bits only (ignore file-type bits).
    expect(stats.mode & 0o777).toBe(0o600);
  });

  it('evicts the oldest entry (by started_at) once the 200-entry cap is exceeded', () => {
    const dir = makeTempDir();
    const index = createRunIndex({ dir });

    const baseTime = 1_000_000;
    for (let i = 0; i < 200; i += 1) {
      index.put(makeEntry({ run_id: `run-${i}`, started_at: baseTime + i }));
    }
    expect(index.size()).toBe(200);
    expect(index.get('run-0')).toBeDefined();

    // 201st entry, older than nothing already in the set except run-0 is the
    // oldest existing entry — putting a newer entry must evict run-0.
    index.put(makeEntry({ run_id: 'run-200', started_at: baseTime + 200 }));

    expect(index.size()).toBe(200);
    expect(index.get('run-0')).toBeUndefined();
    expect(index.get('run-200')).toBeDefined();
    expect(index.get('run-1')).toBeDefined();
  });

  it('degrades to an empty index (never throws) when the cache file is corrupted', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'run-index.json');
    writeFileSync(filePath, '{ not: valid json ][');

    expect(() => createRunIndex({ dir })).not.toThrow();
    const index = createRunIndex({ dir });
    expect(index.size()).toBe(0);
    expect(index.get('anything')).toBeUndefined();

    // The index must still be usable after recovering from corruption.
    index.put(makeEntry());
    expect(index.size()).toBe(1);
  });

  it('degrades to an empty index when the file exists but is not a JSON array', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'run-index.json');
    writeFileSync(filePath, JSON.stringify({ not: 'an array' }));

    const index = createRunIndex({ dir });
    expect(index.size()).toBe(0);
  });

  it('starts empty (no throw) when the directory does not exist yet', () => {
    const dir = path.join(makeTempDir(), 'nested', 'does-not-exist-yet');
    expect(() => createRunIndex({ dir })).not.toThrow();
    const index = createRunIndex({ dir });
    expect(index.size()).toBe(0);

    // put() must create the directory on demand and still succeed.
    expect(() => index.put(makeEntry())).not.toThrow();
    expect(index.get('run-1')).toBeDefined();
  });

  it('never touches the real $HOME directory', () => {
    // Sanity check that this suite itself only ever operated under the OS
    // temp dir, and that createRunIndex never resolves a path under the
    // real home directory unless explicitly told to via `dir`.
    expect(existsSync(realDevdigestMcpDir)).toBe(realDevdigestMcpDirExistedBefore);
  });
});

afterAll(() => {
  // Final guard: fail loudly if anything in this file ever created the real
  // `~/.devdigest/mcp` directory that didn't exist before the suite ran.
  const existsAfter = existsSync(realDevdigestMcpDir);
  if (!realDevdigestMcpDirExistedBefore && existsAfter) {
    rmSync(realDevdigestMcpDir, { recursive: true, force: true });
    throw new Error(
      `run-index.test.ts created ${realDevdigestMcpDir} under the real $HOME — tests must only use fs.mkdtemp temp dirs.`,
    );
  }
});
