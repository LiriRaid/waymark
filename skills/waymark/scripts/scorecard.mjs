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

// Check 9.1: the share of the agents that can technically carry the chain that have an adapter. An agent marked `soon` in agents.json (with its reason)
// is outside the count and listed apart (docs/adr/0048); with none able, there is no share, never 100 %.
export function adapterShare(agents) {
  const able = (agents || []).filter((a) => !a.soon || a.adapter); // one that gained an adapter counts again, whatever its field says
  return able.length ? able.filter((a) => a.adapter).length / able.length : null;
}

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
// The last n tasks of the project's log; `full` keeps those whose detail (the git note) could be read, which hold the fields. Only the records the
// measured version's hooks wrote count: one another version wrote (inputs.waymark) is not this version's to answer for.
// A pre-release is the version it leads to: what an installed 2.0.19-dev writes is measured as 2.0.19.
const release = (v) => String(v || '').replace(/-[0-9A-Za-z.-]+$/, '');
const VERSION = (() => { try { return release(fs.readFileSync(path.join(HERE, '..', 'VERSION'), 'utf8').trim()) || null; } catch { return null; } })();
// The writer version of each record, in date order. One with no version (a task only a commit's trailer holds, or one from before records
// named it) is the version that ran at its date: the last record before it that names one, else the first after it; with none named, null.
const writers = (rs) => {
  let v = null;
  const at = rs.map((r) => (r.inputs?.waymark ? (v = release(r.inputs.waymark)) : v));
  const first = at.find(Boolean) || null;
  return at.map((x) => x || first);
};
// What the records give, read once per scorecard run (run: the run's cache; a single measure reads fresh).
let run = null;
const once = (key, f) => {
  if (!run) return f();
  if (!run.has(key)) run.set(key, f());
  return run.get(key);
};
const provenance = () => import(pathToFileURL(path.join(HERE, 'provenance.mjs')).href);
const rawTasks = (root) => once(`raw:${root}`, async () => {
  const { projectHome, readTaskRecords } = await provenance(), h = projectHome(root);
  return { h, records: h.dir ? readTaskRecords(h) : [] };
});
const versionTasks = (root) => once(`tasks:${root}`, async () => {
  const tasks = (await rawTasks(root)).records.filter((r) => r.id && !r.kind), by = writers(tasks);
  return tasks.filter((r, i) => !VERSION || !by[i] || by[i] === VERSION);
});
const recent = async (root, n = 30, full = true) => {
  const last = (await versionTasks(root)).slice(-n);
  return full ? last.filter((r) => r.schema) : last;
};
// The cost rows of the tasks the measured version wrote (docs/adr/0049), for the routine shares of every level.
const versionCost = (root) => once(`cost:${root}`, async () => {
  const C = await import(pathToFileURL(path.join(HERE, 'cost.mjs')).href), mine = new Set((await versionTasks(root)).map((r) => r.id));
  return { C, tasks: C.tasksOf(root, (await rawTasks(root)).records).filter((t) => mine.has(t.id)) };
});
// The precedent's held-out evaluation, once per run: precision@3 and the hand-over's size come from the same one.
const precedentEval = (root) => once(`precedent:${root}`, async () => {
  const P = await import(pathToFileURL(path.join(HERE, 'precedent.mjs')).href), { h, records } = await rawTasks(root);
  return h.dir ? P.evaluate(records, { root: h.root }) : null;
});
const share = (rs, f) => (rs.length ? rs.filter(f).length / rs.length : null);
// The tasks the parcial share judges: a record from before the log carried an outcome says nothing either way, and a parcial for an
// external cause (the quota, the provider cut the turn) says nothing of the work, so neither is counted on either side.
const judged = (rs) => rs.filter((r) => r.outcome?.result && r.outcome.cause !== 'external');
const parcialOf = (rs) => share(judged(rs), (r) => r.outcome.result === 'parcial');
// The share that closed with testigos still unresolved: shown beside parcial in the real-use report, not a check (no lock of its own).
const unresolvedOf = (rs) => share(judged(rs), (r) => (r.unresolved || []).length > 0);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// A check's score from its value: ge scores value over threshold, le scores 1 within it and threshold over value above it.
const scoreOf = (op, value, threshold) => (op === 'ge' ? Math.min(1, value / threshold) : value <= threshold ? 1 : Math.min(1, threshold / value));
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
  // Real use (docs/adr/0049): the share of the last 30 tasks that closed parcial, the agents that closed them, and the median tokens of a task.
  async 'records.parcialShare'(root) { return parcialOf(await recent(root, 30, false)); },
  async 'records.agentSpread'(root) { const rs = await recent(root, 30, false); const named = new Set(rs.map((r) => r.agent).filter(Boolean)); return named.size || null; }, // a record with no agent is no second agent
  async 'records.medianTokens'(root) { return median((await recent(root, 30, true)).map((r) => r.evaluation?.tokens).filter((t) => t > 0)); },
  async 'records.pinnedShare'(root) { return share(await recent(root, 20), (r) => r.pinned); },
  async 'records.tokenShare'(root) { return share(await recent(root), (r) => r.evaluation?.tokens > 0 && r.evaluation?.links); },
  async 'records.cierreShare'(root) { return share(await recent(root), (r) => /Resultado:/.test(r.cierre || '') && /Evidencia:/.test(r.cierre || '') && /Aprendido:/.test(r.cierre || '')); },
  async 'records.decisionShare'(root) { // the L2+ tasks that changed something: a file of the repo, or one outside it the window testigo judged
    const rs = (await recent(root)).filter((r) => r.level >= 2 && ((r.files || []).length > 0 || 'Decision' in (r.evaluation?.steps || {})));
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
  // Notes wait to be pushed only in a project that said yes (`Notes push:`); with no yes, or never, the records stay on
  // the machine by design (docs/adr/0042) and nothing waits.
  async 'notes.unpushed'(root) {
    const { unpushedNotes, hasRemote } = await import(pathToFileURL(path.join(HERE, 'notes.mjs')).href);
    const { pushPref } = await import(pathToFileURL(path.join(HERE, 'notes-remote.mjs')).href);
    const { projectHome } = await import(pathToFileURL(path.join(HERE, 'provenance.mjs')).href);
    if (!hasRemote(root)) return null;
    return pushPref(projectHome(root).slug) === 'yes' ? unpushedNotes(root) : 0;
  },
  async 'agents.adapterShare'() {
    return adapterShare(JSON.parse(fs.readFileSync(path.join(HERE, 'agents', 'agents.json'), 'utf8')).agents);
  },
  async 'size.fixedContext'(root) {
    const rows = (await import(pathToFileURL(path.join(HERE, 'size.mjs')).href)).sizes(root);
    const n = (name) => rows.find((r) => r.name === name)?.chars || 0;
    return n('instructions block') + n('context card') + n('skill descriptions');
  },
  async 'size.perPrompt'(root) { return (await import(pathToFileURL(path.join(HERE, 'size.mjs')).href)).sizes(root).find((r) => r.name === 'reminder (real)')?.chars ?? null; },
  async 'cost.routineShareL2'(root) { const { C, tasks } = await versionCost(root); return C.routineShare(tasks, 2, 10)?.share ?? null; },
  async 'cost.routineShareL1'(root) { const { C, tasks } = await versionCost(root); return C.routineShare(tasks, 1, 5)?.share ?? null; },
  async 'precedent.precisionAt3'(root) { return (await precedentEval(root))?.precisionAtK ?? null; },
  async 'precedent.maxChars'(root) { return (await precedentEval(root))?.maxChars ?? null; },
  async 'conformance.cases'(root) {
    const f = path.join(root, 'tests', 'conformance', 'cases.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).cases?.length ?? null : null;
  },
};

export const MEASURE_NAMES = Object.keys(MEASURES);

// ---- one check → { score 0..1, status: pass | fail | pending | unmeasured, detail } ----
async function runCheck(root, c, lastPoint = Infinity) {
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
    if (c.threshold === null) return { score: 0, status: 'pending', value, detail: `${c.measure} = ${fmt(value)}; threshold frozen in ${c.frozenIn > lastPoint ? 'the next release' : `point ${c.frozenIn}`}` };
    const score = scoreOf(c.op, value, c.threshold);
    return { score, status: score >= 1 ? 'pass' : 'fail', value, detail: `${c.measure} = ${fmt(value)} (${c.op === 'ge' ? '≥' : '≤'} ${c.threshold})` };
  }
  return { score: 0, status: 'fail', detail: `unknown kind ${c.kind}` };
}
const fmt = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
const floor1 = (x) => Math.floor(x * 10 + 1e-9) / 10;

export async function scorecard(root) {
  run = new Map();
  try { return await scoreAll(root); } finally { run = null; }
}
async function scoreAll(root) {
  const card = readScorecard(root);
  const criteria = [], lastPoint = Math.max(...card.criteria.flatMap((k) => k.checks.map((c) => c.point || 0)));
  for (const k of card.criteria) {
    const results = [];
    for (const c of k.checks) results.push({ id: c.id, what: c.what, point: c.point, ...(await runCheck(root, c, lastPoint)) });
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

// A measure by name, for the tests and for callers that read one number.
export const measure = (name, root) => MEASURES[name](root);

// ---- the projects the user names (docs/adr/0049): real use pooled across them, not the score of one repository ----
// The Path column of ~/.waymark/projects.md; a placeholder row in a comment names nothing.
export function namedProjects(file = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'projects.md')) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  return text.split('\n').filter((l) => l.trim().startsWith('|') && !/^\|\s*(Project|-{3})/.test(l.trim())).map((l) => l.split('|')[2]?.trim()).filter((p) => p && !p.startsWith('<'));
}
const DIR_CHECKS = { '13.6': 'records.parcialShare', '9.9': 'records.agentSpread', '8.9': 'records.medianTokens' };
export async function projectsReport(roots = namedProjects()) {
  // the thresholds are the card's; an installed copy has no docs/scorecard.json, so the frozen ones stand in
  let card = null;
  try { card = readScorecard(path.resolve(HERE, '..', '..', '..')); } catch {}
  const FROZEN = { '13.6': { op: 'le', threshold: 0.2 }, '9.9': { op: 'ge', threshold: 2 }, '8.9': { op: 'ge', threshold: null } };
  const checkOf = (id) => card?.criteria.flatMap((k) => k.checks).find((c) => c.id === id) || FROZEN[id];
  const projects = [], pooled = [], full = [];
  for (const root of roots) {
    const name = path.basename(path.resolve(root));
    if (!fs.existsSync(root)) { projects.push({ name, missing: true }); continue; }
    const rs = await recent(root, 30, false);
    pooled.push(...rs); full.push(...await recent(root, 30, true));
    projects.push({ name, tasks: rs.length, parcialShare: parcialOf(rs), unresolvedShare: unresolvedOf(rs), agents: countBy(rs.filter((r) => r.agent), (r) => r.agent) });
  }
  const agents = countBy(pooled.filter((r) => r.agent), (r) => r.agent);
  const total = { tasks: pooled.length, parcialShare: parcialOf(pooled), unresolvedShare: unresolvedOf(pooled), agents, oneAgent: Object.keys(agents).length === 1, medianTokens: median(full.map((r) => r.evaluation?.tokens).filter((t) => t > 0)) };
  const values = { '13.6': total.parcialShare, '9.9': Object.keys(agents).length || null, '8.9': total.medianTokens };
  const checks = Object.entries(DIR_CHECKS).map(([id, m]) => {
    const c = checkOf(id), value = values[id];
    return { id, measure: m, value, ...(value === null || !c ? { score: 0, status: 'unmeasured' } : c.threshold === null ? { score: 0, status: 'pending' } : { score: scoreOf(c.op, value, c.threshold), status: scoreOf(c.op, value, c.threshold) >= 1 ? 'pass' : 'fail' }) };
  });
  return { projects, total, checks };
}
const countBy = (rs, f) => rs.reduce((o, r) => { const k = f(r); o[k] = (o[k] || 0) + 1; return o; }, {});
export function renderProjects(r) {
  const pc = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10} %`);
  const out = ['Waymark real use · the last 30 tasks of each project named', ''];
  for (const p of r.projects) out.push(p.missing ? `  ${p.name}: path not found` : `  ${p.name}: ${p.tasks} tasks · parcial ${pc(p.parcialShare)} · unresolved ${pc(p.unresolvedShare)} · agents ${Object.entries(p.agents).map(([a, n]) => `${a} ${n}`).join(', ') || '—'}`);
  out.push('', `  Together: ${r.total.tasks} tasks · parcial ${pc(r.total.parcialShare)} · unresolved ${pc(r.total.unresolvedShare)} · median ${r.total.medianTokens === null ? '—' : `${Math.round(r.total.medianTokens / 1000)}k`} tokens per task · ${r.total.oneAgent ? `one agent (${Object.keys(r.total.agents)[0]}): nothing here shows the other agents work` : `agents ${Object.entries(r.total.agents).map(([a, n]) => `${a} ${n}`).join(', ') || '—'}`}`);
  for (const c of r.checks) out.push(`  ${c.id} ${c.measure}: ${c.status}${c.value === null || c.value === undefined ? '' : ` (${Number.isInteger(c.value) ? c.value : c.value.toFixed(3)})`}`);
  return out.join('\n');
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--projects');
  if (at >= 0) {
    const paths = process.argv.slice(at + 1).filter((a) => !a.startsWith('--'));
    const r = await projectsReport(paths.length ? paths : namedProjects());
    console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : r.projects.length ? renderProjects(r) : 'scorecard --projects: name the projects (paths after the flag) or list them once in ~/.waymark/projects.md.');
    process.exit(0);
  }
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, 'docs', 'scorecard.json'))) { console.log('scorecard: run it from the root of the Waymark repository (docs/scorecard.json is there).'); process.exit(1); }
  const s = await scorecard(root);
  console.log(process.argv.includes('--json') ? JSON.stringify(s, null, 1) : render(s));
  const min = process.argv.indexOf('--min') >= 0 ? Number(process.argv[process.argv.indexOf('--min') + 1]) : null;
  process.exitCode = s.lock !== 'ok' || s.weights !== 100 || (min !== null && s.total < min) ? 1 : 0;
}
