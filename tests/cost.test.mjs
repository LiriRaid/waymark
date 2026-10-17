// Waymark 2.0.18 · point 3: `waymark.mjs cost` (docs/adr/0031). Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-cost-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const C = await import(`file://${SCRIPTS}/cost.mjs`);

const day = new Date().toLocaleDateString('sv');
const link = (responses, input, cacheWrite, cacheRead, output) => ({ responses, input, cacheWrite, cacheRead, output });
const evaluation = (routine, work, reply, quota = {}) => {
  const sum = (k) => routine[k] + work[k] + reply[k];
  return { score: '1/1', tokens: sum('input') + sum('cacheWrite') + sum('cacheRead') + sum('output'), usage: { input: sum('input'), cacheWrite: sum('cacheWrite'), cacheRead: sum('cacheRead'), output: sum('output') }, links: { v: 1, routine, work, reply }, ...quota };
};
// A project whose log holds the given tasks, whole.
function project(tasks) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cost-proj-'));
  temps.push(d);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'x'); git('add', 'a.txt'); git('commit', '-q', '-m', 'init');
  tasks.forEach((t, i) => P.appendRecord(d, { schema: 'waymark.record/v2', id: `${day} · T${i + 1}`, agent: 'claude', at: new Date(Date.now() + i * 1000).toISOString(), session: t.session || 's1', cwd: d, files: [], commits: [], prompt: 'p', cierre: '## Cierre', level: t.level, inputs: { waymark: t.version || '2.0.16', model: 'claude-sonnet-5-5' }, evaluation: t.evaluation }));
  return d;
}

test('units: each token is weighted by its published price ratio, so a cache read is cheap and an output token dear', () => {
  assert.deepEqual(C.WEIGHTS, { input: 1, cacheWrite: 1.25, cacheRead: 0.1, output: 5 });
  assert.equal(C.units({ input: 10, cacheWrite: 8, cacheRead: 1000, output: 4 }), 10 + 10 + 100 + 20);
  assert.equal(C.units({}), 0);
});

test('linkShares: the routine, work and reply shares by tokens and by cost units are not the same number', () => {
  const t = [{ links: { routine: link(1, 0, 0, 1000, 0), work: link(1, 0, 0, 1000, 100), reply: link(1, 0, 0, 0, 0) } }];
  const s = C.linkShares(t);
  assert.deepEqual(s.byTokens, { routine: 0.476, work: 0.524, reply: 0 }, 'by tokens: 1000 of 2100');
  assert.deepEqual(s.byUnits, { routine: 0.143, work: 0.857, reply: 0 }, 'by units: 100 of 700, the output of the work weighs 500');
  assert.equal(C.linkShares([{ links: null }]), null, 'a task with no links has no shares');
});

test('tasksOf and groups: one row per version and level, with the means, the shares and the measured window', () => {
  const ev = (cr, q) => evaluation(link(2, 10, 100, cr, 50), link(10, 20, 200, cr * 4, 500), link(1, 5, 0, cr, 10), q);
  const d = project([
    { level: 2, evaluation: ev(1000, { quotaPct: 4, quotaBy: 'measured' }) },
    { level: 2, evaluation: ev(2000, { quotaPct: 6, quotaBy: 'measured' }) },
    { level: 1, version: '2.0.17', evaluation: ev(500, { quotaPct: 9, quotaBy: 'pairs:3' }) },
  ]);
  const tasks = C.tasksOf(d);
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((t) => [t.version, t.level, t.responses]), [['2.0.16', 2, 13], ['2.0.16', 2, 13], ['2.0.17', 1, 13]]);
  const g = C.groups(tasks);
  assert.deepEqual(g.map((x) => [x.version, x.level, x.tasks]), [['2.0.16', 2, 2], ['2.0.17', 1, 1]]);
  assert.deepEqual(g[0].windowPct, { mean: 5, tasks: 2 });
  assert.equal(g[1].windowPct, null, 'an estimate from pairs is not a measured share of the window');
  assert.equal(g[0].shares.responses.routine, 2);
});

test('routineShare: a rolling window of the last tasks of one level, so history does not hold a lever back', () => {
  const old = evaluation(link(10, 0, 0, 1000, 0), link(10, 0, 0, 1000, 0), link(0, 0, 0, 0, 0));
  const lean = evaluation(link(1, 0, 0, 1000, 0), link(19, 0, 0, 19000, 0), link(0, 0, 0, 0, 0));
  const d = project([{ level: 2, evaluation: old }, { level: 2, evaluation: old }, { level: 2, evaluation: lean }, { level: 3, evaluation: old }]);
  const tasks = C.tasksOf(d);
  assert.deepEqual(C.routineShare(tasks, 2, 10), { share: 0.125, tasks: 3 }, 'all three L2 tasks: 300 of 2400 units');
  assert.deepEqual(C.routineShare(tasks, 2, 1), { share: 0.05, tasks: 1 }, 'only the last one: the lever shows at once');
  assert.equal(C.routineShare(tasks, 1, 5), null, 'no L1 task, no share');
});

test('sessionCosts: the first context, and a resume is a response after a long pause that writes most of the context again', () => {
  const at = (min) => new Date(Date.UTC(2026, 9, 16, 10, min)).toISOString();
  const resp = (id, min, input, cw, cr) => ({ type: 'assistant', timestamp: at(min), message: { id, usage: { input_tokens: input, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: 5 }, content: [] } });
  const lines = [
    resp('a', 0, 3, 70000, 0),
    resp('b', 1, 3, 500, 70000),     // a quick next response: not a resume
    resp('b', 1, 3, 500, 70000),     // the same response streamed twice: counted once
    resp('c', 30, 3, 800, 70500),    // 29 minutes later, but the cache held: it wrote a little, not a resume
    resp('d', 120, 3, 90000, 0),     // an hour and a half later, the cache gone: the whole context again
    { ...resp('e', 125, 3, 1, 1), isSidechain: true },
  ];
  const s = C.sessionCosts(lines);
  assert.equal(s.first, 70003);
  assert.deepEqual(s.resumes, [{ written: 90000, context: 90003 }]);
});

test('resumeReport: reads the transcripts of the recorded sessions that are on this machine, and says how many were', () => {
  const projects = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cost-tr-'));
  temps.push(projects);
  const dir = path.join(projects, 'C--work-proj');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), [{ type: 'assistant', timestamp: '2026-10-16T10:00:00Z', message: { id: 'a', usage: { input_tokens: 1, cache_creation_input_tokens: 50000, cache_read_input_tokens: 0, output_tokens: 1 }, content: [] } }].map((l) => JSON.stringify(l)).join('\n'));
  const r = C.resumeReport([{ session: 's1', cwd: 'C:\\work\\proj' }, { session: 's2', cwd: 'C:\\work\\proj' }], projects);
  assert.deepEqual([r.sessions, r.transcripts, r.firstContext, r.resume], [2, 1, { median: 50001, sessions: 1 }, null]);
});

test('report and render: the fixed context, the table by version and level, and what is not recorded', async () => {
  const d = project([{ level: 2, evaluation: evaluation(link(2, 10, 100, 1000, 50), link(10, 20, 200, 4000, 500), link(1, 5, 0, 1000, 10)) }]);
  const r = await C.report(d, { transcripts: false });
  assert.equal(r.schema, 'waymark.cost/v1');
  assert.ok(r.fixed.chars > 5000 && r.fixed.perPromptChars > 100, 'what Waymark injects, from size.mjs');
  const text = C.render(r);
  assert.match(text, /^Waymark cost · waymark\.cost\/v1 · 1 recorded task/);
  assert.match(text, /2\.0\.16 · L2 · 1 ·/);
  assert.match(text, /Q and L0 write no evaluation/);
});

test('the command: `waymark.mjs cost` runs from a project and prints the same report', () => {
  const d = project([{ level: 1, evaluation: evaluation(link(1, 1, 1, 100, 1), link(5, 1, 1, 500, 1), link(1, 1, 1, 100, 1)) }]);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'cost', '--json', '--no-transcripts'], { cwd: d, encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).groups[0].level, 1);
});
