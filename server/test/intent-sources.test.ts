import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink, readFile as readFileFs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoRef } from '@devdigest/shared';
import { resolveSources } from '../src/modules/intent/sources.js';
import { MockGitClient } from '../src/adapters/mocks.js';
import {
  MAX_DOC_BYTES,
  MAX_DOC_CHARS,
  MAX_DOC_READS,
  MAX_DOC_REFS,
} from '../src/modules/intent/constants.js';
import type { Container } from '../src/platform/container.js';

/**
 * `resolveSources` (§1 of the L03 plan / step 7) — the security-critical
 * surface: doc refs are extracted from untrusted PR-body text and read ONLY
 * from the local clone via `container.git.readFile`, guarded by
 * `isSafeRepoPath` + a resolve() containment check, PLUS (as of the symlink
 * fix) a `realpath()`-based containment re-check and a `stat()` size/type
 * check performed before that read. Never over HTTP.
 *
 * `buildContainer`'s `github()` ALWAYS throws — L03 §1 removed linked-issue
 * resolution, the classifier's only network call, so `resolveSources` must
 * never invoke it at all. Every test in this file therefore also proves that
 * property; a regression that reintroduces a `container.github()` call would
 * fail every single test here, not just a dedicated one.
 */

const REF: RepoRef = { owner: 'acme', name: 'widgets' };
const REPO_FULL_NAME = 'acme/widgets';

function buildContainer(opts: { git: MockGitClient }): Container {
  return {
    git: opts.git,
    github: async () => {
      throw new Error(
        'container.github() must never be called by resolveSources — L03 §1 removed linked-issue resolution',
      );
    },
  } as unknown as Container;
}

/**
 * `MockGitClient.clonePathFor` returns a non-existent path
 * (`/mock/clones/<owner>/<name>`, `adapters/mocks.ts:261-263`), which is fine
 * for tests that never touch disk but makes the new `realpath()` guard in
 * `sources.ts` drop every doc candidate with ENOENT — the guard can't be
 * exercised against a clone root that doesn't exist. Doc-resolution tests
 * therefore need a REAL directory on disk. This subclass points
 * `clonePathFor` at a real temp dir and reads from it exactly like
 * `SimpleGitClient.readFile` does (`fs.readFile(join(root, path))`, which is
 * what follows symlinks in production) — so the guard is genuinely exercised
 * rather than bypassed by a friendlier test double.
 */
class TempClonedGitClient extends MockGitClient {
  constructor(private readonly root: string) {
    super();
  }
  override clonePathFor(): string {
    return this.root;
  }
  override async readFile(_repo: RepoRef, path: string): Promise<string> {
    return readFileFs(join(this.root, path), 'utf8');
  }
}

async function writeFileAt(root: string, rel: string, contents: string): Promise<void> {
  const full = join(root, rel);
  const dir = full.slice(0, full.lastIndexOf('/'));
  if (dir && dir !== root) await mkdir(dir, { recursive: true });
  await writeFile(full, contents);
}

/** Returns false (instead of throwing) when the platform refuses to create a
 *  symlink — e.g. an unprivileged account on Windows — so the regression
 *  tests that need one can skip gracefully rather than fail on an unrelated
 *  platform limitation. */
async function trySymlink(target: string, path: string): Promise<boolean> {
  try {
    await symlink(target, path);
    return true;
  } catch {
    return false;
  }
}

describe('resolveSources — always-present sources', () => {
  it('pr_title is always resolved:true; pr_body reflects trimmed length; diff is always resolved:true', async () => {
    const container = buildContainer({ git: new MockGitClient() });
    const withBody = await resolveSources(container, REF, REPO_FULL_NAME, 'pr1', 'Add rate limiting', 'Some real body text.');
    expect(withBody.sources).toContainEqual({ kind: 'pr_title', ref: 'Add rate limiting', resolved: true });
    expect(withBody.sources).toContainEqual({ kind: 'pr_body', ref: 'body', resolved: true });
    expect(withBody.sources).toContainEqual({ kind: 'diff', ref: 'diff', resolved: true });

    const blankBody = await resolveSources(container, REF, REPO_FULL_NAME, 'pr2', 'Add rate limiting', '   ');
    expect(blankBody.sources).toContainEqual({ kind: 'pr_body', ref: 'body', resolved: false });

    const nullBody = await resolveSources(container, REF, REPO_FULL_NAME, 'pr3', 'Add rate limiting', null);
    expect(nullBody.sources).toContainEqual({ kind: 'pr_body', ref: 'body', resolved: false });
  });
});

describe('resolveSources — doc resolution (happy path)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'intent-sources-happy-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a safe repo-relative *.md ref referenced in the body is read from the clone and resolved:true', async () => {
    await writeFileAt(root, 'docs/plan.md', 'This is the plan.');
    const git = new TempClonedGitClient(root);
    const container = buildContainer({ git });
    const { sources, docTexts } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See docs/plan.md for the design.',
    );
    expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/plan.md', resolved: true });
    expect(docTexts).toEqual([
      { path: 'docs/plan.md', text: 'This is the plan.', sourceChars: 17 },
    ]);
  });

  it('a doc over MAX_DOC_CHARS is sliced, and sourceChars reports its PRE-slice length', async () => {
    // Under MAX_DOC_BYTES, so it is genuinely read and then capped — the
    // truncation `prompt.ts` reports must come from this number, not from
    // `text.length === MAX_DOC_CHARS`, which cannot tell a capped doc from one
    // that happens to be exactly that long.
    const long = 'x'.repeat(MAX_DOC_CHARS + 500);
    await writeFileAt(root, 'docs/plan.md', long);
    const git = new TempClonedGitClient(root);
    const container = buildContainer({ git });
    const { docTexts } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See docs/plan.md for the design.',
    );
    expect(docTexts).toHaveLength(1);
    expect(docTexts[0]!.text).toHaveLength(MAX_DOC_CHARS);
    expect(docTexts[0]!.sourceChars).toBe(MAX_DOC_CHARS + 500);
  });

  it('a same-repo blob URL resolves the same way as a bare path', async () => {
    await writeFileAt(root, 'docs/plan.md', 'This is the plan.');
    const git = new TempClonedGitClient(root);
    const container = buildContainer({ git });
    const { sources } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See https://github.com/acme/widgets/blob/main/docs/plan.md for the design.',
    );
    expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/plan.md', resolved: true });
  });
});

describe('resolveSources — non-markdown refs are never read', () => {
  it('a bare non-.md/.mdx reference is not extracted as a doc candidate at all', async () => {
    const git = new MockGitClient({ files: { 'script.sh': 'echo hi' } });
    const readFileSpy = vi.spyOn(git, 'readFile');
    const container = buildContainer({ git });
    const { sources } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'Run script.sh to reproduce.',
    );
    expect(sources.some((s) => s.kind === 'doc')).toBe(false);
    expect(readFileSpy).not.toHaveBeenCalled();
  });
});

describe('resolveSources — foreign-repo blob URLs are dropped, never read', () => {
  it('a blob URL for a different owner/repo produces zero readFile calls and no doc source', async () => {
    const git = new MockGitClient({ files: { 'x.md': 'should never be reached' } });
    const readFileSpy = vi.spyOn(git, 'readFile');
    const container = buildContainer({ git });
    const { sources, docTexts } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See https://github.com/other/repo/blob/main/x.md for details.',
    );
    expect(sources.some((s) => s.kind === 'doc')).toBe(false);
    expect(docTexts).toEqual([]);
    expect(readFileSpy).not.toHaveBeenCalled();
  });
});

describe('resolveSources — path-safety guard (security-critical)', () => {
  it('traversal, posix-absolute, windows-absolute, and NUL-containing paths are all resolved:false with ZERO readFile calls', async () => {
    const git = new MockGitClient({
      // If the guard were bypassed, these keys would make the read "succeed" —
      // proving the drop happens BEFORE any read is attempted, not because the
      // path merely fails to resolve to content.
      files: {
        '../../../etc/passwd.md': 'should never be reached',
        '/etc/passwd.md': 'should never be reached',
        'C:/win.md': 'should never be reached',
      },
    });
    const readFileSpy = vi.spyOn(git, 'readFile');
    const container = buildContainer({ git });

    const body = [
      'Traversal: https://github.com/acme/widgets/blob/main/../../../etc/passwd.md',
      'Posix absolute: https://github.com/acme/widgets/blob/main//etc/passwd.md',
      'Windows absolute: https://github.com/acme/widgets/blob/main/C:/win.md',
      `NUL byte: https://github.com/acme/widgets/blob/main/docs/notes${'\u0000'}.md`,
    ].join('\n');

    const { sources, docTexts } = await resolveSources(container, REF, REPO_FULL_NAME, 'pr1', 'Add rate limiting', body);

    const docSources = sources.filter((s) => s.kind === 'doc');
    expect(docSources.length).toBe(4);
    expect(docSources.every((s) => s.resolved === false)).toBe(true);
    expect(docTexts).toEqual([]);
    expect(readFileSpy).not.toHaveBeenCalled();
  });
});

describe('resolveSources — MockGitClient trap: empty content must be unresolvable', () => {
  it('a doc read that returns "" (missing under the mock) is resolved:false, not resolved:true', async () => {
    const git = new MockGitClient({ files: {} }); // no entry ⇒ readFile resolves to ''
    const container = buildContainer({ git });
    const { sources, docTexts } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See docs/missing.md for the design.',
    );
    expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/missing.md', resolved: false });
    expect(docTexts).toEqual([]);
  });

  it('a doc read that returns whitespace-only content is also resolved:false', async () => {
    const git = new MockGitClient({ files: { 'docs/blank.md': '   \n\t  ' } });
    const container = buildContainer({ git });
    const { sources } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See docs/blank.md for the design.',
    );
    expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/blank.md', resolved: false });
  });

  it('a readFile that REJECTS (real-client-like ENOENT) is caught and resolved:false, never throws', async () => {
    const git = new MockGitClient();
    vi.spyOn(git, 'readFile').mockRejectedValue(new Error('ENOENT: no such file'));
    const container = buildContainer({ git });
    await expect(
      resolveSources(container, REF, REPO_FULL_NAME, 'pr1', 'Add rate limiting', 'See docs/plan.md please.'),
    ).resolves.toMatchObject({
      sources: expect.arrayContaining([{ kind: 'doc', ref: 'docs/plan.md', resolved: false }]),
    });
  });
});

describe('resolveSources — caps: MAX_DOC_REFS considered, MAX_DOC_READS actually read', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'intent-sources-caps-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('only the first MAX_DOC_REFS candidates are considered; of those, only MAX_DOC_READS are read', async () => {
    const files: Record<string, string> = {
      'a.md': 'A content',
      'b.md': 'B content',
      'c.md': 'C content',
      'd.md': 'D content',
      'e.md': 'E content',
      'f.md': 'F content',
    };
    for (const [name, content] of Object.entries(files)) {
      await writeFileAt(root, name, content);
    }
    const git = new TempClonedGitClient(root);
    const readFileSpy = vi.spyOn(git, 'readFile');
    const container = buildContainer({ git });

    const body = 'See a.md, b.md, c.md, d.md, e.md, and f.md for details.';
    const { sources, docTexts } = await resolveSources(container, REF, REPO_FULL_NAME, 'pr1', 'Add rate limiting', body);

    const docSources = sources.filter((s) => s.kind === 'doc');
    // f.md is beyond MAX_DOC_REFS(5) — never even considered.
    expect(docSources.length).toBe(MAX_DOC_REFS);
    expect(docSources.some((s) => s.ref === 'f.md')).toBe(false);

    // Of the 5 considered, only MAX_DOC_READS(3) are actually read.
    expect(readFileSpy).toHaveBeenCalledTimes(MAX_DOC_READS);
    expect(docTexts.length).toBe(MAX_DOC_READS);
    const resolvedTrue = docSources.filter((s) => s.resolved);
    const resolvedFalse = docSources.filter((s) => !s.resolved);
    expect(resolvedTrue.length).toBe(MAX_DOC_READS);
    expect(resolvedFalse.length).toBe(MAX_DOC_REFS - MAX_DOC_READS);
  });
});

describe('resolveSources — realpath guard (regression: symlink escape, security-critical)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'intent-sources-symlink-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('a doc ref that is a FILE symlink pointing outside the clone root is rejected: resolved:false, contents never surface', async () => {
    const outsideRoot = await mkdtemp(join(tmpdir(), 'intent-sources-outside-'));
    try {
      const secretPath = join(outsideRoot, 'secret.json');
      await writeFile(secretPath, 'TOP_SECRET_API_KEY=sk-do-not-leak');

      await mkdir(join(root, 'docs'), { recursive: true });
      const linkPath = join(root, 'docs', 'evil.md');
      const created = await trySymlink(secretPath, linkPath);
      if (!created) {
        // Platform refuses symlink creation for this process (e.g. an
        // unprivileged account on Windows) — nothing to exercise here.
        return;
      }

      const git = new TempClonedGitClient(root);
      const container = buildContainer({ git });
      const { sources, docTexts } = await resolveSources(
        container,
        REF,
        REPO_FULL_NAME,
        'pr1',
        'Add rate limiting',
        'See docs/evil.md for the design.',
      );

      expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/evil.md', resolved: false });
      expect(docTexts).toEqual([]);
      expect(docTexts.some((d) => d.text.includes('TOP_SECRET_API_KEY'))).toBe(false);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('a doc ref under a DIRECTORY symlink that escapes the clone root is rejected the same way', async () => {
    // The exact shape `conventions/service.ts` calls out in its comment:
    // `docs -> <outside dir>` with a ref of `docs/secret.md`.
    const outsideRoot = await mkdtemp(join(tmpdir(), 'intent-sources-outside-dir-'));
    try {
      await writeFileAt(outsideRoot, 'secret.md', 'TOP_SECRET dir-escape content');

      const linkPath = join(root, 'docs');
      const created = await trySymlink(outsideRoot, linkPath);
      if (!created) {
        return;
      }

      const git = new TempClonedGitClient(root);
      const container = buildContainer({ git });
      const { sources, docTexts } = await resolveSources(
        container,
        REF,
        REPO_FULL_NAME,
        'pr1',
        'Add rate limiting',
        'See docs/secret.md for the design.',
      );

      expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/secret.md', resolved: false });
      expect(docTexts).toEqual([]);
      expect(docTexts.some((d) => d.text.includes('TOP_SECRET'))).toBe(false);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('a real in-clone doc over MAX_DOC_BYTES is dropped by the size guard, not read', async () => {
    const bigContents = 'x'.repeat(MAX_DOC_BYTES + 1);
    await writeFileAt(root, 'docs/huge.md', bigContents);

    const git = new TempClonedGitClient(root);
    const readFileSpy = vi.spyOn(git, 'readFile');
    const container = buildContainer({ git });
    const { sources, docTexts } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See docs/huge.md for the design.',
    );

    expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/huge.md', resolved: false });
    expect(docTexts).toEqual([]);
    // The size check (`stat`) happens BEFORE `container.git.readFile` is
    // called — proving the file is never slurped into memory at all, not
    // merely truncated after the fact by MAX_DOC_CHARS.
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('the happy path still resolves a genuine in-root doc — the guard does not over-reject', async () => {
    await writeFileAt(root, 'docs/plan.md', 'A perfectly ordinary, in-root plan doc.');

    const git = new TempClonedGitClient(root);
    const container = buildContainer({ git });
    const { sources, docTexts } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'See docs/plan.md for the design.',
    );

    expect(sources).toContainEqual({ kind: 'doc', ref: 'docs/plan.md', resolved: true });
    expect(docTexts).toEqual([
      { path: 'docs/plan.md', text: 'A perfectly ordinary, in-root plan doc.', sourceChars: 39 },
    ]);
  });
});

describe('resolveSources — no linked-issue resolution (removed by L03 §1)', () => {
  it('never emits a linked_issue source, and never calls container.github(), even when the body references an issue', async () => {
    const container = buildContainer({ git: new MockGitClient() });
    const githubSpy = vi.spyOn(container, 'github');

    const { sources } = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'Closes #471.',
    );

    expect(sources.some((s) => s.kind === 'linked_issue')).toBe(false);
    expect(githubSpy).not.toHaveBeenCalled();
  });

  it('a container whose github() throws does not affect the result at all', async () => {
    const container = buildContainer({ git: new MockGitClient() });
    // buildContainer's github() already always throws; resolving succeeds
    // regardless, because it is never invoked.
    const result = await resolveSources(
      container,
      REF,
      REPO_FULL_NAME,
      'pr1',
      'Add rate limiting',
      'Closes #471. See docs/plan.md.',
    );
    expect(result.sources).toContainEqual({ kind: 'pr_title', ref: 'Add rate limiting', resolved: true });
  });
});
