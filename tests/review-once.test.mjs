// Waymark 2.0.20 · points 22 and 27: the code-review runs once, when the whole task is complete, over the whole task's change; what the user says once about the
// job (the repo, the closing rule) belongs to the job. Synthetic copies of the real patterns (ADR 0042). Run: node --test tests/review-once.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-review-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_REVIEW_MODE = 'always';
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { cierreGaps, pendingSteps, taskOpen } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn, sessionTools } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { softCapLine } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

let ids = 0;
const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input, out = 'ok', error = false) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }]; };
const ASKED = [...call('AskUserQuestion', { questions: [] }), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'none', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'A' }, { label: 'B' }] }], answers: { '¿Cómo?': 'A' } } }];
const F = (n) => `/work/proj/src/mod${n}.service.mjs`;
const cierre = (result, aprendido = 'x ← y') => `## Cierre · 2026-10-29 · T1\nResultado: ${result}\nEvidencia: observada ok\nAprendido: ${aprendido}`;
const GATE = call('Bash', { command: 'node --check src/mod1.service.mjs && npm run build' });
const REVIEW = call('Skill', { skill: 'code-review' });
const head = [prompt('construye el módulo de pedidos'), say('Waymark → L3 · dept-architecture'), ...call('Skill', { skill: 'dept-architecture' }), ...ASKED];
// the task as the hook reads it: all the turns' calls (`taskTools`), and the last turn's (`turn`)
const judge = (earlier, last, reply, ctx = {}) => {
  const task = [...head, ...earlier, ...last], lines = [...head, ...earlier, prompt('sigue con lo que falta'), ...last];
  return cierreGaps(currentTurn(lines), reply, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }], cwd: '/work/proj', procDelivered: ['dept-architecture'], packed: 1, taskTools: sessionTools(task), outside: true, inherited: { level: 3, dept: 'dept-architecture' }, sessionDepts: ['dept-architecture'], ...ctx });
};
const reviewOwed = (g) => g.missing.some((m) => /no review ran/.test(m));
const edits = (...ns) => ns.flatMap((n) => call('Edit', { file_path: F(n) }));

test('27: a turn that leaves the task open (parcial, bloqueado, a step ahead) is not asked for the review; the turn that closes it is', () => {
  const turn = [...edits(1, 2), ...GATE];
  assert.equal(reviewOwed(judge([], turn, cierre('hecho', '✔1 · ✔2 · ✔3 ← módulo completo'))), true, 'complete: owed');
  assert.equal(reviewOwed(judge([], turn, cierre('parcial (falta el paso 3)'))), false, 'parcial: not owed yet');
  assert.equal(reviewOwed(judge([], turn, cierre('bloqueado (falta la base de datos)'))), false, 'bloqueado: not owed yet');
  assert.equal(reviewOwed(judge([], turn, cierre('hecho', '✔1 · ▶2 · 3 ← pasos'))), false, 'an L3 with a step ahead: not owed yet');
  assert.equal(reviewOwed(judge([], turn, 'Listo, falta solo el Cierre.')), true, 'counter-example: no Cierre yet, the review is listed with the rest, as before');
  const g = judge([], turn, cierre('parcial (falta el paso 3)'));
  assert.match(g.omitted?.Review || '', /al cierre de la tarea/, 'the record says why nothing blocked');
  assert.equal(judge([], [...turn, ...REVIEW], cierre('hecho', '✔1 · ✔2 · ✔3 ← módulo completo')).missing.some((m) => /no review ran/.test(m)), false, 'reviewed at the end: passes');
});

test('27: the closing turn is judged over the whole task: code changed in earlier turns is owed a review even when the last turn changed none', () => {
  const earlier = [...edits(1, 2, 3, 4, 5, 6), ...GATE];
  const last = call('Bash', { command: 'git status' });
  const g = judge(earlier, last, cierre('hecho', '✔1 · ✔2 ← listo'));
  assert.ok(reviewOwed(g), 'six files in earlier turns, no review: owed at the close');
  assert.equal(reviewOwed(judge(earlier, [...last, ...REVIEW], cierre('hecho', '✔1 · ✔2 ← listo'))), false);
  assert.equal(reviewOwed(judge([...earlier, ...REVIEW], last, cierre('hecho', '✔1 · ✔2 ← listo'))), false, 'a review run once, earlier in the same task, covers the whole change: not asked twice');
});

test('27: the plan steps of an L3 Aprendido and the open Cierre are read as written', () => {
  for (const [a, open] of [['✔1 · ✔2 · ✔3 ← todo', false], ['✔1 · ▶2 · 3 ← sigue', true], ['✔1 · ✔2 · 3 ← falta uno', true], ['▶1 · 2 · 3', true], ['x ← y', false], ['', false], ['backoff ← 5 timeouts', false], ['✔1 · ✔2 ← 29 pruebas', false]]) assert.equal(pendingSteps(a), open, a);
  assert.equal(taskOpen(cierre('hecho')), false);
  assert.equal(taskOpen(cierre('parcial (x)')), true);
  assert.equal(taskOpen('sin cierre'), false);
});

test('22: a quoted refusal is checked against every prompt of the task, not the last three', () => {
  const prompts = ['hazlo todo', 'revisión de código después, al final', 'uno', 'dos', 'tres', 'cuatro'];
  const lines = [prompt('x'), say('Waymark → L2 · dept-backend'), ...ASKED, ...edits(1, 2, 3, 4, 5), ...GATE];
  const reply = `${cierre('hecho')}\nReview: omitido (usuario: "revisión de código después, al final")`;
  const judgeWith = (list) => cierreGaps(currentTurn(lines), reply, undefined, list, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1 });
  assert.equal(reviewOwed(judgeWith(prompts)), false, 'found among the task prompts: the review is skipped as the user said');
  assert.ok(reviewOwed(judgeWith(prompts.slice(-3))) && judgeWith(prompts.slice(-3)).findings.some((e) => /Review: skip quoted/.test(e)), 'counter-example: only the last three would not hold it');
});

test('22: the soft cap does not tell an L2 or L3 to close: it is one task however long; an L1 is told as before', () => {
  const dir = fs.mkdtempSync(path.join(home, 'cap-')), mark = Date.now() - 120 * 60000;
  const long = Array.from({ length: 200 }, (_, i) => call('Edit', { file_path: `/work/proj/src/f${i}.ts` })).flat().map((d) => ({ ...d, timestamp: at(-100000) }));
  const run = (level, session) => softCapLine({ session_id: session, cwd: dir }, { read: () => long }, dir, mark, Date.now(), path.join(dir, `cap-${session}.json`), long, { level });
  assert.match(run(1, 'a'), /Task size/, 'an L1 is told');
  assert.match(run(0, 'b'), /Task size/, 'no level known: told');
  assert.equal(run(2, 'c'), '', 'an L2 is not');
  assert.equal(run(3, 'd'), '', 'an L3 is not');
});
