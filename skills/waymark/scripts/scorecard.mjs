#!/usr/bin/env node
// Waymark · the scorecard (docs/adr/0028): what "95 %" means, computed by checks and never by opinion.
// docs/scorecard.json lists 13 criteria with a weight each and, for each, deterministic checks: a file that exists, a pattern
// that is (or is not) in some files, a command that exits 0, or a number measured from the project's records and the sources.
// A check scores 1 or 0, or a ratio against its threshold; a criterion is the mean of its checks; the total is the sum of
// weight x criterion and is never rounded up. A check that is not built yet scores 0 and names the plan point that adds it.
// The weights, criteria, checks and thresholds are locked by the hash in the ADR named in `adr` (tests/scorecard.test.mjs).
//   node scorecard.mjs [--json] [--min <total>]    run from the Waymark repository root; --min exits 1 below that total
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', '.waymark', '.engram']);

export const readScorecard = (root) => JSON.parse(fs.readFileSync(path.join(root, 'docs', 'scorecard.json'), 'utf8'));

// The lock covers everything but the ADR name and the prose of `about`: a weight, a criterion, a check or a threshold
// cannot change without a new lock in an ADR.
export function lockOf(card) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  const { adr, about, ...rest } = card;
  return crypto.createHash('sha256').update(JSON.stringify(sort(rest))).digest('hex');
}

// The lock the ADR named by the card holds: its `Scorecard-Lock: <sha256>` line.
export function adrLock(root, card) {
  const dir = path.join(root, 'docs', 'adr');
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.startsWith(`${card.adr}-`)) : null;
  return file ? (fs.readFileSync(path.join(dir, file), 'utf8').match(/^Scorecard-Lock:\s*([0-9a-f]{64})\s*$/m)?.[1] || null) : null;
}

const home = (p) => (p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
const TEXT = /\.(mjs|js|json|md|yml|yaml|txt)$|ALLOWED_SIGNERS$|skills\.lock$/;

// A `files` entry → the files it names: a path, `dir/` or `dir/**` (recursive), or `dir/*.ext`.
function expand(root, spec) {
  const walk = (d) => (fs.existsSync(d) && fs.statSync(d).isDirectory()
    ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (SKIP_DIRS.has(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]))
    : []);
  const abs = (p) => path.resolve(root, home(p));
  if (spec.endsWith('/')) spec = spec.slice(0, -1); // `dir/` and `dir/**` both mean the folder, recursively
  if (spec.endsWith('/**')) spec = spec.slice(0, -3);
  if (spec.includes('*')) {
    const dir = abs(path.dirname(spec)), re = new RegExp(`^${path.basename(spec).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f)) : [];
    return { exists: files.length > 0, files };
  }
  const at = abs(spec), isFile = fs.existsSync(at) && fs.statSync(at).isFile();
  return { exists: fs.existsSync(at), files: isFile ? [at] : walk(at) };
}

const text = (files) => files.filter((f) => TEXT.test(f)).map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });
const as = (v) => (Array.isArray(v) ? v : [v]);

// ---- measures: a number computed from the project's records or sources; null when it cannot be measured here ----
// The last n tasks of the project's log; `full` keeps those whose detail (the git note) could be read, which hold the fields.
const recent = async (root, n = 30, full = true) => {
  const { projectHome, readTaskRecords } = await import(pathToFileURL(path.join(HERE, 'provenance.mjs')).href);
  const h = projectHome(root);
  const last = h.dir ? readTaskRecords(h).filter((r) => r.id && !r.kind).slice(-n) : [];
  return full ? last.filter((r) => r.schema) : last;
};
const share = (rs, f) => (rs.length ? rs.filter(f).length / rs.length : null);
const MEASURES = {
  async 'chain.intact'(root) {
    const { chainReport } = await import(pathToFileURL(path.join(HERE, 'verify.mjs')).href);
    const r = chainReport(root);
    return r.records ? (r.ok ? 1 : 0) : null;
  },
  async 'records.fieldShare'(root) {
    return share(await recent(root), (r) => r.prompt && r.cierre && Array.isArray(r.decisions) && r.evaluation && r.inputs && r.pinned && r.observed);
  },
  async 'records.detailShare'(root) { return share(await recent(root, 30, false), (r) => r.schema); },
  async 'records.pinnedShare'(root) { return share(await recent(root, 20), (r) => r.pinned); },
  async 'records.tokenShare'(root) { return share(await recent(root), (r) => r.evaluation?.tokens > 0 && r.evaluation?.links); },
  async 'records.cierreShare'(root) { return share(await recent(root), (r) => /Resultado:/.test(r.cierre || '') && /Evidencia:/.test(r.cierre || '') && /Aprendido:/.test(r.cierre || '')); },
  async 'records.decisionShare'(root) {
    const rs = (await recent(root)).filter((r) => r.level >= 2);
    return share(rs, (r) => (r.decisions || []).some((d) => d.position === 'before'));
  },
  async 'records.testigoRatio'(root) {
    const parts = (await recent(root)).map((r) => (r.evaluation?.score || '').match(/^(\d+)\/(\d+)/)).filter(Boolean).map((m) => +m[1] / +m[2]);
    return parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
  },
  async 'records.backedShare'(root) {
    const ev = (await recent(root)).map((r) => r.observed?.evidence).filter((e) => e?.cited > 0);
    const cited = ev.reduce((a, e) => a + e.cited, 0);
    return cited ? (cited - ev.reduce((a, e) => a + (e.unbacked?.length || 0), 0)) / cited : null;
  },
  async 'records.followUpShare'(root) { return share(await recent(root, 30, false),(r) => /T\d+[a-z]+$/.test(r.id)); },
  // The latest release tag is signed by a key in ALLOWED_SIGNERS. The manifest's own signature is checked at the release
  // (verify --install --require-signature, plan point 12): it is regenerated, and so unsigned, at each point that adds a file.
  async 'release.tagSigned'(root) {
    const { signatureState } = await import(pathToFileURL(path.join(HERE, 'verify.mjs')).href);
    const tag = spawnSync('git', ['tag', '-l', 'v*', '--sort=-v:refname'], { cwd: root, encoding: 'utf8' }).stdout?.split('\n')[0]?.trim();
    if (!tag) return null;
    const r = signatureState(root, tag, { tag: true, allowed: path.join(root, 'skills', 'waymark', 'ALLOWED_SIGNERS') });
    return r.state === 'unchecked' ? null : r.state === 'signed' ? 1 : 0;
  },
  async 'notes.unpushed'(root) {
    const { unpushedNotes, hasRemote } = await import(pathToFileURL(path.join(HERE, 'notes.mjs')).href);
    return hasRemote(root) ? unpushedNotes(root) : null;
  },
  async 'agents.adapterShare'() {
    const a = JSON.parse(fs.readFileSync(path.join(HERE, 'agents', 'agents.json'), 'utf8')).agents;
    return a.length ? a.filter((x) => x.adapter).length / a.length : null;
  },
  async 'size.fixedContext'(root) {
    const rows = (await import(pathToFileURL(path.join(HERE, 'size.mjs')).href)).sizes(root);
    const n = (name) => rows.find((r) => r.name === name)?.chars || 0;
    return n('instructions block') + n('context card') + n('skill descriptions');
  },
  async 'size.perPrompt'(root) { return (await import(pathToFileURL(path.join(HERE, 'size.mjs')).href)).sizes(root).find((r) => r.name === 'reminder (real)')?.chars ?? null; },
  // Not built yet: they read null (unmeasured) until the plan point that adds them (docs/plans/2.0.18.md).
  async 'cost.routineShareL2'(root) { const C = await import(pathToFileURL(path.join(HERE, 'cost.mjs')).href); return C.routineShare(C.tasksOf(root), 2, 10)?.share ?? null; },
  async 'cost.routineShareL1'(root) { const C = await import(pathToFileURL(path.join(HERE, 'cost.mjs')).href); return C.routineShare(C.tasksOf(root), 1, 5)?.share ?? null; },
  async 'precedent.precisionAt3'() { return null; },     // point 5
  async 'precedent.maxChars'() { return null; },         // point 5
  async 'conformance.cases'(root) {
    const f = path.join(root, 'tests', 'conformance', 'cases.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).cases?.length ?? null : null;
  },
};

export const MEASURE_NAMES = Object.keys(MEASURES);

// ---- one check → { score 0..1, status: pass | fail | pending | unmeasured, detail } ----
async function runCheck(root, c) {
  if (c.kind === 'exists') {
    const missing = as(c.files).filter((f) => !expand(root, f).exists);
    return missing.length ? { score: 0, status: 'fail', detail: `missing: ${missing.join(', ')}` } : { score: 1, status: 'pass' };
  }
  if (c.kind === 'contains') {
    const files = as(c.files).flatMap((f) => expand(root, f).files), body = text(files).join('\n');
    const lost = as(c.pattern).filter((p) => !new RegExp(p, c.flags).test(body));
    return !files.length ? { score: 0, status: 'fail', detail: 'no file to read' } : lost.length ? { score: 0, status: 'fail', detail: `not found: ${lost.join(' · ')}` } : { score: 1, status: 'pass' };
  }
  if (c.kind === 'absent') {
    const files = as(c.files).flatMap((f) => expand(root, f).files), re = new RegExp(c.pattern, c.flags);
    if (!files.length) return { score: 0, status: 'fail', detail: 'no file to read' };
    const hits = files.filter((f) => TEXT.test(f) && re.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(root, f).replace(/\\/g, '/'));
    return hits.length ? { score: 0, status: 'fail', detail: `found in ${hits.length} file(s): ${hits.slice(0, 3).join(', ')}` } : { score: 1, status: 'pass' };
  }
  if (c.kind === 'run') {
    const r = spawnSync(c.command[0] === 'node' ? process.execPath : c.command[0], c.command.slice(1), { cwd: root, encoding: 'utf8', timeout: 180000 });
    return r.status === 0 ? { score: 1, status: 'pass' } : { score: 0, status: 'fail', detail: `exit ${r.status ?? r.error?.code ?? '?'}: ${c.command.join(' ')}` };
  }
  if (c.kind === 'measure') {
    const fn = MEASURES[c.measure];
    let value = null;
    try { value = fn ? await fn(root) : null; } catch { value = null; }
    if (value === null || value === undefined) return { score: 0, status: 'unmeasured', detail: `${c.measure} cannot be measured here yet` };
    if (c.threshold === null) return { score: 0, status: 'pending', value, detail: `${c.measure} = ${fmt(value)}; threshold frozen in point ${c.frozenIn}` };
    const score = c.op === 'ge' ? Math.min(1, value / c.threshold) : value <= c.threshold ? 1 : Math.min(1, c.threshold / value);
    return { score, status: score >= 1 ? 'pass' : 'fail', value, detail: `${c.measure} = ${fmt(value)} (${c.op === 'ge' ? '≥' : '≤'} ${c.threshold})` };
  }
  return { score: 0, status: 'fail', detail: `unknown kind ${c.kind}` };
}
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
const floor1 = (x) => Math.floor(x * 10 + 1e-9) / 10;

export async function scorecard(root) {
  const card = readScorecard(root);
  const criteria = [];
  for (const k of card.criteria) {
    const results = [];
    for (const c of k.checks) results.push({ id: c.id, what: c.what, point: c.point, ...(await runCheck(root, c)) });
    criteria.push({ id: k.id, name: k.name, weight: k.weight, target: k.target, percent: (results.reduce((a, r) => a + r.score, 0) / results.length) * 100, checks: results });
  }
  const total = criteria.reduce((a, k) => a + (k.weight * k.percent) / 100, 0);
  const weights = card.criteria.reduce((a, k) => a + k.weight, 0);
  const lock = { card: lockOf(card), adr: adrLock(root, card) };
  return { schema: card.schema, adr: card.adr, weights, lock: lock.adr === null ? 'no lock in the ADR' : lock.adr === lock.card ? 'ok' : 'MISMATCH', total, criteria };
}

export function render(s) {
  const out = [`Waymark scorecard · ${s.schema} · ADR ${s.adr} · lock ${s.lock}${s.weights === 100 ? '' : ` · WEIGHTS ADD TO ${s.weights}, NOT 100`}`, ''];
  for (const k of s.criteria) {
    out.push(`${String(k.id).padStart(2)}. ${k.name.padEnd(36)} w${String(k.weight).padStart(2)} · ${String(floor1(k.percent)).padStart(5)} % (target ${k.target})`);
    for (const c of k.checks.filter((x) => x.status !== 'pass')) out.push(`      ✘ ${c.id} ${c.status}${c.point ? ` · point ${c.point}` : ''} · ${c.what}${c.detail ? ` — ${c.detail}` : ''}`);
  }
  out.push('', `TOTAL ${floor1(s.total)} % (the total is never rounded up; the target of the release is 95)`);
  return out.join('\n');
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'docs', 'scorecard.json'))) { console.log('scorecard: run it from the root of the Waymark repository (docs/scorecard.json is there).'); process.exit(1); }
  const s = await scorecard(root);
  console.log(process.argv.includes('--json') ? JSON.stringify(s, null, 1) : render(s));
  const min = process.argv.indexOf('--min') >= 0 ? Number(process.argv[process.argv.indexOf('--min') + 1]) : null;
  process.exitCode = s.lock !== 'ok' || s.weights !== 100 || (min !== null && s.total < min) ? 1 : 0;
}
