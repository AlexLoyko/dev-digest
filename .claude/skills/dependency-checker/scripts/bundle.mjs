#!/usr/bin/env node
/**
 * bundle.mjs — what a dependency actually costs the person loading the page.
 *
 * Installed size and shipped size are different questions, and conflating them produces
 * bad advice: `typescript` is 22 MB on disk and 0 bytes in the browser, while a 2 MB
 * charting library pulled into a Client Component is the opposite. This script answers
 * the browser half for a Next.js App Router app:
 *
 *   1. Static reachability — for every dependency, where it is imported and whether that
 *      import sits behind a 'use client' boundary (ships) or a Server Component (does not),
 *      and whether it is loaded lazily. Works with no build, always available.
 *   2. Measured chunk sizes — per-route First Load JS from a real production build.
 *      Skipped with an explicit note when only a dev build exists, because dev chunks are
 *      unminified and quoting them would overstate every number several-fold.
 *
 *   node bundle.mjs --app <dir> [--out <file.json>] [--pretty]
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import process from 'node:process';

const argv = process.argv.slice(2);
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i === -1 ? fallback : argv[i + 1];
};
const APP = path.resolve(arg('--app', process.cwd()));
const OUT = arg('--out', null);
const PRETTY = argv.includes('--pretty');

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'clones']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

const walk = (dir, onFile) => {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walk(full, onFile);
    } else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) {
      onFile(full);
    }
  }
};

// ---------------------------------------------------------------------------
// 1. static reachability
// ---------------------------------------------------------------------------
const manifest = readJSON(path.join(APP, 'package.json')) || {};
const deps = Object.keys(manifest.dependencies || {});

const bareName = (spec) => {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

// tsconfig aliases, so `@/components/...` resolves like the bundler resolves it
const tsconfig = readJSON(path.join(APP, 'tsconfig.json'));
const tsPaths = (tsconfig && tsconfig.compilerOptions && tsconfig.compilerOptions.paths) || {};
const aliases = Object.entries(tsPaths).map(([alias, targets]) => ({
  prefix: alias.replace(/\/\*$/, ''),
  target: path.resolve(APP, [].concat(targets)[0].replace(/\/\*$/, '')),
}));

const CANDIDATES = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
const resolveLocal = (fromFile, spec) => {
  let base = null;
  if (spec.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), spec);
  } else {
    const hit = aliases
      .filter((a) => spec === a.prefix || spec.startsWith(a.prefix + '/'))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    if (!hit) return null;
    const rest = spec.slice(hit.prefix.length).replace(/^\//, '');
    base = rest ? path.join(hit.target, rest) : hit.target;
  }
  for (const ext of CANDIDATES) {
    const candidate = base + ext;
    try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* keep trying */ }
  }
  return null;
};

/** Pass 1 — read every file once: its directive, its local imports, its package imports. */
const files = new Map();
walk(APP, (file) => {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  // The directive is only meaningful as the module's first statement.
  const head = text.slice(0, 400);
  // A re-export-only file. Bundlers drop the exports nobody names, so reaching a dependency
  // *through* one is much weaker evidence that it ships than a direct import is.
  // Strip comments wholesale rather than filtering line by line: a block comment's
  // continuation lines carry no leading marker, and treating one as code was enough to
  // make the design-system barrel read as an ordinary module.
  const codeOnly = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const meaningful = codeOnly.split('\n').map((l) => l.trim()).filter(Boolean);
  const isBarrel = meaningful.length > 0
    && /^export\s+(\*|\{|type\s*\{)/m.test(codeOnly)
    && meaningful.every((l) => /^(import|export)\b/.test(l) || /^[}\w'",;{}* ]+$/.test(l));

  const info = {
    declaresClient: /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(head),
    isTest: /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) || file.includes(path.sep + 'test' + path.sep),
    isBarrel,
    localImports: new Set(),
    lazyLocalImports: new Set(),
    pkgImports: [],
  };

  const record = (spec, lazy) => {
    const local = resolveLocal(file, spec);
    if (local) {
      // A lazily imported module is still reachable — it just lands in its own chunk.
      // Dropping these edges would report a dynamically loaded component as dead code.
      (lazy ? info.lazyLocalImports : info.localImports).add(local);
      return;
    }
    const name = bareName(spec);
    if (name && deps.includes(name)) info.pkgImports.push({ name, lazy });
  };

  for (const re of [/\bfrom\s*['"]([^'"]+)['"]/g, /^\s*import\s+['"]([^'"]+)['"]/gm]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) record(m[1], false);
  }
  // next/dynamic and bare import() both defer the cost off the first load
  for (const re of [/\bimport\(\s*(?:\/\*[\s\S]*?\*\/\s*)?['"]([^'"]+)['"]/g,
                    /dynamic\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) record(m[1], true);
  }
  files.set(file, info);
});

/**
 * Pass 2 — reachability from the routes, then the client boundary.
 *
 * Two mistakes to avoid, and they pull in opposite directions:
 *
 *   Treating each file's own first line as the answer *understates* the bundle. In the App
 *   Router the directive marks an entry point, and everything it imports joins the client
 *   graph — a chart component with no directive that a client page imports still ships.
 *
 *   Treating every 'use client' file as a root *overstates* it. A client component nobody
 *   routes to ships nothing. In this repo that is not hypothetical: the chart components
 *   are imported only by a Showcase that no route renders, so a naive walk reports the
 *   heaviest charting library as shipping when the bundler drops it entirely.
 *
 * So: walk from the route entry points, and only then apply the directive.
 */
const ROUTE_FILE = /(^|\/)(page|layout|template|default|error|global-error|loading|not-found|route)\.[cm]?[jt]sx?$/;
const appDir = path.join(APP, 'src', 'app');
const routeEntries = [...files.keys()].filter((f) => {
  const rel = path.relative(APP, f).split(path.sep).join('/');
  return ROUTE_FILE.test(rel) && (f.startsWith(appDir) || rel.includes('/app/'));
});

/**
 * Reachability from the routes, carrying two qualifiers per file:
 *
 *   barrelOnly — every path here went through a re-export barrel, so tree-shaking probably
 *                drops it and any "this ships" claim is weak.
 *   lazyOnly   — every path here crossed a dynamic import, so it ships in its own chunk
 *                rather than on first load.
 *
 * Both start optimistic and relax to false the moment a stronger path appears; a file already
 * seen is re-queued when the new path is stronger, which is what makes the result independent
 * of traversal order.
 */
const reach = new Map(); // file -> { barrelOnly, lazyOnly }
const work = [];
for (const entry of routeEntries) { reach.set(entry, { barrelOnly: false, lazyOnly: false }); work.push(entry); }
while (work.length) {
  const cur = work.pop();
  const info = files.get(cur);
  if (!info) continue;
  const from = reach.get(cur);
  const edges = [
    ...[...info.localImports].map((f) => ({ f, lazy: false })),
    ...[...info.lazyLocalImports].map((f) => ({ f, lazy: true })),
  ];
  for (const { f, lazy } of edges) {
    const next = {
      barrelOnly: from.barrelOnly || info.isBarrel,
      lazyOnly: from.lazyOnly || lazy,
    };
    const prev = reach.get(f);
    const stronger = !prev
      || (prev.barrelOnly && !next.barrelOnly)
      || (prev.lazyOnly && !next.lazyOnly);
    if (!stronger) continue;
    reach.set(f, prev ? {
      barrelOnly: prev.barrelOnly && next.barrelOnly,
      lazyOnly: prev.lazyOnly && next.lazyOnly,
    } : next);
    work.push(f);
  }
}

// The client boundary, applied only to what a user can actually reach.
const clientFiles = new Set();
const queue = [];
for (const [file, info] of files) {
  if (info.declaresClient && reach.has(file)) { clientFiles.add(file); queue.push(file); }
}
while (queue.length) {
  const cur = queue.pop();
  const info = files.get(cur);
  if (!info) continue;
  for (const imported of [...info.localImports, ...info.lazyLocalImports]) {
    if (clientFiles.has(imported) || !reach.has(imported)) continue;
    clientFiles.add(imported);
    queue.push(imported);
  }
}

const sites = new Map(); // dep -> [{ file, boundary, lazy }]
for (const [file, info] of files) {
  let boundary;
  if (info.isTest) boundary = 'test';
  else if (!reach.has(file)) boundary = 'unreferenced'; // no route reaches this file at all
  else if (clientFiles.has(file)) boundary = 'client';
  else boundary = 'server';
  const qual = reach.get(file) || { barrelOnly: false, lazyOnly: false };
  for (const { name, lazy } of info.pkgImports) {
    if (!sites.has(name)) sites.set(name, []);
    sites.get(name).push({
      file: path.relative(APP, file),
      boundary,
      // Eagerly imported inside a file that is itself only reached lazily is still deferred.
      lazy: lazy || qual.lazyOnly,
      viaBarrelOnly: qual.barrelOnly,
    });
  }
}

const reachability = deps.map((name) => {
  const found = sites.get(name) || [];
  const client = found.filter((s) => s.boundary === 'client');
  const eager = client.filter((s) => !s.lazy);
  const certain = eager.filter((s) => !s.viaBarrelOnly);
  return {
    name,
    shipsToBrowser: client.length > 0,
    eagerlyLoaded: eager.length > 0,
    // Every eager path runs through a re-export barrel. That is a genuine unknown, not a
    // verdict: the bundler tree-shakes per export while this walk only sees whole files.
    // Measured against a real build of this repo, barrel-only packages went both ways —
    // recharts and mermaid were dropped, react-markdown, lucide-react and d3 shipped.
    confidence: eager.length === 0 ? 'n/a' : (certain.length ? 'certain' : 'via-barrel-only'),
    clientSites: client.length,
    serverSites: found.filter((s) => s.boundary === 'server').length,
    testSites: found.filter((s) => s.boundary === 'test').length,
    // Imported somewhere, but no route reaches that file — dead code, and possibly a dead dependency.
    unreferencedSites: found.filter((s) => s.boundary === 'unreferenced').length,
    // The actionable detail: which file to open if this needs to become lazy.
    examples: (certain.length ? certain : (eager.length ? eager : client)).slice(0, 4).map((s) => s.file),
  };
}).sort((a, b) => Number(b.eagerlyLoaded) - Number(a.eagerlyLoaded) || b.clientSites - a.clientSites);

// ---------------------------------------------------------------------------
// 2. measured chunks (production build only)
// ---------------------------------------------------------------------------
const next = path.join(APP, '.next');
const hasBuildId = fs.existsSync(path.join(next, 'BUILD_ID'));
const looksDev = fs.existsSync(path.join(next, 'static', 'development'));

let build = { available: false, reason: '' };
if (!fs.existsSync(next)) {
  build.reason = 'no .next directory — run the production build first';
} else if (!hasBuildId || looksDev) {
  build.reason = 'only a development build is present (no BUILD_ID, or static/development exists); '
    + 'dev chunks are unminified, so their sizes would overstate the real cost. '
    + 'Run the production build to populate this section.';
} else {
  const sizeOf = (rel) => {
    const abs = path.join(next, rel);
    try {
      const raw = fs.readFileSync(abs);
      return { bytes: raw.length, gzipBytes: zlib.gzipSync(raw).length };
    } catch { return { bytes: 0, gzipBytes: 0 }; }
  };

  const appManifest = readJSON(path.join(next, 'app-build-manifest.json'))
    || readJSON(path.join(next, 'build-manifest.json'));
  const routes = [];
  const chunkCache = new Map();
  const measure = (rel) => {
    if (!chunkCache.has(rel)) chunkCache.set(rel, sizeOf(rel));
    return chunkCache.get(rel);
  };

  for (const [route, files] of Object.entries((appManifest && appManifest.pages) || {})) {
    const js = files.filter((f) => f.endsWith('.js'));
    let bytes = 0, gzipBytes = 0;
    for (const f of js) { const s = measure(f); bytes += s.bytes; gzipBytes += s.gzipBytes; }
    routes.push({ route, chunks: js.length, bytes, gzipBytes });
  }
  routes.sort((a, b) => b.gzipBytes - a.gzipBytes);

  const chunks = [...chunkCache.entries()]
    .map(([file, s]) => ({ file, bytes: s.bytes, gzipBytes: s.gzipBytes }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
    .slice(0, 20);

  build = {
    available: true,
    reason: '',
    buildId: fs.readFileSync(path.join(next, 'BUILD_ID'), 'utf8').trim(),
    routes,
    largestChunks: chunks,
    totalGzipBytes: [...chunkCache.values()].reduce((s, c) => s + c.gzipBytes, 0),
  };
}

const report = {
  schema: 'dependency-checker/bundle@1',
  generatedAt: new Date().toISOString(),
  app: APP,
  reachability,
  build,
};

const json = JSON.stringify(report, null, PRETTY ? 2 : 0);
if (OUT) {
  fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
  fs.writeFileSync(OUT, json);
  process.stderr.write('wrote ' + OUT + '\n');
} else {
  process.stdout.write(json);
}
