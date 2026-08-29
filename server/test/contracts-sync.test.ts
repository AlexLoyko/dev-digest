import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * NFR-8 guard — "the brief contract... is vendored in both packages, so both
 * copies shall change together in the same change, and no consumer shall be
 * left parsing the placeholder shape."
 *
 * SCOPE NARROWING — read this before touching the assertions below:
 *
 * `./scripts/arch-check.sh`'s `contracts-in-sync` rule checks all 12 vendored
 * contract files, and it is red *today* for reasons that have nothing to do
 * with SPEC-02: `eval-ci.ts`, `knowledge.ts` and `productionize.ts` have real,
 * pre-existing drift between `client/` and `server/` (see arch-check.sh's own
 * header comment). Fixing that drift is legitimate work, but it is a separate
 * concern from "did this change keep brief.ts in sync" — bundling it into this
 * guard would let a future brief.ts regression hide inside a diff that also
 * touches those three unrelated files, and it would force this feature to fix
 * bugs it didn't introduce.
 *
 * So this test asserts two things at two different altitudes instead of one
 * pass/fail:
 *   1. NARROW + STRICT — the two `brief.ts` copies are byte-identical once the
 *      client/server `.js`-import-suffix vendoring transform is normalised
 *      away (the exact `sed -E` arch-check.sh itself applies). This is the
 *      actual NFR-8 obligation and it must be exact, always.
 *   2. WIDE + NON-REGRESSING — running the real `arch-check.sh` (no
 *      `--no-contracts`, so the rule genuinely executes) yields no more than
 *      the 3 already-known violations, and none of them is `brief.ts`. This
 *      is a "does not increase" bar, not a "passes" bar, on purpose: it lets
 *      the pre-existing drift be tracked and eventually fixed by its own
 *      task without this test either silently accepting new brief.ts drift
 *      (masked by an unrelated failure) or blocking on drift this feature
 *      was never scoped to fix.
 *
 * If this test ever needs its "3" to move, that number must go DOWN (drift
 * fixed elsewhere) — never up. An increase means something durably new
 * diverged, in brief.ts or otherwise, and that regression must be the reason
 * this file fails.
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const SERVER_BRIEF = path.join(REPO_ROOT, 'server/src/vendor/shared/contracts/brief.ts');
const CLIENT_BRIEF = path.join(REPO_ROOT, 'client/src/vendor/shared/contracts/brief.ts');

// The exact normalisation arch-check.sh applies before diffing the two
// vendored trees: relative imports (`from './xxx.js'`) drop the `.js` suffix
// so the systematic client/server extension vendoring transform doesn't read
// as drift. Keep this regex byte-for-byte in sync with arch-check.sh's sed.
function normaliseJsImportSuffix(source: string): string {
  return source.replace(/(from '\.\/[A-Za-z0-9_./-]+)\.js'/g, "$1'");
}

describe('NFR-8 — brief.ts contract is vendored identically in both packages', () => {
  it('server and client brief.ts are byte-identical after normalising the .js import suffix', () => {
    const serverSource = readFileSync(SERVER_BRIEF, 'utf8');
    const clientSource = readFileSync(CLIENT_BRIEF, 'utf8');

    expect(normaliseJsImportSuffix(serverSource)).toBe(normaliseJsImportSuffix(clientSource));
  });

  it('arch-check.sh reports no more than the 3 known pre-existing contracts-in-sync violations, and none is brief.ts', () => {
    // arch-check.sh exits 1 whenever any violation exists (of ANY rule, not
    // just contracts-in-sync) — that non-zero exit is expected and tolerated
    // here; only stdout is parsed. `--no-contracts` is deliberately never
    // passed: that flag skips the rule this guard exists to exercise.
    const result = spawnSync(path.join(REPO_ROOT, 'scripts/arch-check.sh'), [], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    const stdout = result.stdout ?? '';
    // eslint-disable-next-line no-control-regex
    const plain = stdout.replace(/\x1b\[[0-9;]*m/g, ''); // strip ANSI colour codes

    const violationLocations = plain
      .split('\n')
      .map((line) => /^\s*✗\s+contracts-in-sync\s+(\S+)/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1]!);

    expect(violationLocations.length).toBeLessThanOrEqual(3);
    expect(violationLocations.some((loc) => loc.includes('brief.ts'))).toBe(false);
  });
});
