/**
 * path-guard.ts — Repo-relative path safety for the Project Context module.
 *
 * Two gates, meant to be used together:
 *  1. `isSafeContextPath` — cheap, synchronous, lexical rejection. Runs at
 *     attach time (and again as a first check inside `resolveContained`) so
 *     obviously-hostile input never reaches the filesystem.
 *  2. `resolveContained` — async, filesystem-aware. Resolves symlinks on
 *     BOTH the clone root and the candidate file via `fs.realpath` and then
 *     does a separator-aware containment check. This is the only gate that
 *     catches a symlink planted inside the clone (e.g. `specs/link.md` ->
 *     `/etc/passwd`) — a lexical check on the un-realpath'ed path cannot see
 *     that the final resolved location escapes the clone root.
 *
 * Onion layer: pure application/domain helper. No Drizzle, no Fastify, no
 * container — every caller (scanner.ts, service.ts, and ultimately
 * SimpleGitClient.readFile callers) must validate through here first, since
 * SimpleGitClient.readFile itself has no traversal guard of its own.
 *
 * Traces to: AC-16 — an attached document path that resolves outside the
 * repository clone root must be rejected at attach time and refused at read
 * time.
 */
import { join, resolve, sep, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';

/**
 * Lexical (no I/O) safety check for a repo-relative context document path.
 *
 * Rejects:
 * - Absolute paths (`/etc/passwd`)
 * - Any `..` path segment, anywhere in the path (`../../etc/passwd`,
 *   `specs/../../etc/passwd`)
 * - Backslashes (Windows-style separators used to smuggle traversal past a
 *   forward-slash-only check, or to break out via a mixed separator)
 * - NUL bytes (`\0`) — invalid in POSIX paths and rejected by Node's fs
 *   layer with a low-level `ERR_INVALID_ARG_VALUE`; reject early so callers
 *   get a clean boolean instead of a thrown error
 * - Anything not ending in `.md`
 *
 * Accepts nested-but-contained paths, e.g. `specs/nested/ok.md`.
 */
export function isSafeContextPath(relPath: string): boolean {
  if (!relPath) return false;
  if (relPath.includes('\0')) return false;
  if (relPath.includes('\\')) return false;
  if (isAbsolute(relPath)) return false;

  const segments = relPath.split('/');
  if (segments.some((s) => s === '..')) return false;

  if (!relPath.toLowerCase().endsWith('.md')) return false;

  return true;
}

/**
 * Resolve `relPath` against `cloneRoot` and return the real, on-disk path
 * only if it is genuinely contained within the real, on-disk clone root.
 *
 * Returns `null` when:
 * - `relPath` fails `isSafeContextPath` (fast, no I/O)
 * - the target does not exist (`fs.realpath` throws `ENOENT`) — a missing
 *   file is treated as "missing", never as "allowed"
 * - `fs.realpath` fails for any other reason (permission error, etc.)
 * - the resolved real path is not the clone root itself and does not start
 *   with `<realCloneRoot><path.sep>` — this is the symlink-escape check:
 *   a bare `startsWith` on the un-realpath'ed strings would let
 *   `/clone-evil` pass for root `/clone`, so both sides are realpath'd
 *   first and the comparison is separator-aware.
 */
export async function resolveContained(
  cloneRoot: string,
  relPath: string,
): Promise<string | null> {
  if (!isSafeContextPath(relPath)) return null;

  const candidate = join(resolve(cloneRoot), relPath);

  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = await realpath(resolve(cloneRoot));
    realCandidate = await realpath(candidate);
  } catch {
    // Covers ENOENT (missing file/root) and any other realpath failure
    // (e.g. EACCES) — all treated as "not resolvable", never as "allowed".
    return null;
  }

  if (realCandidate !== realRoot && !realCandidate.startsWith(realRoot + sep)) {
    return null;
  }

  return realCandidate;
}
