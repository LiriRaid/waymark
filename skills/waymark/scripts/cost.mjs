#!/usr/bin/env node
// Waymark · what a task costs, per Waymark version and per level, from the project's own records (docs/adr/0031).
// Offline and deterministic: it reads the records (evaluation: tokens, usage, links, measured quota) and, where the agent's
// transcript is still on this machine, the size of a session's first context and the cost of a resume. It calls no model.
//   node cost.mjs [--json] [--no-transcripts]
// Cost is shown three ways, never mixed: raw tokens (what the API reports), cost units (tokens weighted by the published price
// ratios, so the cheap cache reads do not look like new work) and % of the 5-hour window (what the status line measured).
// Levels Q and L0 write no evaluation, so they have no tokens here; a Q is listed as not recorded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectHome, readTaskRecords } from './provenance.mjs';
import { parseLines } from './transcript.mjs';

export const SCHEMA = 'waymark.cost/v1';
// Relative price of each kind of token (input 1): cache write 1.25, cache read 0.1, output 5. A weight for comparing links, not a quota.
export const WEIGHTS = { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 };
export const units = (u) => WEIGHTS.input * (u.input || 0) + WEIGHTS.cacheWrite * (u.cacheWrite || 0) + WEIGHTS.cacheRead * (u.cacheRead || 0) + WEIGHTS.output * (u.output || 0);
const tokens = (u) => (u.input || 0) + (u.cacheWrite || 0) + (u.cacheRead || 0) + (u.output || 0);
const LINKS = ['routine', 'work', 'reply'];
const round = (x, d = 1) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// The recorded tasks with an evaluation, oldest first: one row per task.
export function tasksOf(cwd) {
  const home = projectHome(cwd);
  return (home.dir ? readTaskRecords(home) : []).filter((r) => r.id && r.schema && r.evaluation?.tokens > 0).map((r) => {
    const links = r.evaluation.links || null;
    const u = r.evaluation.usage || {};
    return {
      id: r.id, session: r.session || null, cwd: r.cwd || null, version: r.inputs?.waymark || 'unknown', level: r.level ?? null, model: r.inputs?.model || null,
      tokens: r.evaluation.tokens, units: units(u), usage: u, links, subagents: r.evaluation.subagents ?? u.subagents ?? 0,
      responses: links ? LINKS.reduce((a, k) => a + (links[k]?.responses || 0), 0) : null,
      quotaPct: r.evaluation.quotaPct ?? null, quotaBy: r.evaluation.quotaBy || null, taskType: r.taskType || null,
    };
  });
}

// The share of each link (routine, work, reply) in a set of tasks, by tokens and by cost units; null when no task has links.
export function linkShares(tasks) {
  const t = tasks.filter((x) => x.links);
  if (!t.length) return null;
  const sum = (key, f) => t.reduce((a, x) => a + f(x.links[key] || {}), 0);
  const tok = Object.fromEntries(LINKS.map((l) => [l, sum(l, tokens)])), un = Object.fromEntries(LINKS.map((l) => [l, sum(l, units)]));
  const T = LINKS.reduce((a, l) => a + tok[l], 0), U = LINKS.reduce((a, l) => a + un[l], 0);
  return { tasks: t.length, byTokens: Object.fromEntries(LINKS.map((l) => [l, round(tok[l] / T, 3)])), byUnits: Object.fromEntries(LINKS.map((l) => [l, round(un[l] / U, 3)])),
    responses: Object.fromEntries(LINKS.map((l) => [l, round(mean(t.map((x) => x.links[l]?.responses || 0)), 1)])) };
}

// The routine share, by cost units, of the last `last` recorded tasks of one level: the number the thresholds of the scorecard
// (checks 8.6 and 8.7) are frozen on. A rolling window, so a lever shows in the tasks that follow it and the history does not hold it back.
export function routineShare(tasks, level, last = 10) {
  const t = tasks.filter((x) => Number(x.level) === level && x.links).slice(-last);
  const s = linkShares(t);
  return s ? { share: s.byUnits.routine, tasks: t.length } : null;
}

// One row per (version, level).
export function groups(tasks) {
  const by = new Map();
  for (const t of tasks) { const key = `${t.version}\u0000${t.level}`; (by.get(key) || by.set(key, []).get(key)).push(t); }
  return [...by.values()].map((g) => {
    const measured = g.filter((x) => String(x.quotaBy || '').startsWith('measured') && x.quotaPct !== null);
    return {
      version: g[0].version, level: g[0].level, tasks: g.length, tokensMean: Math.round(mean(g.map((x) => x.tokens))), tokensMedian: Math.round(median(g.map((x) => x.tokens))),
      responsesMean: round(mean(g.filter((x) => x.responses !== null).map((x) => x.responses)), 1), shares: linkShares(g),
      subagentShare: round(mean(g.map((x) => (x.subagents || 0) / x.tokens)), 3),
      windowPct: measured.length ? { mean: round(mean(measured.map((x) => x.quotaPct)), 1), tasks: measured.length } : null,
    };
  }).sort((a, b) => String(a.version).localeCompare(String(b.version)) || Number(a.level) - Number(b.level));
}

// The first context of a session and the cost of resuming it, from the transcripts of the recorded sessions that are still here.
// A resume is a response that comes after a pause longer than the prompt cache lives (5 minutes) and writes most of the context
// again (at least half of it): a response that only adds the last turn to a cache that held is not one.
const CACHE_TTL_MS = 5 * 60 * 1000;
export function sessionCosts(lines) {
  const seen = new Set();
  let first = null, last = 0;
  const resumes = [];
  for (const d of lines) {
    const u = d.type === 'assistant' && !d.isSidechain ? d.message?.usage : null;
    if (!u || d.message?.model === '<synthetic>' || seen.has(d.message.id)) continue;
    seen.add(d.message.id);
    const at = Date.parse(d.timestamp || '') || 0, ctx = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    if (first === null) first = ctx;
    else if (last && at - last > CACHE_TTL_MS && (u.cache_creation_input_tokens || 0) * 2 >= ctx) resumes.push({ written: u.cache_creation_input_tokens || 0, context: ctx });
    last = at || last;
  }
  return { first, resumes };
}

export function transcriptFile(task, projectsDir = path.join(os.homedir(), '.claude', 'projects')) {
  if (!task.session || !task.cwd) return null;
  const f = path.join(projectsDir, String(task.cwd).replace(/[:\\/]/g, '-'), `${task.session}.jsonl`);
  return fs.existsSync(f) ? f : null;
}

export function resumeReport(tasks, projectsDir) {
  const sessions = [...new Map(tasks.map((t) => [t.session, t])).values()];
  const firsts = [], writes = [];
  let found = 0;
  for (const t of sessions) {
    const f = transcriptFile(t, projectsDir);
    if (!f) continue;
    found++;
    try { const s = sessionCosts(parseLines(fs.readFileSync(f, 'utf8'))); if (s.first) firsts.push(s.first); writes.push(...s.resumes.map((r) => r.written)); } catch {}
  }
  return { sessions: sessions.length, transcripts: found, firstContext: firsts.length ? { median: Math.round(median(firsts)), sessions: firsts.length } : null, resume: writes.length ? { median: Math.round(median(writes)), resumes: writes.length } : null };
}

// What Waymark injects, from size.mjs: the fixed context (instructions block + context card + skill descriptions) and the per-prompt reminder.
export async function fixedContext(cwd) {
  const rows = (await import('./size.mjs')).sizes(cwd);
  const n = (name) => rows.find((r) => r.name === name)?.chars || 0;
  const fixed = n('instructions block') + n('context card') + n('skill descriptions');
  return { chars: fixed, tokens: Math.round(fixed / 4), perPromptChars: n('reminder (real)'), parts: { instructionsBlock: n('instructions block'), contextCard: n('context card'), skillDescriptions: n('skill descriptions') } };
}

export async function report(cwd, { transcripts = true } = {}) {
  const tasks = tasksOf(cwd);
  return { schema: SCHEMA, weights: WEIGHTS, tasks: tasks.length, fixed: await fixedContext(cwd), groups: groups(tasks), ...(transcripts ? { sessions: resumeReport(tasks) } : {}) };
}

const pct = (x) => (x === null || x === undefined ? '—' : `${round(x * 100, 1)} %`);
const k = (n) => (n === null || n === undefined ? '—' : n >= 1e6 ? `${round(n / 1e6, 2)}M` : `${Math.round(n / 1e3)}k`);
export function render(r) {
  const out = [`Waymark cost · ${r.schema} · ${r.tasks} recorded task(s) with an evaluation`, ''];
  out.push(`Fixed context: ${r.fixed.chars} chars (≈ ${r.fixed.tokens} tokens: instructions block ${r.fixed.parts.instructionsBlock} + card ${r.fixed.parts.contextCard} + skill descriptions ${r.fixed.parts.skillDescriptions}) · per prompt: ${r.fixed.perPromptChars} chars`);
  if (r.sessions) out.push(`Sessions: ${r.sessions.transcripts} of ${r.sessions.sessions} transcripts on this machine · first context ${r.sessions.firstContext ? `${k(r.sessions.firstContext.median)} tokens (median of ${r.sessions.firstContext.sessions})` : '—'} · a resume writes ${r.sessions.resume ? `${k(r.sessions.resume.median)} tokens (median of ${r.sessions.resume.resumes})` : '— (none seen)'}`);
  out.push('', 'version · level · tasks · tokens/task (median) · responses · routine / work / reply by cost units (by tokens) · subagents · % of window (measured)');
  for (const g of r.groups) {
    const s = g.shares;
    out.push(`${g.version} · L${g.level} · ${g.tasks} · ${k(g.tokensMean)} (${k(g.tokensMedian)}) · ${g.responsesMean ?? '—'} · ${s ? `${pct(s.byUnits.routine)} / ${pct(s.byUnits.work)} / ${pct(s.byUnits.reply)} (${pct(s.byTokens.routine)} routine)` : 'no links'} · ${pct(g.subagentShare)} · ${g.windowPct ? `${g.windowPct.mean} % (${g.windowPct.tasks} measured)` : '—'}`);
  }
  out.push('', 'Q and L0 write no evaluation: their tokens are not recorded here. Cost units weigh each token by its published price ratio (cache read 0.1, cache write 1.25, output 5).');
  return out.join('\n');
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const r = await report(process.cwd(), { transcripts: !process.argv.includes('--no-transcripts') });
  console.log(process.argv.includes('--json') ? JSON.stringify(r, null, 1) : render(r));
}
