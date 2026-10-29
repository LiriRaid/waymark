// Waymark 2.0.20 · point 20 (rows 48 to 51): a task keeps its identity and its record. Synthetic copies of the real patterns (ADR 0042): no project name, path,
// prompt or code of a real project. Run: node --test tests/task-identity.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-identity-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_REVIEW_MODE = 'always';
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { cierreGaps, checkCierre, turnCommits, questionRecord, provenanceRecord, unevaluatedRecord } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn, pendingBackground } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { CLOSE_REST } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

let ids = 0;
const NOW = Date.now();
const at = (ms = 0) => new Date(NOW + ms).toISOString();
const prompt = (text, ms = 0) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(ms), message: { role: 'user', content: text } });
const say = (text, ms = 0) => ({ type: 'assistant', timestamp: at(ms), message: { content: [{ type: 'text', text }] } });
const use = (id, name, input, ms = 0) => ({ type: 'assistant', timestamp: at(ms), message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, ms = 0, extra = {}) => ({ type: 'user', timestamp: at(ms), message: { content: [{ type: 'tool_result', tool_use_id: id, content }] }, ...extra });
const call = (name, input, out = 'ok') => { const id = `u${++ids}`; return [use(id, name, input), result(id, out)]; };
const notification = (taskId, ms) => ({ type: 'user', timestamp: at(ms), message: { role: 'user', content: `<task-notification><task-id>${taskId}</task-id><status>completed</status></task-notification>` } });

// ---- (a) a gate, a build or a test run left in the background is waited for; a server or a watcher is not ----
const launchBg = (command, bgId = 'bg1') => [prompt('construye', -5000), say('Waymark → L2 · dept-backend', -4000), use('t1', 'Bash', { command, run_in_background: true }, -3000), result('t1', `Command running in background with ID: ${bgId}. Output is being written to: /tmp/${bgId}.output`, -2900)];
test('20: a build left in the background keeps the turn open until it notifies or the agent reads its end; a server, a watcher or a stale launch does not', () => {
  assert.deepEqual(pendingBackground(launchBg('pnpm run build'), 0, NOW), ['t1'], 'a build in the background: waited for');
  assert.deepEqual(pendingBackground(launchBg('node --test tests/*.test.mjs'), 0, NOW), ['t1'], 'a test run too');
  assert.deepEqual(pendingBackground(launchBg('npx tsc --noEmit'), 0, NOW), ['t1'], 'a typecheck too');
  assert.deepEqual(pendingBackground([...launchBg('pnpm run build'), notification('bg1', -1000)], 0, NOW), [], 'its notification releases it');
  const polled = [...launchBg('pnpm run build'), use('t2', 'BashOutput', { bash_id: 'bg1' }, -1500), result('t2', '<status>completed</status>\n<exit_code>0</exit_code>', -1400)];
  assert.deepEqual(pendingBackground(polled, 0, NOW), [], 'the agent read its end itself');
  const running = [...launchBg('pnpm run build'), use('t2', 'BashOutput', { bash_id: 'bg1' }, -1500), result('t2', '<status>running</status>', -1400)];
  assert.deepEqual(pendingBackground(running, 0, NOW), ['t1'], 'counter-example: read while still running');
  assert.deepEqual(pendingBackground(launchBg('pnpm run dev'), 0, NOW), [], 'counter-example: a dev server never ends');
  assert.deepEqual(pendingBackground(launchBg('pnpm exec vitest --watch'), 0, NOW), [], 'counter-example: a watcher never ends');
  assert.deepEqual(pendingBackground(launchBg('ng serve'), 0, NOW), [], 'counter-example: serve');
  assert.deepEqual(pendingBackground(launchBg('git status'), 0, NOW), [], 'counter-example: a command that checks nothing');
  assert.deepEqual(pendingBackground(launchBg('pnpm run build'), 0, NOW + 11 * 60000), [], 'counter-example: older than ten minutes is a dead run, not waited for');
  const fg = [prompt('x', -5000), use('t1', 'Bash', { command: 'pnpm run build' }, -3000), result('t1', 'ok', -2900)];
  assert.deepEqual(pendingBackground(fg, 0, NOW), [], 'counter-example: a build in the foreground has ended');
});

// ---- (b) the ID the prompt handed is the one the record keeps; the commit testigo reads the task's family ----
const FILE = '/work/proj/src/orders.service.mjs';
const ASKED = [...call('AskUserQuestion', { questions: [] }), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'none', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'A' }, { label: 'B' }] }], answers: { '¿Cómo?': 'A' } } }];
const L2 = () => currentTurn([prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), ...call('Skill', { skill: 'dept-backend' }), ...ASKED, ...call('Edit', { file_path: FILE }), ...call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), ...call('Skill', { skill: 'code-review' })]);
const ctxFor = (cwd) => ({ ids: P.taskIds(cwd), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1, outside: true });
const cierre = (heading) => `${heading}\nResultado: hecho\nEvidencia: observada ok\nAprendido: x ← y`;
const fresh = () => { const dir = fs.mkdtempSync(path.join(home, 'proj-')); fs.mkdirSync(path.join(dir, '.waymark')); fs.writeFileSync(path.join(dir, '.waymark', 'memory.md'), '# P\n'); return dir; };
test('20: a heading with no ID, a recorded one or one never offered blocks nothing: the record keeps the ID the prompt handed and says it rewrote the heading', () => {
  const cwd = fresh();
  P.appendRecord(cwd, { id: P.taskIds(cwd).next });
  const c = ctxFor(cwd), handed = c.ids.next;
  for (const heading of ['## Cierre', `## Cierre · ${c.ids.last}`, '## Cierre · 2026-10-29 · T99', `## Cierre · ${c.ids.last}b`.replace('b', 'z')]) {
    assert.equal(checkCierre(L2(), cierre(heading), undefined, undefined, c), null, `no block: ${heading}`);
  }
  const g = cierreGaps(L2(), cierre('## Cierre · 2026-10-29 · T99'), undefined, undefined, c);
  const rec = provenanceRecord(L2(), g, c, { agent: 'claude', session: 's', cwd });
  assert.equal(rec.id, handed, 'recorded under the handed ID');
  assert.equal(rec.idBy, 'hook');
  assert.equal(rec.claimed, '2026-10-29 · T99', 'what the agent wrote is kept');
  const ok = provenanceRecord(L2(), cierreGaps(L2(), cierre(`## Cierre · ${handed}`), undefined, undefined, c), c, { agent: 'claude', session: 's', cwd });
  assert.equal(ok.id, handed);
  assert.equal(ok.idBy, undefined, 'counter-example: the ID the prompt handed is not rewritten');
  assert.match(checkCierre(L2(), '## Cierre · 2026-10-29 · T99\nResultado: hecho\nEvidencia: observada ok', undefined, undefined, c) || '', /Aprendido/, 'counter-example: a real gap still blocks, and the ID is not one of them');
});

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
test('20: the commit testigo accepts the trailer of the task or of its follow-up: T4 under a Cierre that says T4b', () => {
  const repo = fresh();
  gitT(repo, 'init', '-q');
  fs.writeFileSync(path.join(repo, 'a.mjs'), '1\n'); gitT(repo, 'add', 'a.mjs');
  const day = new Date().toLocaleDateString('sv'), since = Date.now() - 1000;
  gitT(repo, 'commit', '-q', '-m', 'fix: x', '-m', `Waymark-Task: ${day} · T4\nCo-Authored-By: Claude <noreply@anthropic.com>`);
  const sha = gitT(repo, 'rev-parse', 'HEAD').stdout.trim();
  const tools = [{ name: 'Bash', input: { command: 'git add a.mjs && git commit -q -F -' } }];
  const known = new Set([`${day} · T1`]), idsAt = { next: `${day} · T5`, known, committed: new Set() };
  assert.deepEqual(turnCommits(tools, repo, `${day} · T4b`, idsAt, since), [sha], 'the family of the claimed ID');
  assert.deepEqual(turnCommits(tools, repo, `${day} · T4`, idsAt, since), [sha], 'the claimed ID itself');
  assert.deepEqual(turnCommits(tools, repo, `${day} · T7b`, idsAt, since), [], 'counter-example: another task\'s family');
});

// ---- (c) the session's project is its first prompt's folder ----
test('20: the project of a session is fixed by the first prompt: a later cd into a sibling repo does not move it', () => {
  const first = fs.mkdtempSync(path.join(home, 'first-')), sibling = fs.mkdtempSync(path.join(home, 'sibling-'));
  assert.equal(P.pinnedCwd('s-pin', first), first, 'the first prompt pins it');
  assert.equal(P.pinnedCwd('s-pin', sibling), first, 'a later prompt from the sibling keeps it');
  assert.equal(P.pinnedCwd('s-pin-2', sibling), sibling, 'counter-example: another session pins its own');
  fs.rmSync(first, { recursive: true, force: true });
  assert.equal(P.pinnedCwd('s-pin', sibling), sibling, 'counter-example: a folder that is gone is replaced');
  assert.equal(P.pinnedCwd(undefined, sibling), sibling, 'no session, nothing kept');
});

// ---- (d) free words, a question with no routing line, an agent whose turn never closes ----
test('20: the user\'s free words for closing the other tasks confirm them; a request about anything else does not', () => {
  for (const text of ['cierra las otras tareas también', 'Cierra las demás tareas', 'sí, cierra todas las tareas', 'close the other tasks too', 'marca el resto de tareas como hechas', 'close all the tasks']) assert.ok(CLOSE_REST.test(text), text);
  for (const text of ['cierra todas las pestañas del navegador', 'cierra el modal cuando termine', 'close the other window', 'las otras tareas están bien', 'ok']) assert.equal(CLOSE_REST.test(text), false, text);
});

test('20: a question that carries no routing line at all is recorded as a question; an acting turn, a courtesy or a routed task is not', () => {
  const asked = (prompt_, ...rest) => currentTurn([prompt(prompt_), ...rest]);
  const q = questionRecord(asked('¿cómo funciona el reintento?', say('Reintenta tres veces con backoff exponencial.')), { agent: 'claude', session: 's', cwd: '/x', unrouted: true });
  assert.equal(q?.kind, 'Q');
  assert.match(q.answer, /backoff/);
  assert.equal(questionRecord(asked('¿cómo funciona el reintento?', say('Reintenta tres veces.')), { agent: 'claude', session: 's', cwd: '/x' }), null, 'counter-example: the hook did not say it is unrouted');
  assert.equal(questionRecord(asked('¿cómo?', say('Waymark → L2 · dept-backend'), say('Lo hago.')), { agent: 'claude', session: 's', cwd: '/x', unrouted: true }), null, 'counter-example: a routed task is no question');
  assert.equal(questionRecord(asked('¿cómo?', say('Waymark → Q · dept-qa'), say('Así.')), { agent: 'claude', session: 's', cwd: '/x' })?.kind, 'Q', 'a routed Q is recorded as before');
});

test('20: an unevaluated record keeps the prompt it could not judge', () => {
  const r = unevaluatedRecord('deferred: a background task is still running', { agent: 'claude', session: 's', cwd: '/x', files: ['a.ts'], prompt: 'arregla el reintento del servicio' });
  assert.equal(r.kind, 'unevaluated');
  assert.equal(r.prompt, 'arregla el reintento del servicio');
  assert.equal(unevaluatedRecord('x', {}).prompt, undefined);
});

test('20: a turn that an agent which cannot close its turns left open stops raising the "another session is open" notice after ten minutes; a Claude Code turn keeps its two hours', () => {
  const cwd = fresh();
  const open = (session, agent, minutesAgo) => ({ [session]: { at: new Date(Date.now() - minutesAgo * 60000).toISOString(), next: 'x', agent, prompt: 'p' } });
  fs.writeFileSync(path.join(cwd, '.waymark', 'open.json'), JSON.stringify({ ...open('oc-old', 'opencode', 30), ...open('oc-new', 'opencode', 3), ...open('cc-old', 'claude', 90) }));
  const names = P.otherOpen(cwd, 'me').map((o) => o.session).sort();
  assert.deepEqual(names, ['cc-old', 'oc-new']);
});

test('review fix: a pin older than twelve hours (a resumed session) is replaced by the current folder; the tool hook reads the pin and never writes it', () => {
  const first = fs.mkdtempSync(path.join(home, 'old-')), now = Date.now();
  assert.equal(P.pinnedCwd('s-old', first, now - 13 * 3600000), first);
  const other = fs.mkdtempSync(path.join(home, 'new-'));
  assert.equal(P.pinnedCwd('s-old', other, now), other, 'stale: re-pinned');
  assert.equal(P.pinnedCwd('s-ro', first, now, { write: false }), first, 'no pin yet: the current folder, nothing written');
  assert.equal(P.pinnedCwd('s-ro', other, now, { write: false }), other, 'read only never pinned it');
  assert.equal(P.pinnedCwd('s-old', first, now, { write: false }), other, 'a fresh pin is returned');
});
