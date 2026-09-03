#!/usr/bin/env node
/**
 * collect.mjs — deterministic dependency inventory for a multi-package TypeScript repo.
 *
 * Everything in here is measurement, not judgement: package discovery, installed sizes,
 * transitive closures, version drift, usage scanning, and the internal component graph.
 * The model reading this JSON spends its tokens on prioritisation and advice instead of
 * on `du` arithmetic it would get wrong anyway.
 *
 *   node collect.mjs [--root <dir>] [--out <file.json>] [--pretty]
 *
 * Exit 0 always (an empty repo is a finding, not a crash). Warnings go to stderr.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};
const ROOT = path.resolve(arg('--root', process.cwd()));
const OUT = arg('--out', null);
const PRETTY = argv.includes('--pretty');
const warnings = [];
const warn = (m) => { warnings.push(m); process.stderr.write('warn: ' + m + '\n'); };

// Directories that are never part of the dependency picture. `clones/` matters here:
// this repo checks out whole third-party repos under server/clones, and counting them
// would double every number in the report.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'clones',
  '.turbo', '.cache', 'out', '.vercel', '.pnpm-store', 'tmp',
]);

const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const CONFIG_EXT = new Set(['.json', '.jsonc', '.yaml', '.yml', '.sh', '.css', '.toml']);

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------
/**
 * Strip JSONC comments without touching string contents.
 *
 * A regex cannot do this job: tsconfig files contain both `"src/**\/*.ts"` (a glob whose
 * bytes spell a comment terminator) and `"@scope/pkg/*"` (bytes that spell an opener), so
 * a naive /\*...*\/ sweep silently swallows the `paths` block and the whole internal
 * dependency graph comes back empty. Walk the characters and track whether we're inside
 * a string instead.
 */
const stripJSONC = (raw) => {
  let out = '';
  let inString = false, inLine = false, inBlock = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i], next = raw[i + 1];
    if (inLine) { if (c === '\n') { inLine = false; out += c; } continue; }
    if (inBlock) { if (c === '*' && next === '/') { inBlock = false; i++; } continue; }
    if (inString) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && next === '/') { inLine = true; i++; continue; }
    if (c === '/' && next === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
};

const readJSON = (p) => {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    try { return JSON.parse(raw); } catch { return JSON.parse(stripJSONC(raw)); }
  } catch { return null; }
};

const walk = (dir, onFile) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(full, onFile);
    } else if (e.isFile()) {
      onFile(full);
    }
  }
};

/** Bytes in a package directory, excluding nested node_modules so closures never double-count. */
const dirSizeCache = new Map();
const dirSize = (dir) => {
  if (dirSizeCache.has(dir)) return dirSizeCache.get(dir);
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules') continue;
        stack.push(full);
      } else if (e.isFile()) {
        try { total += fs.statSync(full).size; } catch { /* raced */ }
      }
    }
  }
  dirSizeCache.set(dir, total);
  return total;
};

// ---------------------------------------------------------------------------
// package discovery
// ---------------------------------------------------------------------------
const discoverPackages = () => {
  const found = [];
  const scan = (dir, depth) => {
    if (depth > 2) return;
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      const manifest = readJSON(pj);
      if (manifest && (manifest.name || manifest.dependencies || manifest.scripts)) {
        found.push({ dir, manifest });
        // A nested package is its own unit; don't descend further into it.
        if (dir !== ROOT) return;
      }
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      scan(path.join(dir, e.name), depth + 1);
    }
  };
  scan(ROOT, 0);
  return found;
};

const managerOf = (dir) => {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb'))) return 'bun';
  return 'none';
};

// ---------------------------------------------------------------------------
// module resolution + transitive graph
// ---------------------------------------------------------------------------
const resolveDep = (fromDir, name) => {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      try { return fs.realpathSync(candidate); } catch { return candidate; }
    }
    if (path.resolve(dir) === ROOT) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
};

/** realpath -> { name, version, license, selfBytes, deps: [realpath] } */
const nodes = new Map();
const loadNode = (real) => {
  const existing = nodes.get(real);
  if (existing) return existing;
  const manifest = readJSON(path.join(real, 'package.json')) || {};
  const node = {
    name: manifest.name || path.basename(real),
    version: manifest.version || '0.0.0',
    license: typeof manifest.license === 'string' ? manifest.license : (manifest.license && manifest.license.type) || 'UNKNOWN',
    selfBytes: dirSize(real),
    // Executable names, so a package invoked as `tsc --noEmit` in a script is not
    // mistaken for dead weight just because nothing imports the string "typescript".
    bins: typeof manifest.bin === 'string'
      ? [manifest.name] : Object.keys(manifest.bin || {}),
    deps: [],
  };
  nodes.set(real, node);
  const raw = { ...(manifest.dependencies || {}), ...(manifest.optionalDependencies || {}) };
  for (const depName of Object.keys(raw)) {
    const r = resolveDep(real, depName);
    if (r) { node.deps.push(r); loadNode(r); }
  }
  return node;
};

const sumSelf = (set) => {
  let bytes = 0;
  for (const m of set) { const n = nodes.get(m); if (n) bytes += n.selfBytes; }
  return bytes;
};

const closureOf = (real) => {
  const seen = new Set([real]);
  const stack = [real];
  let bytes = 0;
  while (stack.length) {
    const cur = stack.pop();
    const n = nodes.get(cur);
    if (!n) continue;
    bytes += n.selfBytes;
    for (const d of n.deps) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  }
  return { bytes, count: seen.size, members: seen };
};

// ---------------------------------------------------------------------------
// source scanning: which specifiers a package actually imports
// ---------------------------------------------------------------------------
const SPEC_RE = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  // dynamic import, tolerating a bundler pragma: import(/* @vite-ignore */ 'pkg')
  /\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]([^'"]+)['"]/g,
  /^\s*import\s+['"]([^'"]+)['"]/gm,
];

/**
 * Does `corpus` refer to `token` as a standalone word?
 *
 * Substring matching is not good enough here: `tsx` occurs inside every `.tsx` glob and
 * path in the repo, so a plain includes() marks the tsx package as used in projects that
 * never run it. Require a delimiter on both sides — a dot before the token (`file.tsx`)
 * is deliberately NOT a delimiter, since that is the extension case we're excluding.
 */
const DELIM_BEFORE = '(?:^|[\\s"\'`=:,(\\[{|&/])';
const DELIM_AFTER = '(?:[\\s"\'`,)\\]}|;:@]|$)';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (corpus, token) =>
  new RegExp(DELIM_BEFORE + escapeRe(token) + DELIM_AFTER).test(corpus);

const bareName = (spec) => {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

/**
 * Component = the unit a reader thinks in. Under src/, container folders
 * (modules/, adapters/, features/, vendor/, packages/) name their child; everything
 * else is its own top-level folder.
 */
const CONTAINERS = new Set(['modules', 'adapters', 'features', 'vendor', 'packages', 'domains']);
const componentOf = (relFromSrc) => {
  const parts = relFromSrc.split(path.sep).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return '(root)';
  const head = parts[0];
  if (CONTAINERS.has(head) && parts.length > 2) return head + '/' + parts[1];
  return head;
};

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const discovered = discoverPackages();
if (discovered.length === 0) warn('no package.json found under ' + ROOT);

/**
 * Repo-level scripts and configs (scripts/dev.sh, docker-compose.yml, CI workflows) drive
 * packages from outside the package directory. Without them in view, anything used only by
 * the top-level tooling reads as dead code.
 */
const rootCorpus = (() => {
  let corpus = '';
  const add = (file) => {
    try {
      if (fs.statSync(file).size < 512 * 1024) corpus += '\n' + fs.readFileSync(file, 'utf8');
    } catch { /* unreadable */ }
  };
  for (const dir of [ROOT, path.join(ROOT, 'scripts'), path.join(ROOT, '.github', 'workflows')]) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name === 'package.json' || e.name.startsWith('pnpm-lock') || e.name.endsWith('.lock')) continue;
      if (CONFIG_EXT.has(path.extname(e.name)) || e.name.includes('.config.')) add(path.join(dir, e.name));
    }
  }
  return corpus;
})();

const packages = [];
const aliasIndex = []; // { pkgDir, alias, targetAbs }

for (const { dir, manifest } of discovered) {
  const rel = path.relative(ROOT, dir) || '.';
  const srcDir = fs.existsSync(path.join(dir, 'src')) ? path.join(dir, 'src') : dir;

  // tsconfig path aliases: in a repo wired by aliases rather than workspaces, these
  // ARE the internal dependency edges — nothing in package.json records them.
  const tsconfig = readJSON(path.join(dir, 'tsconfig.json'));
  const tsPaths = (tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.paths) || {};
  const baseUrl = path.resolve(dir, (tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.baseUrl) || '.');
  const aliases = [];
  for (const [alias, targets] of Object.entries(tsPaths)) {
    for (const t of [].concat(targets)) {
      const targetAbs = path.resolve(baseUrl, t);
      aliases.push({
        alias,
        target: path.relative(ROOT, targetAbs),
        external: !targetAbs.startsWith(dir + path.sep),
      });
      aliasIndex.push({ pkgDir: dir, alias: alias.replace(/\/\*$/, ''), targetAbs });
    }
  }

  // one pass over the package's own files: import specifiers + config corpus + component graph
  const usedSpecs = new Set();
  const relativeEdges = new Map(); // "from to" -> count
  const componentFiles = new Map();
  const scriptCorpus = JSON.stringify(manifest.scripts || {});
  const stringLiterals = new Set(); // quoted strings in source, for runtime-name references
  let configCorpus = '';

  /**
   * Which component a file belongs to. Files under src/ are grouped by their feature folder;
   * files beside it (scripts/, config at the package root) are kept separate so tooling does
   * not masquerade as an application component in the diagram.
   */
  const componentForFile = (abs) => {
    const relSrc = path.relative(srcDir, abs);
    if (!relSrc.startsWith('..')) {
      return relSrc.split(path.sep).filter(Boolean).length <= 1 ? 'src/(root)' : componentOf(relSrc);
    }
    const relPkg = path.relative(dir, abs);
    if (relPkg.startsWith('..')) return null; // outside the package entirely
    const parts = relPkg.split(path.sep).filter(Boolean);
    return parts.length <= 1 ? '(package root)' : parts[0];
  };
  let sourceFiles = 0;
  let sourceBytes = 0;

  walk(dir, (file) => {
    const ext = path.extname(file);
    const base = path.basename(file);
    // Lockfiles name every transitive package in the tree, so folding them into the
    // config corpus would mark literally every dependency as "used somewhere" and the
    // unused-dependency signal would be dead on arrival.
    // package.json is excluded for the same reason: it lists every dependency by name,
    // so including it would make every dependency look "used" and hide the dead ones.
    const isManifest = base === 'pnpm-lock.yaml' || base === 'package-lock.json'
      || base === 'yarn.lock' || base === 'bun.lockb' || base === 'npm-shrinkwrap.json'
      || base === 'package.json';
    if (!isManifest && (CONFIG_EXT.has(ext) || base.includes('.config.'))) {
      try {
        if (fs.statSync(file).size < 512 * 1024) configCorpus += '\n' + fs.readFileSync(file, 'utf8');
      } catch { /* binary or unreadable */ }
    }
    if (!SOURCE_EXT.has(ext)) return;
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    sourceFiles += 1;
    sourceBytes += Buffer.byteLength(text);

    // Some dependencies are named at runtime rather than imported — pino's
    // `{ target: 'pino-pretty' }`, a worker entry path, a plugin looked up by name.
    // Collecting string literals keeps those out of the false-positive pile.
    const LITERAL_RE = /['"]([@a-z0-9][\w@/.-]{1,80})['"]/gi;
    let lit;
    while ((lit = LITERAL_RE.exec(text)) !== null) stringLiterals.add(lit[1]);

    const fromComponent = componentForFile(file);
    if (fromComponent) componentFiles.set(fromComponent, (componentFiles.get(fromComponent) || 0) + 1);

    for (const re of SPEC_RE) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const spec = m[1];
        const bare = bareName(spec);
        if (bare) usedSpecs.add(bare);

        // internal component edge — resolve relative and alias imports back to a folder
        let targetAbs = null;
        if (spec.startsWith('.')) {
          targetAbs = path.resolve(path.dirname(file), spec);
        } else {
          const hit = aliasIndex
            .filter((a) => a.pkgDir === dir && (spec === a.alias || spec.startsWith(a.alias + '/')))
            .sort((a, b) => b.alias.length - a.alias.length)[0];
          if (hit) {
            const rest = spec.slice(hit.alias.length).replace(/^\//, '');
            targetAbs = rest ? path.resolve(path.dirname(hit.targetAbs), rest) : hit.targetAbs;
          }
        }
        if (!targetAbs || !fromComponent) continue;
        const toComponent = componentForFile(targetAbs);
        if (!toComponent || toComponent === fromComponent) continue;
        const key = fromComponent + ' ' + toComponent;
        relativeEdges.set(key, (relativeEdges.get(key) || 0) + 1);
      }
    }
  });

  /**
   * How a package earns its place, ordered most-direct evidence first. Only `none` means
   * nothing anywhere in the package refers to it. Shared by declared dependencies and by
   * phantom installs, so both are judged on the same evidence.
   */
  const classifyUsage = (name, bins = []) => {
    if (usedSpecs.has(name)) return 'source';
    if (stringLiterals.has(name) || [...stringLiterals].some((s) => s.startsWith(name + '/'))) {
      return 'runtime-string';
    }
    if (name.startsWith('@types/')) return 'types';
    if (bins.some((b) => mentions(scriptCorpus, b)) || mentions(scriptCorpus, name)) return 'script';
    if (mentions(configCorpus, name)) return 'config';
    // Weakest evidence: only the repo-level tooling names it, which may well belong to a
    // sibling package. Worth a human look rather than a removal.
    if (mentions(rootCorpus, name) || bins.some((b) => mentions(rootCorpus, b))) return 'repo-tooling';
    return 'none';
  };

  // direct dependencies, measured
  const declared = [];
  const footprint = new Set();   // union of every direct dep's closure, deduped
  const prodFootprint = new Set();
  const kinds = [
    ['prod', manifest.dependencies || {}],
    ['dev', manifest.devDependencies || {}],
    ['peer', manifest.peerDependencies || {}],
    ['optional', manifest.optionalDependencies || {}],
  ];
  for (const [kind, block] of kinds) {
    for (const [name, range] of Object.entries(block)) {
      const real = resolveDep(dir, name);
      let version = null, license = 'UNKNOWN', selfBytes = 0, closureBytes = 0, closureCount = 0;
      let bins = [];
      if (real) {
        const node = loadNode(real);
        const c = closureOf(real);
        version = node.version; license = node.license; selfBytes = node.selfBytes;
        bins = node.bins;
        closureBytes = c.bytes; closureCount = c.count;
        for (const m of c.members) {
          footprint.add(m);
          if (kind === 'prod') prodFootprint.add(m);
        }
      }

      const usage = classifyUsage(name, bins);

      declared.push({
        name, range, kind,
        installed: real ? path.relative(ROOT, real) : null,
        version, license,
        selfBytes, closureBytes, closureCount,
        usage,
      });
    }
  }

  // imported but never declared here — resolves through a sibling or hoisted install today,
  // which is exactly the kind of thing that breaks on a clean CI checkout.
  const declaredNames = new Set(declared.map((d) => d.name));
  const aliasNames = aliases.map((a) => a.alias.replace(/\/\*$/, ''));
  const undeclared = [...usedSpecs]
    .filter((s) => !declaredNames.has(s))
    .filter((s) => !aliasNames.some((a) => s === a || s.startsWith(a + '/')))
    .filter((s) => resolveDep(dir, s) !== null)
    .sort();

  /**
   * Installed at the top level, declared nowhere, and not a transitive of anything declared.
   *
   * The import scan cannot see these: a tool invoked as a binary (`spawn('agent-browser')`)
   * or through an env-configured path never appears as an import specifier, so a package the
   * whole suite depends on can sit in node_modules with no manifest entry at all. It works
   * until someone runs a clean install.
   */
  const phantomInstalled = [];
  const nmDir = path.join(dir, 'node_modules');
  const topLevel = [];
  try {
    for (const e of fs.readdirSync(nmDir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      if (e.name.startsWith('@')) {
        try {
          for (const s of fs.readdirSync(path.join(nmDir, e.name), { withFileTypes: true })) {
            if (!s.name.startsWith('.')) topLevel.push(e.name + '/' + s.name);
          }
        } catch { /* unreadable scope */ }
      } else {
        topLevel.push(e.name);
      }
    }
  } catch { /* no node_modules */ }

  let staleInstalls = 0;
  let staleBytes = 0;
  for (const name of topLevel) {
    if (declaredNames.has(name)) continue;
    const real = resolveDep(dir, name);
    if (real && footprint.has(real)) continue; // legitimately hoisted transitive
    const node = real ? loadNode(real) : null;
    const usage = classifyUsage(name, node ? node.bins : []);
    // Nothing refers to it and nothing declares it: leftover from a removed dependency or a
    // package-manager artefact. Counted, not listed — a list of forty of these buries the one
    // that matters.
    if (usage === 'none') { staleInstalls += 1; staleBytes += node ? node.selfBytes : 0; continue; }
    phantomInstalled.push({
      name,
      version: node ? node.version : null,
      bytes: node ? node.selfBytes : 0,
      usage,
    });
  }

  packages.push({
    name: manifest.name || rel,
    dir: rel,
    private: manifest.private === true,
    manager: managerOf(dir),
    // Deduped union of every direct dependency's closure. This is what the package really
    // costs to install — summing per-dependency closures would count shared transitives
    // (react, typescript, the @types tree) once per dependent and inflate the total.
    installFootprintBytes: sumSelf(footprint),
    installFootprintCount: footprint.size,
    prodFootprintBytes: sumSelf(prodFootprint),
    prodFootprintCount: prodFootprint.size,
    sourceFiles,
    sourceBytes,
    scripts: Object.keys(manifest.scripts || {}),
    aliases,
    dependencies: declared.sort((a, b) => b.closureBytes - a.closureBytes),
    undeclared,
    phantomInstalled: phantomInstalled.sort((a, b) => b.bytes - a.bytes),
    staleInstalls: { count: staleInstalls, bytes: staleBytes },
    components: [...componentFiles.entries()]
      .map(([name, files]) => ({ name, files }))
      .sort((a, b) => b.files - a.files),
    componentEdges: [...relativeEdges.entries()]
      .map(([k, count]) => { const [from, to] = k.split(' '); return { from, to, count }; })
      .sort((a, b) => b.count - a.count),
  });
}

// internal package-to-package edges, from aliases pointing outside their own package
const internalEdges = [];
for (const pkg of packages) {
  for (const a of pkg.aliases) {
    if (!a.external) continue;
    const owner = packages.find((p) => p.dir !== '.' && (a.target === p.dir || a.target.startsWith(p.dir + '/')));
    const label = a.alias.replace(/\/\*$/, '');
    if (internalEdges.some((e) => e.from === pkg.dir && e.alias === label)) continue;
    internalEdges.push({
      from: pkg.dir,
      alias: label,
      target: a.target,
      to: owner ? owner.dir : a.target,
      kind: owner ? 'cross-package-alias' : 'path-alias',
    });
  }
}

// same package, different declared ranges across packages — the drift that produces
// "works in server, breaks in client" bugs
const rangeIndex = new Map();
for (const pkg of packages) {
  for (const d of pkg.dependencies) {
    if (!rangeIndex.has(d.name)) rangeIndex.set(d.name, []);
    rangeIndex.get(d.name).push({ pkg: pkg.dir, range: d.range, version: d.version, kind: d.kind });
  }
}
const drift = [...rangeIndex.entries()]
  .filter(([, uses]) => uses.length > 1 && new Set(uses.map((u) => u.range)).size > 1)
  .map(([name, uses]) => ({ name, uses }))
  .sort((a, b) => b.uses.length - a.uses.length);

const shared = [...rangeIndex.entries()]
  .filter(([, uses]) => uses.length > 1)
  .map(([name, uses]) => ({
    name,
    packages: uses.map((u) => u.pkg),
    ranges: [...new Set(uses.map((u) => u.range))],
    versions: [...new Set(uses.map((u) => u.version).filter(Boolean))],
  }));

// the same library installed at several versions across the whole tree
const byName = new Map();
for (const [real, node] of nodes) {
  if (!byName.has(node.name)) byName.set(node.name, new Map());
  byName.get(node.name).set(node.version, path.relative(ROOT, real));
}
const duplicates = [...byName.entries()]
  .filter(([, versions]) => versions.size > 1)
  .map(([name, versions]) => ({
    name,
    versions: [...versions.keys()].sort(),
    copies: versions.size,
    wastedBytes: [...versions.values()].slice(1).reduce((s, p) => s + dirSize(path.join(ROOT, p)), 0),
  }))
  .sort((a, b) => b.wastedBytes - a.wastedBytes);

const report = {
  schema: 'dependency-checker/collect@1',
  generatedAt: new Date().toISOString(),
  root: ROOT,
  warnings,
  totals: {
    packages: packages.length,
    distinctInstalledPackages: nodes.size,
    installedBytes: [...nodes.values()].reduce((s, n) => s + n.selfBytes, 0),
    directDependencies: packages.reduce((s, p) => s + p.dependencies.length, 0),
    duplicatedNames: duplicates.length,
    driftedNames: drift.length,
  },
  packages,
  internalEdges,
  sharedDependencies: shared,
  drift,
  duplicates: duplicates.slice(0, 40),
};

const json = JSON.stringify(report, null, PRETTY ? 2 : 0);
if (OUT) {
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, json);
  process.stderr.write('wrote ' + OUT + ' (' + (json.length / 1024).toFixed(0) + ' KB)\n');
} else {
  process.stdout.write(json);
}
