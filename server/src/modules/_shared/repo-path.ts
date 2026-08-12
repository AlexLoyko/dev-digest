/**
 * Whether a model-supplied path may be joined onto the clone root.
 *
 * `evidence_path` (and similarly a doc ref extracted from PR text) is
 * caller/model-controlled and `SimpleGitClient.readFile` does a bare
 * `join(clonePath, path)` with no containment check, so `../../../etc/passwd`
 * would escape the clone and its contents could end up rendered in the UI.
 * This is the first (lexical) gate; callers additionally apply a `resolve()`
 * containment check before actually touching disk.
 *
 * Moved here (out of `modules/conventions/verify.ts`) so `modules/intent/`
 * can reuse it without importing across module folders
 * (`server/AGENTS.md:67-68`). `conventions/verify.ts` re-exports this symbol
 * so its existing call sites and tests are untouched.
 */
export function isSafeRepoPath(path: string): boolean {
  if (!path || path.length > 400) return false;
  if (path.includes('\0')) return false;
  const norm = path.replace(/\\/g, '/');
  if (norm.startsWith('/')) return false; // posix absolute
  if (/^[a-zA-Z]:\//.test(norm)) return false; // windows absolute
  return !norm.split('/').some((seg) => seg === '..');
}
