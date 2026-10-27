#!/usr/bin/env node
// Waymark · `waymark.mjs convention` (docs/adr/0043): what the repository itself says about how it is built. A profile is a
// reference, never the project's rule, so before any placement or move this censuses where each kind of piece lives (components,
// modals, services, models, styles), names the commit that set the structure and lists the project's own docs. Read-only.
//   node convention.mjs [<path>] [--json]
//   node convention.mjs [<path>] --move <from> <to> [--kind ui|component|modal|service|model|style] [--files N]
//     the verdict of one proposed move: "follows the convention" or "CONTRADICTS the project's convention" (a layer is shared, core,
//     features, other, or a repo-relative path inside one); the window of a structural change shows that line.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './lib/git.mjs';
import { read } from './lib/fs.mjs';

const SKIP = /(^|\/)(\.git|node_modules|dist|build|out|coverage|\.angular|\.next|\.nuxt|vendor|target|\.waymark|\.agents|\.claude|\.engram)(\/|$)/;
const SHARED = /^(shared|common|ui|components|lib|libs)$/, CORE = /^core$/, FEATURES = /^(features|modules|domains)$/;
const MIN_PIECES = 4, DOMINANT = 0.6; // a kind needs this many pieces to say anything, and this share in one layer to have a convention

// A TypeScript file with no name that says what it is: a component of the newer naming (no .component suffix) holds @Component.
const NAMED_TS = /\.(service|store|model|entity|dto|interface|routes|config|guard|pipe|directive|resolver|module|util|utils|types|enum|const|constants|mock|mocks|fixture)\.ts$/;
const isComponentFile = (repo, rel) => { try { return /@Component\s*\(/.test(fs.readFileSync(path.join(repo, rel), 'utf8').slice(0, 20000)); } catch { return false; } };

// One file → its kind, by name (a component counts once: its .ts, never its .html or .css).
function kindOf(rel, probe) {
  const base = path.posix.basename(rel);
  if (/\.(spec|test|stories|d)\.[a-z]+$/i.test(base)) return null;
  if (/\.(service|store)\.(ts|js|rb|py)$/.test(base)) return 'service';
  if (/\.(model|entity|dto|interface)\.ts$/.test(base)) return 'model';
  if (/(modal|dialog)/i.test(base) && /\.(component\.ts|tsx|jsx|vue|svelte)$/.test(base)) return 'modal';
  if (/\.(component\.ts|tsx|jsx|vue|svelte)$/.test(base)) return 'component';
  if (/\.(css|scss|sass|less)$/.test(base)) return 'style';
  if (/\.ts$/.test(base) && !NAMED_TS.test(base) && probe(rel)) return /(modal|dialog)/i.test(base) ? 'modal' : 'component';
  return null;
}

// The folder pieces are counted under: src/app, src or app, or one of those inside a monorepo package; the one holding most pieces.
function roots(files, kinds) {
  const cands = new Map();
  for (const f of files) {
    const m = f.match(/^((?:(?:apps|packages|projects|libs)\/[^/]+\/)?(?:src\/app|src|app))\//);
    if (m && kinds.get(f)) cands.set(m[1], (cands.get(m[1]) || 0) + 1);
  }
  return [...cands.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

const groupOfSeg = (s) => (SHARED.test(s) ? 'shared' : CORE.test(s) ? 'core' : FEATURES.test(s) ? 'features' : 'other');
// The home a piece outside the features belongs to: shared/components for shared/components/<piece>/<file>, shared for shared/<piece>/<file>.
const homeKey = (segs) => (segs.length < 3 || groupOfSeg(segs[0]) === 'features' ? null : segs.slice(0, segs.length > 3 ? 2 : 1).join('/'));
const libraryOf = (conv) => conv.homes.find((h) => h.group === 'shared' && h.ui >= MIN_PIECES) || null;
const sinceOf = (h) => (h.since ? ` since ${h.since.hash} (${h.since.date})` : '');

// A component of the newer naming in the history, where its file cannot be opened to look for @Component: <piece>/<piece>.ts.
const namedLikeItsFolder = (rel) => { const p = rel.split('/'), base = p.pop(); return /\.ts$/.test(base) && !NAMED_TS.test(base) && !/\.(spec|test|d)\.ts$/.test(base) && base.replace(/\.ts$/, '') === p.pop(); };

// The latest commit that moved at least MIN_PIECES UI pieces from one layer to another: { hash, date, n, from, to } or null. The tree after
// it is what the census counts, so the line names it: the structure before that commit is the older convention.
function lastMove(repo, root) {
  const r = git(repo, ['log', '-M', '--diff-filter=R', '--name-status', '--format=@%h %cs', '-n', '300', '--', root], { timeout: 8000 });
  if (r.status !== 0) return null;
  const under = (f) => (f.startsWith(root + '/') ? f.slice(root.length + 1).split('/') : null);
  for (const block of String(r.stdout).split('\n@').map((b) => b.replace(/^@/, ''))) {
    const [head, ...rows] = block.split('\n'), [hash, date] = head.split(' '), counts = {};
    for (const row of rows) {
      const [st, from, to] = row.split('\t');
      if (!/^R/.test(st || '') || !to || !(/^(component|modal)$/.test(kindOf(to, () => false) || '') || namedLikeItsFolder(to))) continue;
      const a = under(from), b = under(to);
      if (!a || !b || a.length < 2 || b.length < 2 || groupOfSeg(a[0]) === groupOfSeg(b[0])) continue;
      const k = `${homeKey(a) || a[0]}\t${groupOfSeg(b[0])}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    const best = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
    if (best && best[1] >= MIN_PIECES) { const [from, to] = best[0].split('\t'); return { hash, date, n: best[1], from: `${root}/${from}`, to }; }
  }
  return null;
}

function listFiles(repo) {
  const r = git(repo, ['ls-files', '-co', '--exclude-standard']);
  if (r.status === 0) return String(r.stdout).split('\n').filter((f) => f && !SKIP.test(f));
  const out = [];
  const walk = (d, rel) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (SKIP.test(p)) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), p); else out.push(p);
    }
  };
  walk(repo, '');
  return out;
}

// The oldest commit that added a file under `dir`: { hash, date } or null (no git, or nothing committed there).
function firstCommit(repo, dir) {
  const r = git(repo, ['log', '--diff-filter=A', '--format=%h%x09%cs', '--', dir], { timeout: 8000 });
  if (r.status !== 0) return null;
  const last = String(r.stdout).trim().split('\n').filter(Boolean).pop();
  if (!last) return null;
  const [hash, date] = last.split('\t');
  return { hash, date };
}

// repo-relative path or layer name → its group (shared | core | features | other), given the source root.
export function groupOf(conv, spec) {
  if (/^(shared|core|features|other)$/.test(spec)) return spec;
  const rel = String(spec).replace(/\\/g, '/').replace(/^\.?\//, '');
  const under = conv.root && rel.startsWith(conv.root + '/') ? rel.slice(conv.root.length + 1) : rel;
  return groupOfSeg(under.split('/')[0]);
}

export function census(repoPath) {
  const repo = path.resolve(repoPath || '.');
  let reads = 4000; // files opened to look for @Component: a hook runs this, so a huge repo is read in part, not all
  const probe = (rel) => reads-- > 0 && isComponentFile(repo, rel);
  const files = listFiles(repo), kinds = new Map(files.map((f) => [f, kindOf(f, probe)])), rootList = roots(files, kinds);
  const lock = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb', 'bun.lock'].find((l) => fs.existsSync(path.join(repo, l))) || null;
  const docs = ['AGENTS.md', 'CLAUDE.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'docs/adr', 'docs/architecture', 'docs/architecture.md'].filter((d) => fs.existsSync(path.join(repo, d)));
  const conv = { repo, root: rootList[0] || null, lockfile: lock, docs, total: 0, kinds: {}, layers: {}, featureFolders: {}, variant: 'none', structure: null, homes: [], moves: null };
  if (!conv.root) { conv.line = noConvention(conv, 'no source folder with components, services or styles'); return conv; }
  const layerFiles = {}, homeCounts = {};
  for (const f of files) {
    if (!f.startsWith(conv.root + '/')) continue;
    const k = kinds.get(f);
    if (!k) continue;
    const segs = f.slice(conv.root.length + 1).split('/');
    const group = segs.length > 1 ? groupOfSeg(segs[0]) : 'other';
    const layer = group === 'features' && segs.length > 2 ? `${segs[0]}/${segs[1]}` : segs.length > 1 ? segs[0] : '.';
    conv.total++;
    const kind = conv.kinds[k] || (conv.kinds[k] = { total: 0, shared: 0, core: 0, features: 0, other: 0 });
    kind.total++; kind[group]++;
    conv.layers[layer] = (conv.layers[layer] || 0) + 1;
    if (group === 'features' && segs.length > 3) conv.featureFolders[segs[2]] = (conv.featureFolders[segs[2]] || 0) + 1;
    const top = segs.length > 1 ? segs[0] : null;
    if (top) layerFiles[top] = (layerFiles[top] || 0) + 1;
    const home = homeKey(segs);
    if (home && /^(component|modal|style)$/.test(k)) { const h = homeCounts[home] || (homeCounts[home] = { ui: 0, style: 0 }); h[k === 'style' ? 'style' : 'ui']++; }
  }
  // a folder outside the features that holds a library of UI pieces is a home of its own, whatever the features hold (docs/adr/0043)
  conv.homes = Object.entries(homeCounts).filter(([, h]) => h.ui >= MIN_PIECES || h.style >= MIN_PIECES)
    .map(([key, h]) => ({ key, dir: `${conv.root}/${key}`, group: groupOfSeg(key.split('/')[0]), ...h })).sort((a, b) => b.ui - a.ui)
    .map((h) => ({ ...h, since: firstCommit(repo, h.dir) }));
  conv.moves = lastMove(repo, conv.root);
  for (const kind of Object.values(conv.kinds)) {
    const best = ['shared', 'core', 'features', 'other'].sort((a, b) => kind[b] - kind[a])[0];
    kind.dominant = kind.total >= MIN_PIECES && kind[best] / kind.total >= DOMINANT ? best : null;
  }
  const ui = ['component', 'modal'].reduce((a, k) => ({ total: a.total + (conv.kinds[k]?.total || 0), shared: a.shared + (conv.kinds[k]?.shared || 0), features: a.features + (conv.kinds[k]?.features || 0) }), { total: 0, shared: 0, features: 0 });
  const tops = Object.keys(layerFiles), hasLayers = tops.some((l) => groupOfSeg(l) === 'shared') && tops.some((l) => groupOfSeg(l) === 'features');
  if (hasLayers && ui.total >= MIN_PIECES) {
    const share = ui.shared / ui.total;
    conv.variant = share >= DOMINANT ? 'shared-ui' : share <= 1 - DOMINANT ? 'scope-rule' : 'mixed';
    if (conv.variant !== 'shared-ui' && ui.features >= MIN_PIECES && libraryOf(conv)) conv.variant = 'shared-library';
  }
  // the oldest commit that added each of the three biggest layer folders: when the structure was set
  const dirs = Object.entries(layerFiles).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([l]) => `${conv.root}/${l}`);
  const firsts = dirs.map((d) => ({ dir: d, ...firstCommit(repo, d) })).filter((c) => c.hash);
  conv.structure = firsts.sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  conv.hasLayers = hasLayers;
  conv.line = summary(conv);
  return conv;
}

const share = (k) => `${k.dominant ? k[k.dominant] : Math.max(k.shared, k.core, k.features, k.other)}/${k.total}`;
function noConvention(conv, why) {
  return `no convention detected (${why}): the profile default applies, marked "profile default", never "the project's rule"`;
}
function summary(conv) {
  const moved = conv.moves ? `; commit ${conv.moves.hash} (${conv.moves.date}) moved ${conv.moves.n} pieces from ${conv.moves.from} to ${conv.moves.to}: the tree before it shows the older convention, ask before following the newer one` : '';
  const line = base(conv);
  return conv.variant === 'none' ? line : `${line}${moved}`;
}
function base(conv) {
  const since = conv.structure ? `; the structure dates from ${conv.structure.hash} (${conv.structure.date})` : '';
  const ui = ['component', 'modal'].map((k) => conv.kinds[k]).filter(Boolean);
  const lib = libraryOf(conv);
  if (conv.variant === 'shared-library') return `Shared library + feature screens: reusable UI lives in ${lib.dir} (${lib.ui} pieces${sinceOf(lib)}); the features hold their own screens and pieces (${ui.reduce((a, k) => a + k.features, 0)})${since}`;
  if (conv.variant === 'shared-ui') return `Shared UI: ${ui.map((k) => `${k.shared}/${k.total}`).join(' + ')} UI pieces live in shared/, features hold the logic${since}`;
  if (conv.variant === 'scope-rule') return `Scope Rule: UI pieces live inside the feature that uses them (${ui.reduce((a, k) => a + k.features, 0)} of ${ui.reduce((a, k) => a + k.total, 0)})${since}`;
  if (conv.variant === 'mixed') return `mixed: UI pieces are split between shared/ and the features (${ui.reduce((a, k) => a + k.shared, 0)} / ${ui.reduce((a, k) => a + k.features, 0)}); follow the closest sibling file, ask on a structural change${since}`;
  return noConvention(conv, !conv.total ? 'no pieces to count' : conv.hasLayers ? `only ${conv.total} pieces: too few to tell` : `${conv.total} pieces, but no shared and feature layers to compare`);
}

// Where a new piece of `kind` goes: the layer that holds most of that kind, with its evidence; null when the repo shows no convention for it.
export function whereToPlace(conv, kind) {
  const lib = libraryOf(conv);
  if (conv.variant === 'shared-library' && /^(ui|component|modal)$/.test(kind)) {
    return { layer: null, home: lib.dir, line: `two homes: a reusable piece goes to ${lib.dir} (${lib.ui} pieces${sinceOf(lib)}); a screen or a piece of one feature goes inside that feature; ask when it is unclear` };
  }
  const ks = kind === 'ui' ? ['component', 'modal'].map((k) => conv.kinds[k]).filter(Boolean) : [conv.kinds[kind]].filter(Boolean);
  const k = ks.length === 1 ? ks[0] : ks.length ? ks.reduce((a, b) => ({ total: a.total + b.total, shared: a.shared + b.shared, core: a.core + b.core, features: a.features + b.features, other: a.other + b.other })) : null;
  if (!k || k.total < MIN_PIECES) return { layer: null, line: noConvention(conv, `fewer than ${MIN_PIECES} ${kind} pieces`) };
  const best = ['shared', 'core', 'features', 'other'].sort((a, b) => k[b] - k[a])[0];
  if (k[best] / k.total < DOMINANT) return { layer: null, line: noConvention(conv, `${kind} pieces are split between layers`) };
  return { layer: best, line: `${kind} pieces live in ${best} (${k[best]}/${k.total})${conv.structure ? `, set by ${conv.structure.hash} (${conv.structure.date})` : ''}` };
}

// The verdict of moving pieces of `kind` out of `from` into `to` (groups or paths): the line a structural-change window shows.
// The home a layer name or a path falls in (a layer name is its biggest home), or null.
function homeOf(conv, spec) {
  if (/^(shared|core|features|other)$/.test(spec)) return conv.homes.find((h) => h.group === spec) || null;
  const rel = String(spec).replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/$/, '');
  const under = conv.root && rel.startsWith(conv.root + '/') ? rel.slice(conv.root.length + 1) : rel;
  return conv.homes.find((h) => under === h.key || under.startsWith(h.key + '/')) || null;
}

// The verdict of moving pieces of `kind` out of `from` into `to` (groups or paths): the line a structural-change window shows. A move out of a
// home contradicts it even when another layer holds more pieces; a move into one follows it.
export function judgeMove(conv, kind, from, to) {
  const count = (h) => (h ? (kind === 'style' ? h.style : /^(ui|component|modal)$/.test(kind) ? h.ui : 0) : 0);
  const hf = homeOf(conv, from), ht = homeOf(conv, to);
  if (count(hf) >= MIN_PIECES && ht !== hf) return { verdict: 'contradicts', line: `CONTRADICTS the project's convention: ${hf.dir} has held ${count(hf)} ${kind} pieces${sinceOf(hf)}; moving them out to ${groupOf(conv, to)} goes against it. Recommended: do not move` };
  if (count(ht) >= MIN_PIECES && ht !== hf) return { verdict: 'follows', line: `follows the convention: ${ht.dir} is where ${kind} pieces live (${count(ht)}${sinceOf(ht)})` };
  const f = groupOf(conv, from), t = groupOf(conv, to), at = whereToPlace(conv, kind);
  if (!at.layer) return { verdict: 'no-convention', line: at.line };
  if (f === at.layer && t !== at.layer) return { verdict: 'contradicts', line: `CONTRADICTS the project's convention: ${at.line}; moving ${kind} pieces from ${f} to ${t} goes against it. Recommended: do not move` };
  return { verdict: 'follows', line: `follows the convention: ${at.line}` };
}

// memory.md: the Architecture and Conventions placeholders of the template become what the census found, marked "(to confirm)".
// Never overwrites a line somebody wrote. → true when the file changed.
export function fillMemory(file, conv) {
  const text = read(file);
  if (!text || !conv.total) return false;
  let out = text;
  const slug = conv.variant === 'none' ? 'unknown' : 'screaming';
  const arch = `- Architecture: ${slug} — ${conv.line} — evidence: census of ${conv.total} pieces under ${conv.root}/${conv.docs.length ? `; project docs: ${conv.docs.join(', ')}` : ''} (to confirm)`;
  out = out.replace(/^- Architecture:\s*<slug[^\n]*$/m, arch);
  const bullets = [`- Placement (to confirm, detected ${new Date().toISOString().slice(0, 10)}): ${conv.line}`, ...Object.entries(conv.kinds).filter(([, k]) => k.dominant).map(([n, k]) => `- ${n} pieces live in ${k.dominant} (${k[k.dominant]}/${k.total}); a new one goes there`)];
  if (conv.lockfile) bullets.push(`- Package manager: the repo's lockfile (${conv.lockfile})`);
  out = out.replace(/(## Conventions specific to this project\n)- …\n/, `$1${bullets.join('\n')}\n`);
  if (out === text) return false;
  fs.writeFileSync(file, out);
  return true;
}

const RUN = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (RUN) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const mi = args.indexOf('--move');
  const target = args.find((a, i) => !a.startsWith('--') && (mi < 0 || (i !== mi + 1 && i !== mi + 2)) && a !== opt('--kind') && a !== opt('--files')) || '.';
  const conv = census(target);
  if (mi >= 0) {
    const kind = opt('--kind') || 'ui', from = args[mi + 1], to = args[mi + 2], n = opt('--files');
    const v = judgeMove(conv, kind, from, to);
    console.log(args.includes('--json') ? JSON.stringify({ ...v, kind, from, to, files: n ? Number(n) : null }) : `convention: ${n ? `${n} files, ` : ''}${kind}: ${from} → ${to}: ${v.line}`);
  } else if (args.includes('--json')) console.log(JSON.stringify(conv, null, 2));
  else {
    console.log(`convention: ${conv.line}`);
    for (const [n, k] of Object.entries(conv.kinds)) console.log(`  ${n}: shared ${k.shared} · core ${k.core} · features ${k.features} · other ${k.other}${k.dominant ? ` → ${k.dominant}` : ''}`);
    if (Object.keys(conv.featureFolders).length) console.log(`  inside features: ${Object.entries(conv.featureFolders).map(([n, c]) => `${n} ${c}`).join(' · ')}`);
    console.log(`  source root: ${conv.root || 'none'} · lockfile: ${conv.lockfile || 'none'} · docs: ${conv.docs.join(', ') || 'none'}`);
  }
}
