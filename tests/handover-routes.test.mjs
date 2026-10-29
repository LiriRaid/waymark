// Waymark 2.0.20 · points 28 and 13: the procedure hand-over, the incident list and Recordar are judged on what happened, and a reply keeps the route of its open task.
// Synthetic copies of the real patterns (ADR 0042). Run: node --test tests/handover-routes.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
process.env.WAYMARK_ENGRAM = '';
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { packContext, checkDecision } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { procDelivered, packedAny, packedFiles } = await import(`file://${SCRIPTS}/lib/packed.mjs`);
const { cierreGaps, checkCierre } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn, openTaskRoute, inheritedRoute } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { incidents, suspect } = await import(`file://${SCRIPTS}/incidents.mjs`);
const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const repo = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-hand-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark')); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  gitT(d, 'add', '-A'); gitT(d, 'commit', '-q', '-m', 'base');
  return d;
};
let ids = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input, out = 'ok') => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] } }]; };
const transcript = (dir, lines) => { const f = path.join(dir, `t${++ids}.jsonl`); fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); return f; };
const handed = (text) => [...String(text || '').matchAll(/Waymark procedures of (dept-[\w-]+)/g)].map((m) => m[1]);
const shellChange = (dir, command, session, lines, state) => packContext({ cwd: dir, session_id: session, tool_name: 'Bash', tool_input: { command }, transcript_path: transcript(dir, lines) }, claude, state);

// ---- 28(a): the procedure is handed before the first change of every task, also a change by shell that names no file ----
test('28: a first change by shell that names no existing file still hands the department\'s procedures; a command that changes nothing hands none', async () => {
  const d = repo({ 'src/a.mjs': 'a\n' }), state = path.join(d, 'packed.json');
  const lines = [prompt('mueve el módulo'), say('Waymark → L2 · dept-architecture')];
  for (const [kind, command] of [['a new folder', 'mkdir -p src/orders && echo x > src/orders/new.txt'], ['a redirect to a new file', 'echo x > src/new/out.txt']]) {
    const s = `s-shell-${kind}`;
    assert.deepEqual(handed(await shellChange(d, command, s, lines, state)), ['dept-architecture'], kind);
    assert.ok(procDelivered(s, 0, state).has('dept-architecture'), `kept: ${kind}`);
    assert.ok(packedAny(s, 0, state), `the hook says it handed something: ${kind}`);
    assert.equal(packedFiles(s, 0, state).size, 0, `no file named: ${kind}`);
  }
  assert.equal(await shellChange(d, 'ls src', 's-shell-ls', lines, state), null, 'counter-example: a command that changes nothing');
  assert.equal(await shellChange(d, 'mkdir -p src/orders && echo x > src/orders/new.txt', 's-shell-ls', lines, state) === null, false, 'the same session, a change: handed');
});

test('28: a department that loads after a change by shell that named no file is handed its procedures at the load (it was never handed any)', async () => {
  const d = repo({ 'src/a.mjs': 'a\n' }), state = path.join(d, 'packed.json'), s = 's-late-load';
  const lines = [prompt('arregla las pruebas')];
  await shellChange(d, 'mkdir -p out && echo y > out/z.txt', s, lines, state); // owner not loaded yet: ownerDept null, nothing to hand, but the task's state exists
  const load = await packContext({ cwd: d, session_id: s, tool_name: 'Skill', tool_input: { skill: 'dept-qa' }, transcript_path: transcript(d, [...lines, ...call('Skill', { skill: 'dept-qa' })]) }, claude, state);
  assert.deepEqual(handed(load), ['dept-qa']);
  assert.ok(procDelivered(s, 0, state).has('dept-qa'));
  assert.equal(await packContext({ cwd: d, session_id: 's-no-change', tool_name: 'Skill', tool_input: { skill: 'dept-qa' }, transcript_path: transcript(d, lines) }, claude, path.join(d, 'other.json')), null, 'counter-example: no change yet: the first one hands them');
});

// ---- 28(c): Recordar reads what the hook handed ----
const FILE = '/work/proj/src/orders.service.mjs';
const ASKED = [...call('AskUserQuestion', { questions: [] }), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'none', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'A' }, { label: 'B' }] }], answers: { '¿Cómo?': 'A' } } }];
const cierre = '## Cierre · 2026-10-29 · T1\nResultado: hecho\nEvidencia: observada ok\nAprendido: x ← y';
const L2 = (...change) => currentTurn([prompt('mueve el módulo'), say('Waymark → L2 · dept-backend'), ...call('Skill', { skill: 'dept-backend' }), ...ASKED, ...change, ...call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), ...call('Skill', { skill: 'code-review' })]);
const ctxWith = (extra = {}) => ({ ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }], cwd: '/work/proj', procDelivered: ['dept-backend'], ...extra });
test('28: Recordar passes when the hook handed something at the first change, also one that named no file; with nothing handed and nothing searched it blocks, and the message agrees with the claim', () => {
  const change = call('Bash', { command: 'node scripts/reorganize.mjs' });
  const gaps = (extra) => cierreGaps(L2(...change), cierre, undefined, undefined, ctxWith({ gitChanged: ['/work/proj/src/a.mjs'], ...extra }));
  assert.equal(gaps({ packed: 1 }).missing.some((m) => /project memory/.test(m)), false, 'handed');
  const none = gaps({ packed: 0 }).missing.find((m) => /project memory/.test(m));
  assert.match(none || '', /neither handed nor searched/);
  assert.doesNotMatch(none || '', /pack <the changed files>/, 'it no longer tells the agent to run pack by hand: the claim says never');
  assert.match(none || '', /memory <section>|mem_search/);
});

// ---- 28(b): incidents ----
test('28: an incident names its own testigo\'s reason, never another\'s; with two failed and no reasons of its own it names none', () => {
  const r = (id, steps, unresolved, causes) => ({ id, evaluation: { steps }, unresolved, ...(causes ? { causes } : {}) });
  const both = incidents([r('T1', { Ojos: false, Evidencia: false }, ['the browser measured nothing', 'cites what no tool call shows: Available'])]);
  assert.deepEqual(both.open.map((o) => [o.label, o.cause]), [['Ojos', ''], ['Evidencia', '']], 'two failed, no per-testigo reasons: none is guessed');
  const own = incidents([r('T1', { Ojos: false, Evidencia: false }, ['x', 'y'], { Ojos: 'the browser measured nothing', Evidencia: 'cites what no tool call shows: Available' })]);
  assert.deepEqual(own.open.map((o) => [o.label, o.cause]), [['Ojos', 'the browser measured nothing'], ['Evidencia', 'cites what no tool call shows: Available']]);
  assert.equal(incidents([r('T1', { Enrutar: false }, ['no routing line'])]).open[0].cause, 'no routing line', 'the only one that failed');
});

test('28: a failure the detector may have misjudged opens an incident but never makes a suggested rule', () => {
  const EGO = '"C:/ego/ego-browser.exe" nodejs <<\'EOF\'\nawait page.goto("http://localhost:4200")\nEOF';
  const fail = (n, label, extra) => ({ id: `T${n}`, evaluation: { steps: { [label]: false } }, ...extra });
  const rules = (list) => incidents(list).rules;
  const run = (label, extra) => rules([1, 2, 3].map((n) => fail(n, label, extra)));
  assert.deepEqual(run('Ojos', { observed: { eyes: { calls: 0 } }, commands: [EGO] }), [], 'Ojos with no call counted although a command ran ego');
  assert.equal(run('Ojos', { observed: { eyes: { calls: 0 } }, commands: ['git status'] }).length, 1, 'counter-example: no ego command: a real failure');
  assert.deepEqual(run('Build', { commands: ['pnpm run build 2>&1 | tail -5'] }), [], 'Build with a build command run');
  assert.equal(run('Build', { commands: ['git status'] }).length, 1, 'counter-example: no build ran');
  assert.deepEqual(run('Review', { findings: ['Review: skip quoted as the user\'s ("después") but those words are not in the user\'s messages'] }), [], 'Review refused for the words of a quote');
  assert.deepEqual(run('Enrutar', { observed: { procedure: { handed: true, readBeforeChange: false } } }), [], 'procedure handed but counted late');
  assert.equal(run('Enrutar', { observed: { procedure: { handed: false, readBeforeChange: false } } }).length, 1, 'counter-example: never handed');
  assert.equal(run('Tests', {}).length, 1, 'counter-example: a testigo with no known false form');
  assert.equal(suspect({ commands: [EGO], observed: { eyes: { calls: 2 } } }, 'Ojos'), false, 'calls counted: not suspect');
});

test('28: an incident of another Waymark version or older than thirty days ages out; one with no version stays', () => {
  const day = 86400000, now = Date.parse('2026-10-29T12:00:00Z');
  const rec = (id, at, version) => ({ id, at: new Date(at).toISOString(), evaluation: { steps: { Previos: false } }, ...(version ? { inputs: { waymark: version } } : {}) });
  const open = (list) => incidents(list, { now, version: '2.0.20' }).open.map((o) => o.last);
  assert.deepEqual(open([rec('T1', now - 2 * day, '2.0.18')]), [], 'an earlier version\'s');
  assert.deepEqual(open([rec('T1', now - 2 * day, '2.0.20')]), ['T1'], 'this version\'s');
  assert.deepEqual(open([rec('T1', now - 2 * day)]), ['T1'], 'no version recorded: kept');
  assert.deepEqual(open([rec('T1', now - 40 * day, '2.0.20')]), [], 'older than thirty days');
  assert.deepEqual(open([rec('T1', now - 40 * day, '2.0.20'), rec('T2', now - 1 * day, '2.0.20')]), ['T2'], 'the newer failure of the same testigo keeps it open');
});

// ---- 13: a reply keeps the route of its open task ----
test('13: a reply that routes itself as a question while it changes files is gated and judged at the open task\'s level and department', () => {
  const open = [prompt('arma el módulo de pedidos'), say('Waymark → L3 · dept-architecture'), ...call('Skill', { skill: 'dept-architecture' })];
  const reply = [prompt('actualiza el espacio para que lo veas'), say('Waymark → Q · dept-backend')];
  assert.deepEqual(openTaskRoute([...open, ...reply]), { level: 3, dept: 'dept-architecture' }, 'the route of the task still open');
  assert.equal(inheritedRoute([...open, ...reply]), null, 'an inherited route is for a reply with no line at all, as before');
  const state = (n) => path.join(os.tmpdir(), `wm-route-gate-${process.pid}-${n}.json`);
  assert.match(checkDecision(FILE, [...open, ...reply], 's-route', state(1)) || '', /L3 decision gate/, 'gated as the L3 task it continues, not as a question');
  const pure = [prompt('¿qué hace el módulo?'), say('Waymark → Q · dept-backend')];
  assert.match(checkDecision(FILE, pure, 's-route', state(2)) || '', /routed as a question/, 'counter-example: a pure question still gets the re-route notice');
  const closed = [prompt('arma el módulo'), say('Waymark → L3 · dept-architecture'), say('## Cierre · 2026-10-29 · T1\nResultado: hecho'), ...reply];
  assert.equal(openTaskRoute(closed), null, 'counter-example: the task closed');
  const judged = (extra) => cierreGaps(currentTurn([...open, ...reply, ...ASKED, ...call('Edit', { file_path: FILE }), ...call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' })]), cierre, undefined, undefined, ctxWith({ taskTools: [], ...extra }));
  assert.equal(judged({ taskRoute: { level: 3, dept: 'dept-architecture' } }).level, 3, 'judged as L3');
  assert.equal(judged({}).level, 2, 'counter-example: with no open task a question that changed files is judged as L2, as before');
});

test('review fix: Build is suspect only when a build ran and none of the commands kept after the last change failed', () => {
  const ran = { commands: ['pnpm run build 2>&1 | tail -5'] };
  assert.equal(suspect({ ...ran }, 'Build'), true, 'a build ran, nothing shows it failed');
  assert.equal(suspect({ ...ran, observed: { gates: [{ cmd: 'pnpm run build', error: true }] } }, 'Build'), false, 'a build that failed is a real failure: it may teach a rule');
  assert.equal(suspect({ commands: ['git status'] }, 'Build'), false);
});
