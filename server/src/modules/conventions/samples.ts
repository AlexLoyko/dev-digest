import type { RepoRef } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { CONFIG_PATHS, MAX_CONFIG_CHARS, MAX_FILE_CHARS, SAMPLE_FILE_COUNT } from './constants.js';

/**
 * Sample selection for the conventions extractor — 100% deterministic code, no
 * model call. Two sources:
 *   - configs: a fixed candidate list read best-effort off the clone
 *   - code:    the top-N ranked files from repo-intel (tests/configs already
 *              filtered out by `isJunkPath`)
 *
 * The model only ever sees what this produces, which is what makes the evidence
 * gate in `verify.ts` meaningful.
 */

export interface SampleFile {
  path: string;
  text: string;
  kind: 'config' | 'code';
}

/** Read a file off the clone, returning null for anything unreadable (ENOENT is normal). */
async function readOrNull(container: Container, ref: RepoRef, path: string): Promise<string | null> {
  try {
    return await container.git.readFile(ref, path);
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated]`;
}

/**
 * Configs + top-ranked source files, in that order.
 *
 * `getConventionSamples` returns `[]` when the repo is unindexed or
 * REPO_INTEL_ENABLED is off (the facade degrades, it never throws), so a
 * config-only sample set is a legitimate — if weaker — result. The caller
 * decides what to do when NOTHING is readable.
 */
export async function collectSamples(
  container: Container,
  repoId: string,
  ref: RepoRef,
): Promise<SampleFile[]> {
  const out: SampleFile[] = [];

  const configs = await Promise.all(
    CONFIG_PATHS.map(async (path) => ({ path, text: await readOrNull(container, ref, path) })),
  );
  for (const c of configs) {
    if (c.text === null || c.text.trim().length === 0) continue;
    out.push({ path: c.path, text: truncate(c.text, MAX_CONFIG_CHARS), kind: 'config' });
  }

  const codePaths = await container.repoIntel.getConventionSamples(repoId, SAMPLE_FILE_COUNT);
  const code = await Promise.all(
    codePaths.map(async (path) => ({ path, text: await readOrNull(container, ref, path) })),
  );
  for (const c of code) {
    if (c.text === null || c.text.trim().length === 0) continue;
    out.push({ path: c.path, text: truncate(c.text, MAX_FILE_CHARS), kind: 'code' });
  }

  return out;
}

/**
 * Render samples for the prompt with a 1-based line number on every line, so
 * the model can cite `file:line` from what it actually sees. The numbers are
 * still only a hint — `verify.ts` recomputes them from the snippet match.
 */
export function renderSamples(files: SampleFile[]): string {
  return files
    .map((f) => {
      const numbered = f.text
        .split('\n')
        .map((line, i) => `${String(i + 1).padStart(4, ' ')}| ${line}`)
        .join('\n');
      return `### ${f.path} (${f.kind})\n${numbered}`;
    })
    .join('\n\n');
}
