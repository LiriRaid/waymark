// Waymark 2.0.18 · point 10: the ask kept as items and answered, options with their attributes, claims backed, redone work shown (docs/adr/0038).
// Run: node --test tests/*.test.mjs. Temporary WAYMARK_HOME and repos; nothing reads or writes the real ~/.waymark.
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-asked-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_BACKUPS = path.join(home, 'backups');
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const C = await import(`file://${SCRIPTS}/cost.mjs`);
const S = await import(`file://${SCRIPTS}/scorecard.mjs`);

const day = new Date().toLocaleDateString('sv');
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-asked-${name}-`)); temps.push(d); return d; };

// ---- the items of the ask ----

test('Pedido items: numbered requirements from 1 without a gap; what follows Captura is not an item; fewer than two is not a list', () => {
  assert.deepEqual(P.itemsOf('1) agregar la sección 2) corregir los enlaces; 3) quitar lo viejo · Captura: sin captura · Capa: front'), ['agregar la sección', 'corregir los enlaces', 'quitar lo viejo']);
  assert.deepEqual(P.itemsOf('1. uno 2. dos'), ['uno', 'dos']);
  assert.deepEqual(P.itemsOf('(1) uno (2) dos'), ['uno', 'dos']);
  assert.deepEqual(P.itemsOf('1) solo uno · Captura: sin captura'), []);
  assert.deepEqual(P.itemsOf('actualizar la guía'), []);
  assert.deepEqual(P.itemsOf('2) dos 3) tres'), [], 'the numbers run from 1');
  assert.deepEqual(P.itemsOf('1) uno 3) tres'), [], 'and without a gap');
});

test('Pedido items: read from the last Pedido line the agent wrote, never from the Cierre that answers them', () => {
  const text = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
  assert.deepEqual(P.pedidoItems([text('Waymark → L2'), text('```\nPedido: 1) a b 2) c d · Captura: sin captura\nReutiliza: ninguno\n```')]), ['a b', 'c d']);
  assert.deepEqual(P.pedidoItems([text('Pedido: 1) a 2) b'), text('Pedido: 1) a 2) b 3) c')]), ['a', 'b', 'c'], 'the last one');
  assert.deepEqual(P.pedidoItems([text('Pedido: 1) a b 2) c d'), text('## Cierre · x\nResultado: hecho\nPedido: ✔1 a · ✔2 c')]), ['a b', 'c d'], 'the Cierre line is an answer, not the ask');
  assert.deepEqual(P.pedidoItems([{ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'Pedido: 1) a 2) b' }] } }]), [], 'not a subagent');
  assert.deepEqual(P.pedidoItems([]), []);
});

test('Cierre answers: ✔ and ✘ with the item number and a note, in the line or in the lines below it, only inside the Cierre', () => {
  assert.deepEqual(P.pedidoAnswers('## Cierre · x\nResultado: hecho\nPedido: ✔1 hecho en a.mjs · ✘2 falta el test\n - ✔3 ok\nAprendido: y'), [
    { n: 1, ok: true, note: 'hecho en a.mjs' }, { n: 2, ok: false, note: 'falta el test' }, { n: 3, ok: true, note: 'ok' }]);
  assert.deepEqual(P.pedidoAnswers('Pedido: ✔1 x\n## Cierre\nResultado: hecho'), [], 'before the Cierre is not the Cierre');
  assert.deepEqual(P.pedidoAnswers('## Cierre\nResultado: hecho'), []);
  assert.equal(P.pedidoAnswers('## Cierre\nPedido: ✗1 no · ✓2 sí').map((a) => a.ok).join(), 'false,true', 'the other marks count too');
});

test('askedGaps: an item with no answer is named, and hecho over a ✘ is a contradiction; one item or none asks nothing', () => {
  const items = ['agregar la sección', 'corregir los enlaces', 'quitar lo viejo'];
  assert.deepEqual(P.askedGaps(items, [{ n: 1, ok: true }, { n: 2, ok: true }, { n: 3, ok: true }], 'hecho'), []);
  assert.match(P.askedGaps(items, [{ n: 1, ok: true }, { n: 2, ok: true }], 'hecho')[0], /answer each numbered item of the ask \(missing 3\) quitar lo viejo\)/);
  assert.match(P.askedGaps(items, [{ n: 1, ok: true }, { n: 2, ok: true }, { n: 3, ok: false }], 'hecho')[0], /hecho while item 3 is ✘/);
  assert.deepEqual(P.askedGaps(items, [{ n: 1, ok: true }, { n: 2, ok: true }, { n: 3, ok: false }], 'parcial'), [], 'parcial over a ✘ is what it should say');
  assert.deepEqual(P.askedGaps(['solo uno'], [], 'hecho'), []);
  assert.deepEqual(P.askedGaps([], [], 'hecho'), []);
  assert.equal(P.askedGaps(items, [], 'hecho').length, 1, 'no answer at all: one line naming every missing item');
});

// ---- the first choice window ----

const call = (id, questions) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions } }] } });
const answer = (id, questions, picks) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] }, toolUseResult: { questions, answers: picks } });
const win = (questions, picks) => P.decisionsIn([call('q1', questions), answer('q1', questions, picks)]);
const opt = (label, description) => ({ label, description });

test('optionsLint: exactly one option is marked (Recommended); risk, files and cost are recorded when said, never asked; the first window of an L2+ task only', () => {
  const good = [{ question: '¿Cómo?', options: [opt('Backoff (Recommended)', 'Reintentos con espera. Archivos: 2, riesgo bajo.'), opt('Cola', 'Una cola aparte. Cost: alto, riesgo medio, 5 files.')] }];
  assert.deepEqual(P.optionsLint(win(good, { '¿Cómo?': 'Backoff (Recommended)' }), 2), { questions: 1, missing: [] });
  const plain = [{ question: '¿Cómo?', options: [opt('Backoff (Recommended)', 'Reintentos con espera.'), opt('Cola', 'Una cola aparte.')] }];
  assert.deepEqual(P.optionsLint(win(plain, { '¿Cómo?': 'Backoff (Recommended)' }), 2).missing, [], 'counter-example of the old finding: no risk, files or cost words is no gap');
  assert.deepEqual(P.optionAttrs(opt('Backoff (Recommended)', 'Archivos: 2, riesgo bajo.')), { label: 'Backoff (Recommended)', recommended: true, files: 2, risk: 'bajo', estCost: null }, 'the attributes said are kept as fields');
  const bad = [{ question: '¿Cómo?', options: [opt('Backoff', 'Reintentos con espera.'), opt('Cola', 'Una cola aparte. Riesgo medio.')] }];
  const lint = P.optionsLint(win(bad, { '¿Cómo?': 'Backoff' }), 2);
  assert.deepEqual(lint.missing, ['¿Cómo?: no option marked (Recommended)']);
  const two = [{ question: 'a', options: [opt('X (Recommended)', 'riesgo bajo, 1 archivo'), opt('Y (Recommended)', 'riesgo bajo, 1 archivo')] }];
  assert.match(P.optionsLint(win(two, { a: 'X (Recommended)' }), 3).missing[0], /more than one option marked/);
  assert.equal(P.optionsLint(win(bad, { '¿Cómo?': 'Backoff' }), 1), null, 'L1 is not judged');
  assert.equal(P.optionsLint(win(bad, { '¿Cómo?': 'Backoff' }), 'Q'), null);
  assert.equal(P.optionsLint(win([{ question: 'ok', options: [opt('Sí', 'x')] }], { ok: 'Sí' }), 2), null, 'one option is a confirmation, not judged');
  assert.equal(P.optionsLint([], 2), null);
});

test('optionsLint: only the first window is judged, the later ones only confirm', () => {
  const first = [{ question: 'uno', options: [opt('A (Recommended)', 'riesgo bajo, 2 archivos'), opt('B', 'riesgo alto, coste alto')] }];
  const later = [{ question: 'dos', options: [opt('Sí', 'x'), opt('No', 'y')] }];
  const decisions = P.decisionsIn([call('q1', first), answer('q1', first, { uno: 'A (Recommended)' }), call('q2', later), answer('q2', later, { dos: 'Sí' })]);
  assert.equal(decisions.length, 2);
  assert.deepEqual(P.optionsLint(decisions, 2), { questions: 1, missing: [] });
});

// ---- the end-of-turn hook ----

const prompt = (t) => ({ type: 'user', uuid: `p${Math.random()}`, message: { role: 'user', content: t } });
const say = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } });
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const FILE = '/work/proj/src/orders.service.mjs';
const PEDIDO = 'Pedido: 1) agregar reintentos 2) registrar cada intento 3) documentar el límite · Captura: sin captura';
const OPTIONS = [{ question: '¿Cómo?', options: [opt('Backoff (Recommended)', 'Reintentos con espera. Archivos: 2, riesgo bajo.'), opt('Cola', 'Una cola aparte. Costo alto, riesgo medio, 5 archivos.')] }];
const turn = (pedido, options = OPTIONS) => [prompt('agrega reintentos, registra cada intento y documenta el límite'), say('Waymark → L2 · dept-backend · skills: code-review'), say(pedido), use('s1', 'Skill', { skill: 'dept-backend' }),
  use('p1', 'Read', { file_path: '/skills/dept-backend/procedures.md' }), use('m1', 'Bash', { command: 'node "/s/waymark/scripts/waymark.mjs" pack src/orders.service.mjs' }),
  call('q1', options), answer('q1', options, { '¿Cómo?': 'Backoff (Recommended)' }),
  use('e1', 'Edit', { file_path: FILE }), use('b1', 'Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), use('r1', 'Skill', { skill: 'code-review' }),
  use('w1', 'Edit', { file_path: path.join(os.homedir(), '.waymark', 'projects', 'proj.md') })];
const cierre = (id, mid) => `## Cierre · ${id}\n${mid}\nEvidencia: observada timeouts en el log de pedidos\nAprendido: "backoff ← timeouts"`;
const runStop = (cwd, lines, reply, extra = {}) => {
  const transcript = path.join(home, `asked-${Math.random()}.jsonl`);
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: `sa1-${path.basename(path.dirname(cwd))}`, last_assistant_message: reply, ...extra }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout || '{}');
};
const cwdOf = (name) => { const d = path.join(tmp(name), 'proj'); fs.mkdirSync(d, { recursive: true }); return d; };

test('stop hook: an L2 whose ask has three items and whose Cierre answers two is sent back once, then recorded parcial with what stayed open', () => {
  const cwd = cwdOf('missing'), id = `${day} · T1`;
  const reply = cierre(id, 'Resultado: hecho\nPedido: ✔1 reintentos en orders.service.mjs · ✔2 log por intento');
  const first = runStop(cwd, turn(PEDIDO), reply);
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /answer each numbered item of the ask \(missing 3\) documentar el límite\)/);
  assert.equal(P.readLog(cwd).length, 0, 'not recorded yet');
  const second = runStop(cwd, turn(PEDIDO), reply, { stop_hook_active: true });
  assert.ok(second.systemMessage, 'the second time it is recorded, not blocked again');
  const rec = P.readLog(cwd).pop();
  assert.deepEqual(rec.asked, ['agregar reintentos', 'registrar cada intento', 'documentar el límite']);
  assert.deepEqual(rec.answered.map((a) => [a.n, a.ok]), [[1, true], [2, true]]);
  assert.equal(rec.outcome.result, 'parcial', 'never hecho over an item nobody answered');
  assert.equal(rec.outcome.said, 'hecho');
  assert.ok(rec.unresolved.some((u) => /answer each numbered item/.test(u)), JSON.stringify(rec.unresolved));
});

test('stop hook: every item answered, the last one ✘ under parcial, is recorded as it says', () => {
  const cwd = cwdOf('answered'), id = `${day} · T1`;
  const reply = cierre(id, 'Resultado: parcial (falta documentar el límite)\nPedido: ✔1 reintentos · ✔2 log por intento · ✘3 sin documentar: no hay sección de límites');
  assert.match(runStop(cwd, turn(PEDIDO), reply).reason, /Resultado: parcial leaves work undone/, 'no task closes parcial: the work is finished or the Cierre says bloqueado, asked once');
  const out = runStop(cwd, turn(PEDIDO), reply, { stop_hook_active: true }); // the reply after the block keeps parcial: the record says what the agent said
  assert.ok(out.systemMessage && !out.decision, JSON.stringify(out));
  const rec = P.readLog(cwd).pop();
  assert.deepEqual(rec.answered.map((a) => [a.n, a.ok]), [[1, true], [2, true], [3, false]]);
  assert.equal(rec.outcome.result, 'parcial');
  assert.equal(rec.outcome.said, undefined);
  assert.deepEqual(rec.unresolved.filter((u) => /numbered item|hecho while/.test(u)), []);
});

test('stop hook: a Pedido that is not a list asks nothing of the Cierre, and a window with no option marked is a finding that does not block', () => {
  const cwd = cwdOf('plain'), id = `${day} · T1`;
  const bare = [{ question: '¿Cómo?', options: [opt('Backoff', 'Reintentos con espera.'), opt('Cola', 'Una cola aparte.')] }];
  const out = runStop(cwd, turn('Pedido: agregar reintentos · Captura: sin captura', bare), cierre(id, 'Resultado: hecho'));
  assert.ok(out.systemMessage && !out.decision, JSON.stringify(out));
  const rec = P.readLog(cwd).pop();
  assert.equal(rec.answered, undefined);
  assert.equal(rec.outcome.result, 'hecho');
  assert.ok(rec.findings.some((f) => /first choice window does not mark exactly one option \(Recommended\) \(recorded, not blocked\)/.test(f)), JSON.stringify(rec.findings));
  assert.deepEqual(rec.observed.options.missing, ['¿Cómo?: no option marked (Recommended)'], 'only the mark; the options saying no risk or files is no gap');
});

test('stop hook: the options with their attributes leave no finding, and L1 is not judged', () => {
  const cwd = cwdOf('ok'), id = `${day} · T1`;
  runStop(cwd, turn(PEDIDO), cierre(id, 'Resultado: hecho\nPedido: ✔1 a · ✔2 b · ✔3 c'));
  const rec = P.readLog(cwd).pop();
  assert.deepEqual(rec.observed.options, { questions: 1, missing: [] });
  assert.equal(rec.findings.some((f) => /choice window's options/.test(f)), false);
});

// ---- tasks.md and cost ----

test('tasks.md: the claims a call backs per task (⚠ below 0.95) and the tasks whose files came back', () => {
  const repo = tmp('md');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  const h = P.projectHome(repo), at = new Date(Date.now() - 3600000).toISOString();
  const rec = (id, extra = {}) => JSON.stringify({ id, at, cierre: 'Resultado: hecho', prompt: 'p', files: ['/p/a.mjs'], ...extra });
  fs.writeFileSync(h.log, [
    rec(`${day} · T1`, { observed: { evidence: { cited: 10, unbacked: [] } } }),
    rec(`${day} · T1b`, { observed: { evidence: { cited: 10, unbacked: ['x', 'y'] } }, reworks: [`${day} · T1`], reworkFiles: ['/p/a.mjs'] }),
    rec(`${day} · T2`, { files: ['/p/b.mjs'] }),
  ].join('\n') + '\n');
  const md = P.tasksMarkdown(h);
  assert.match(md, /\| Task \| Result \| Routine \| Backed \| Request \|/);
  assert.match(md, new RegExp(`\\| ${day} · T1 \\|[^\\n]*\\| 10/10 \\|`));
  assert.match(md, new RegExp(`\\| ${day} · T1b \\|[^\\n]*\\| ⚠ 8/10 \\|`), 'below the frozen 0.95');
  assert.match(md, new RegExp(`\\| ${day} · T2 \\|[^\\n]*\\| — \\|`), 'cited nothing');
  assert.match(md, /## Redone or reworked/);
  assert.match(md, /- [^\n]*T1 · redone as T1b/);
  assert.match(md, /- [^\n]*T1b · changes the files of T1 \(a\.mjs\)/);
  assert.ok(md.length <= 3000);
});

test('cost: the cited facts a call backs, summed per version and level', () => {
  assert.deepEqual(C.backedOf([{ cited: 10, unbacked: 0 }, { cited: 10, unbacked: 2 }, { cited: 0, unbacked: 0 }]), { cited: 20, backed: 18, ratio: 0.9 });
  assert.equal(C.backedOf([{ cited: 0, unbacked: 0 }]), null);
  const g = C.groups([{ version: '2.0.18', level: 2, tokens: 100, units: 100, usage: {}, links: null, responses: null, subagents: 0, cited: 4, unbacked: 1 }]);
  assert.deepEqual(g[0].backed, { cited: 4, backed: 3, ratio: 0.75 });
});

// ---- the thresholds frozen in this ADR ----

test('scorecard: the thresholds of 11.2 and 13.5 are frozen from the baseline, and the ADR holds the lock', () => {
  const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const card = S.readScorecard(repo), check = (id) => card.criteria.flatMap((k) => k.checks).find((c) => c.id === id);
  assert.deepEqual([check('11.2').op, check('11.2').threshold], ['ge', 0.95]);
  assert.deepEqual([check('13.5').op, check('13.5').threshold], ['le', 0.2]);
  assert.equal(card.adr, '0049');
  assert.equal(S.adrLock(repo, card), S.lockOf(card));
});
