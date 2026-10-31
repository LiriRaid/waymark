// Waymark 2.0.20 · points 2 and 9: no task closes `parcial`. A gap only the user's manual test can close is `hecho` with a visible "pending from you";
// a gap that is the work is told to be finished (an L2/L3 task is one task) or written `bloqueado`. Synthetic copies of the real patterns (ADR 0042).
// Run: node --test tests/no-parcial.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-noparcial-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_REVIEW_MODE = 'always';
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { cierreGaps, outcome } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn, sessionTools } = await import(`file://${SCRIPTS}/transcript.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

let ids = 0;
const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input, out = 'ok', error = false) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }]; };
const ASKED = [...call('AskUserQuestion', { questions: [] }), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'none', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'A' }, { label: 'B' }] }], answers: { '¿Cómo?': 'A' } } }];
const cierre = (result) => `## Cierre · 2026-10-29 · T1\nResultado: ${result}\nEvidencia: observada ok\nAprendido: x ← y`;
const turn = [prompt('agrega el filtro por fecha a los pedidos'), say('Waymark → L2 · dept-backend'), ...call('Skill', { skill: 'dept-backend' }), ...ASKED,
  ...call('Edit', { file_path: '/work/proj/src/orders.service.mjs' }), ...call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), ...call('Skill', { skill: 'code-review' })];
const judge = (reply) => cierreGaps(currentTurn(turn), reply, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1, taskTools: sessionTools(turn), outside: true });
const parcialAsked = (g) => g.missing.some((m) => /parcial/i.test(m));

test('2: a gap only the user\'s manual test can close is hecho, with what is pending from them', () => {
  for (const gap of ['falta tu prueba manual en el navegador', 'falta que pruebes tú el flujo de pago', 'pending: your manual test of the checkout', 'falta tu verificación manual del correo']) {
    const r = outcome(`Resultado: parcial (${gap})`, [], [], 2);
    assert.deepEqual([r.result, r.userOwned], ['hecho', ['manual']], gap);
    assert.ok(r.pending?.length, `${gap}: the pending line is kept`);
  }
  const both = outcome('Resultado: parcial (falta tu PR y tu prueba manual)', [], [], 2, new Set(['pr']));
  assert.deepEqual([both.result, both.userOwned.sort()], ['hecho', ['manual', 'pr']]);
});

test('2: counter-examples — a test the agent can run, or any gap of the work, keeps the record parcial', () => {
  for (const gap of ['falta probar el filtro por fecha', 'falta el endpoint de pedidos', 'faltan los tests del servicio', 'falta el ajuste del botón y tu prueba manual']) assert.equal(outcome(`Resultado: parcial (${gap})`, [], [], 2).result, 'parcial', gap);
  assert.equal(outcome('Resultado: parcial (falta tu prueba manual)\nPedido: ✔1 filtro · ✘2 el color no cambió', [{}, {}], [{ n: 1, ok: true }, { n: 2, ok: false, note: 'el color no cambió' }], 2).result, 'parcial', 'an item of the ask marked ✘ for another reason');
});

test('2: a parcial for the work is told once to finish it or write bloqueado; hecho, bloqueado and the user\'s own gap are not', () => {
  assert.equal(parcialAsked(judge(cierre('parcial (falta el endpoint de pedidos)'))), true, 'the work is missing: finish it ');
  const g = judge(cierre('parcial (falta el endpoint de pedidos)'));
  assert.match(g.missing.find((m) => /parcial/i.test(m)), /bloqueado/, 'the way out is named');
  assert.equal(parcialAsked(judge(cierre('hecho'))), false);
  assert.equal(parcialAsked(judge(cierre('bloqueado (falta la base de datos del cliente)'))), false, 'bloqueado is the honest open state');
  assert.equal(parcialAsked(judge(cierre('parcial (falta tu prueba manual en el navegador)'))), false, 'the only gap is the user\'s: hecho with a pending line');
  assert.equal(parcialAsked(judge(cierre('parcial (usage limit reached: faltan 5 de 13 pasos)'))), false, 'a cause outside the work cannot be finished by the agent');
});

test('2: tasks.md names what is pending from the user, in the table and in the last closed task', async () => {
  const { spawnSync } = await import('node:child_process');
  const { tasksMarkdown } = await import(`file://${SCRIPTS}/provenance/taskmd.mjs`);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-noparcial-')); after(() => fs.rmSync(d, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  P.appendRecord(d, { schema: 'waymark.record/v2', id: '2026-10-29 · T1', agent: 'claude', at: new Date().toISOString(), session: 's1', cwd: d, level: 2, prompt: 'agrega el filtro',
    cierre: '## Cierre · 2026-10-29 · T1\nResultado: parcial (falta tu prueba manual del filtro)\nEvidencia: observada ok\nAprendido: x ← y', inputs: { waymark: '2.0.19' },
    outcome: { result: 'hecho', said: 'parcial', userOwned: ['manual'], pending: ['falta tu prueba manual del filtro'] } });
  const md = tasksMarkdown(P.projectHome(d));
  assert.match(md, /Pendiente de ti: falta tu prueba manual del filtro/, 'the last closed task says it');
  assert.match(md, /hecho \(pendiente tuyo: prueba manual\)/, 'the table says it');
  assert.ok(!/manual: tuyo/.test(md), 'the step key alone is not shown');
});

test('3: the record keeps every prompt of the task, masked, and the first one stays as `prompt`', async () => {
  const { provenanceRecord } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const t = currentTurn(turn);
  const ctx = { ids: P.taskIds('/nowhere'), decisions: [], records: [], cwd: '/work/proj', commits: [], inputs: {} };
  const gaps = cierreGaps(t, cierre('hecho'), undefined, undefined, { ...ctx, decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }], procDelivered: ['dept-backend'], packed: 1, taskTools: sessionTools(turn), outside: true });
  const one = provenanceRecord(t, gaps, ctx, {});
  assert.equal(one.prompts, undefined, 'a task of one prompt keeps just `prompt`');
  const many = provenanceRecord(t, gaps, { ...ctx, taskPrompts: ['agrega el filtro por fecha', 'ahora también por cliente', 'la clave es sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'] }, {});
  assert.equal(many.prompts.length, 3);
  assert.equal(many.prompts[1], 'ahora también por cliente');
  assert.ok(!/sk-ant-api03-A{20}/.test(many.prompts[2]), 'a secret in a later prompt is masked');
});

// ---- points 3 and 9: what continues a task ----
const { taskLine } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
const { spawnSync: git } = await import('node:child_process');
const closedTask = (session, { result = 'hecho', aprendido = 'x ← y', cause } = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-cont-')); after(() => fs.rmSync(d, { recursive: true, force: true }));
  git('git', ['init', '-q'], { cwd: d });
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  P.appendRecord(d, { id: '2026-10-25 · T1', agent: 'claude', at: new Date().toISOString(), session, cwd: d, level: 2, files: ['src/orders.service.mjs'], cierre: `## Cierre · 2026-10-25 · T1\nResultado: ${result}\nAprendido: ${aprendido}`, outcome: { result, ...(cause ? { cause } : {}) } });
  return (prompt, reply = 'Listo.') => taskLine(d, new Date(), { session, prompt, reply });
};

test('9: the next ask on a task left open (bloqueado, parcial, a step ahead) continues it, whatever its words; a closed task or a cause outside the work does not', () => {
  const asks = ['agrega también el filtro por cliente', 'sí, hazlo con la fase 2', 'usa la base de datos de staging'];
  for (const result of ['bloqueado', 'parcial']) { const line = closedTask(`s-open-${result}`, { result }); for (const p of asks) assert.match(line(p), /follow-up 2026-10-25 · T1b/, `${result}: ${p}`); }
  const plan = closedTask('s-plan', { aprendido: '✔1 · ▶2 · 3 ← pasos' });
  for (const p of asks) assert.match(plan(p), /follow-up 2026-10-25 · T1b/, `a step ahead: ${p}`);
  const done = closedTask('s-done');
  for (const p of asks) assert.doesNotMatch(done(p), /follow-up/, `counter-example, hecho: ${p}`);
  const external = closedTask('s-ext', { result: 'parcial', cause: 'external' });
  assert.doesNotMatch(external(asks[0]), /follow-up/, 'counter-example: a parcial for a cause outside the work');
});

test('3: an ask that says something about the last result is its follow-up, in the user\'s own words; an ask for something new is not', () => {
  const line = closedTask('s-said');
  for (const p of ['el botón no se ve en móvil', 'no me sale el total en el resumen', 'te faltó el borde del input', 'olvidaste el filtro por fecha', 'no quedó alineado con el título', 'quedó mal el color del encabezado', 'you forgot the border', 'the total is not showing']) assert.match(line(p), /follow-up 2026-10-25 · T1b/, p);
  for (const p of ['dale un margen de 8px al botón', 'agrega el filtro por cliente', 'cambia el color del título', 'no uses colores fuertes en el diseño nuevo', 'no hay que tocar el login', 'add a filter by customer']) assert.doesNotMatch(line(p), /follow-up/, `counter-example: ${p}`);
});

// ---- point 9: the window never offers a phase of the ask as a way to shrink it ----
const wcall = (id, questions) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } });
const wanswer = (id, questions, picks) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] }, toolUseResult: { questions, answers: picks } });
const wopt = (label, description) => ({ label, description });
const windowOf = (options, level = 2) => { const qs = [{ question: '¿Cómo lo hacemos?', options }]; return P.optionsLint(P.decisionsIn([wcall('q1', qs), wanswer('q1', qs, { '¿Cómo lo hacemos?': options[0].label })]), level); };

test('9: an option that offers only a phase of the ask is found at L2+ (recorded, never an L1 matter); a plain option or a phase named as a step is not', () => {
  for (const shrink of [wopt('Solo la fase 1 (Recommended)', 'Hace lo básico y deja el resto para otra tarea.'), wopt('Primera fase (Recommended)', 'Menos riesgo.'), wopt('Todo (Recommended)', 'Cubre el pedido. Alternativa: solo la fase 1 ahora y el resto luego.'), wopt('Only phase 1 (Recommended)', 'Smaller change.'), wopt('Empezar por una fase (Recommended)', 'x')]) {
    const lint = windowOf([shrink, wopt('Otra', 'La alternativa.')]);
    assert.ok(lint.phased?.length, `${shrink.label}: found`);
  }
  assert.equal(windowOf([wopt('Cola aparte (Recommended)', 'Una cola para los pedidos.'), wopt('Backoff', 'Reintentos con espera.')]).phased, undefined, 'a window with no phase says nothing');
  assert.equal(windowOf([wopt('Todo el pedido (Recommended)', 'Los seis pasos en una tarea: la fase 1 es el esquema, la 2 el servicio.'), wopt('Otra', 'x')]).phased, undefined, 'counter-example: the phases are the steps of the whole ask');
  assert.equal(windowOf([wopt('Solo la fase 1 (Recommended)', 'x'), wopt('Otra', 'y')], 1), null, 'counter-example: L1 is not judged');
});

// ---- point 10(d): the ID the Cierre heading takes is shown with the block that asks for the Cierre ----
test('10: a block that asks for the Cierre names the task ID and the follow-up ID the hook accepts; other blocks do not repeat it', async () => {
  const { blockReason } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const noCierre = ['the "## Cierre · <task ID>" block (Resultado · Evidencia · Aprendido)'];
  assert.match(blockReason({ level: 2, missing: noCierre, ids: { next: '2026-10-29 · T9', followUp: '2026-10-29 · T8b' } }), /The Cierre heading takes the ID 2026-10-29 · T9 \(or 2026-10-29 · T8b when this ask continues it\)\. Do what is missing/);
  assert.match(blockReason({ level: 2, missing: noCierre, ids: { next: '2026-10-29 · T9', followUp: null } }), /takes the ID 2026-10-29 · T9\. Do what/, 'no follow-up offered: only the new ID');
  assert.doesNotMatch(blockReason({ level: 2, missing: ['no review ran'], ids: { next: '2026-10-29 · T9', followUp: null } }), /takes the ID/, 'the Cierre is already written: its ID is not repeated');
  assert.doesNotMatch(blockReason({ level: 1, missing: noCierre }), /takes the ID/, 'a caller with no IDs says nothing');
});

// ---- review of level 2: the way out the message names is the one the record understands ----
test('2 (review): "hecho (pendiente tuyo: …)", the form the message asks for, records what is pending and shows it in tasks.md', () => {
  const r = outcome('Resultado: hecho (pendiente tuyo: prueba manual del flujo de pago)', [], [], 2);
  assert.deepEqual([r.result, r.userOwned], ['hecho', ['manual']]);
  assert.deepEqual(r.pending, ['prueba manual del flujo de pago']);
  assert.deepEqual(outcome('Resultado: hecho', [], [], 2), { result: 'hecho' }, 'counter-example: a plain hecho records nothing pending');
  assert.equal(outcome('Resultado: hecho (todo probado, el pendiente tuyo ya no existe)', [], [], 2).userOwned, undefined, 'counter-example: the words in a sentence are no pending');
});
