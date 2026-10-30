// Waymark 2.0.18 · point 5: precedent, a similar task starts from the evidence of an earlier one (docs/adr/0033).
// Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-prec-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/precedent.mjs`);
const Prov = await import(`file://${SCRIPTS}/provenance.mjs`);

const day = new Date().toLocaleDateString('sv');
let n = 0;
// A recorded task: its ask, its files, its Aprendido, the gates it ran.
const task = (prompt, files, learned = '', over = {}) => ({ id: `${day} · T${++n}`, at: new Date(Date.UTC(2026, 9, 1, 10, n)).toISOString(), session: `s${n}`, prompt, files, level: 2, // a session each, unless the test says
  cierre: `## Cierre · x\nResultado: hecho\nEvidencia: observada y\nAprendido: ${learned || 'nada nuevo'} ← pedido`, observed: { gates: [] }, ...over });
const corpus = () => { n = 0; return [
  task('agrega reintentos con backoff al servicio de pedidos', ['/p/src/orders.service.mjs', '/p/tests/orders.test.mjs'], 'el backoff se prueba con reloj falso, nunca con sleep', { observed: { gates: [{ cmd: 'cd /p && node --test tests/orders.test.mjs 2>&1 | tail -3' }, { cmd: 'node --check src/orders.service.mjs' }] } }),
  task('corrige el login que falla con tokens vencidos', ['/p/src/auth.mjs'], 'el token vencido devuelve 401, no 500'),
  task('actualiza el README con la tabla de instalación', ['/p/README.md'], 'la tabla se genera con docs-gen'),
  task('refactoriza el módulo de pagos para separar el cobro del recibo', ['/p/src/payments.mjs', '/p/src/receipt.mjs'], 'el recibo no depende del proveedor'),
]; };

test('tokens: lower case, no accents, no stop words or tags, a path and a version keep their parts, a plural loses its s', () => {
  assert.deepEqual(P.tokens('Corrige el LOGIN que falla'), ['corrige', 'login', 'falla']);
  assert.deepEqual(P.tokens('<pasted_content id="x"> pruébalo en src/auth.mjs'), ['pruebalo', 'src/auth.mjs', 'src', 'auth', 'mjs'].map((w) => w.replace(/(es|s)$/, '')));
  assert.ok(P.tokens('sigue con el plan 2.0.18').includes('2.0.18'), 'a dotted version is a word');
  assert.deepEqual(P.tokens('cuál es la capital de Francia'), ['capital', 'francia']);
});

test('search: the earlier task that shares the rarer words ranks first; nothing in common, nothing ranked', () => {
  const [top, second] = P.search('arregla el backoff de reintentos del servicio de pedidos', corpus(), 3);
  assert.match(top.record.prompt, /reintentos con backoff/);
  assert.ok(!second || second.score < top.score);
  assert.deepEqual(P.search('receta de arroz con coco', corpus()), []);
});

test('precedentFor: hands over the best task with its files, gates and lesson, in at most 400 characters', () => {
  const p = P.precedentFor('agrega reintentos con backoff al cliente de pedidos', corpus());
  assert.ok(p, 'a resemblance is handed over');
  assert.match(p.task, /T1$/);
  assert.match(p.text, /^Precedent .* \(L2\): "agrega reintentos con backoff/);
  assert.match(p.text, /→ orders\.service\.mjs, orders\.test\.mjs/);
  assert.match(p.text, /gates: node --check src\/orders\.service\.mjs; node --test tests\/orders\.test\.mjs ·/, 'newest first, without the redirection');
  assert.match(p.text, /learned: el backoff se prueba con reloj falso/);
  assert.match(p.text, /earlier evidence, not fact: check it against the code\.$/);
  assert.ok(p.chars <= P.MAX_CHARS && p.chars === p.text.length);
  assert.deepEqual(p.files, ['orders.service.mjs', 'orders.test.mjs']);
});

test('precedentFor: nothing when nothing resembles the ask, when only one rare word is shared, or when the ask is too short', () => {
  const c = corpus();
  assert.equal(P.precedentFor('cuál es la capital de Francia', c), null, 'an unrelated ask');
  assert.equal(P.precedentFor('backoff', c), null, 'one significant word');
  assert.equal(P.precedentFor('ok', c), null);
  assert.equal(P.precedentFor('receta de arroz con coco y pollo', c), null);
  const lone = [task('agrega reintentos con backoff', ['/p/a.mjs'])];
  assert.equal(P.precedentFor('prueba el backoff', lone), null, 'a single shared word is a coincidence');
  process.env.WAYMARK_PRECEDENT = '0';
  assert.equal(P.precedentFor('agrega reintentos con backoff al servicio de pedidos', c), null, 'switched off');
  delete process.env.WAYMARK_PRECEDENT;
});

test('handover: the longest possible stays within the cap, and the lesson takes what the rest leaves', () => {
  const long = task('x'.repeat(300) + ' reintentos backoff', Array.from({ length: 12 }, (_, i) => `/p/src/some-quite-long-file-name-${i}.mjs`), 'y'.repeat(500),
    { observed: { gates: [{ cmd: 'npm run lint -- --max-warnings=0 --config /very/long/path/to/an/eslint/config/file.json' }, { cmd: 'npm test -- --runInBand --coverage' }] }, level: 3, taskType: 'feature' });
  const text = P.handover(long);
  assert.ok(text.length <= P.MAX_CHARS, `${text.length}`);
  assert.match(text, /\+9 /, 'the files beyond three are counted');
  assert.match(text, /\(L3 feature\)/);
  const short = P.handover(corpus()[1]);
  assert.match(short, /learned: el token vencido devuelve 401/, 'a short lesson is whole');
});

test('gatesOf: the test, lint, check or build segment of each recorded gate, newest first, two at most; setup commands are not gates', () => {
  const r = { observed: { gates: [{ cmd: 'cd /p && ls' }, { cmd: 'echo hi; npm run build' }, { cmd: 'git status && pytest -q tests/' }, { cmd: 'node --check a.mjs' }] } };
  assert.deepEqual(P.gatesOf(r), ['node --check a.mjs', 'pytest -q tests/']);
  assert.deepEqual(P.gatesOf({}), []);
});

test('evaluate: each task is searched with its own ask against the tasks before it, and scored against a random choice', () => {
  n = 0;
  const c = [
    task('agrega reintentos con backoff al servicio de pedidos', ['/p/src/orders.mjs']),
    task('corrige el login con tokens vencidos', ['/p/src/auth.mjs']),
    task('actualiza el README con la tabla de instalación', ['/p/README.md']),
    task('ajusta el backoff de reintentos del servicio de pedidos', ['/p/src/orders.mjs']),   // the same files as the first: findable
    task('documenta los tokens vencidos del login en el README', ['/p/README.md']),            // the README again
    task('receta de arroz', ['/p/src/other.mjs']),                                              // no earlier task on its files
  ];
  const e = P.evaluate(c, { root: '/p' });
  assert.equal(e.tasks, 6);
  assert.equal(e.eligible, 2, 'only the tasks that have an earlier task on the same files count');
  assert.equal(e.precisionAtK, 1);
  assert.ok(e.randomAtK > 0 && e.randomAtK < 1 && e.lift > 0);
  assert.equal(e.detail[0].id, c[3].id);
  assert.equal(e.detail[0].hit, true);
  assert.ok(e.maxChars <= P.MAX_CHARS);
  assert.equal(P.evaluate([c[0]], { root: '/p' }).eligible, 0, 'a lone task has nothing before it');
});

// ---- 2.0.20 point 24, check 10.3: a miss that is impossible by construction is no miss ----
test('evaluate: the earlier tasks of the same session are not relevant, because the hand-over searches only the tasks of other sessions', () => {
  n = 0;
  const same = (prompt, files) => task(prompt, files, '', { session: 'one-session' });
  const c = [
    same('agrega reintentos con backoff al servicio de pedidos', ['/p/src/orders.mjs']),
    same('ajusta el timeout de los reintentos del servicio de pedidos', ['/p/src/orders.mjs']),      // its only precedent is in its own session
    task('corrige el login con tokens vencidos', ['/p/src/auth.mjs']),
    task('revisa el servicio de pedidos y sus reintentos', ['/p/src/orders.mjs']),                   // another session: findable
  ];
  const e = P.evaluate(c, { root: '/p' });
  assert.equal(e.eligible, 1, 'the second task cannot find the first (same session): it is not eligible; the fourth can');
  assert.equal(e.precisionAtK, 1, 'and the measure no longer carries a miss no search could avoid');
  assert.equal(e.detail.length, 1);
  assert.equal(e.detail[0].id, c[3].id);
});

test('usedOf: cited when the task names the earlier one, files when a call touched its files, otherwise null', () => {
  const p = { task: `${day} · T4`, files: ['orders.mjs'] };
  assert.equal(P.usedOf(p, { texts: [`Seguí el precedente ${day} · T4`], tools: [] }), 'cited');
  assert.equal(P.usedOf(p, { texts: [], tools: [{ name: 'Read', input: { file_path: '/p/src/Orders.mjs' } }] }), 'files');
  assert.equal(P.usedOf(p, { texts: ['hecho'], tools: [{ name: 'Read', input: { file_path: '/p/README.md' } }] }), null);
  assert.equal(P.usedOf(null, { texts: [], tools: [] }), null);
});

test('state: the first prompt keeps what it handed over, the close takes it, null clears it', () => {
  P.keepPrecedent('s-a', { task: 't', score: 7, files: ['a.mjs'], chars: 120 });
  assert.deepEqual([P.takePrecedent('s-a').task, P.takePrecedent('s-a').files], ['t', ['a.mjs']]);
  assert.equal(P.takePrecedent('s-b'), null);
  P.keepPrecedent('s-a', null);
  assert.equal(P.takePrecedent('s-a'), null);
});

// ---- the hooks: the first prompt of a task is handed the precedent, later prompts and unrelated asks are not; the record keeps it ----
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-prec-proj-'));
  temps.push(d);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'x'); git('add', 'a.txt'); git('commit', '-q', '-m', 'init');
  corpus().forEach((t, i) => Prov.appendRecord(d, { ...t, schema: 'waymark.record/v2', id: `${day} · T${i + 1}`, agent: 'claude', cwd: d, commits: [], decisions: [], evaluation: { score: '1/1', tokens: 1 }, inputs: {}, level: 2 }));
  return d;
}
const prompt = (cwd, session, text) => {
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { input: JSON.stringify({ cwd, session_id: session, prompt: text, hook_event_name: 'UserPromptSubmit' }), env: process.env, encoding: 'utf8' });
  return JSON.parse(r.stdout || '{}').hookSpecificOutput?.additionalContext || '';
};

test('the per-prompt hook: a resembling first prompt gets the precedent; a later prompt of the task and an unrelated ask do not', () => {
  const d = project();
  const first = prompt(d, 's-one', 'agrega reintentos con backoff al cliente de pedidos');
  assert.match(first, /Precedent \S+ · T1 \(L2\): "agrega reintentos con backoff/);
  assert.equal(P.takePrecedent('s-one').task, `${day} · T1`);
  const again = prompt(d, 's-one', 'ahora agrega reintentos con backoff también al cliente de pagos');
  assert.doesNotMatch(again, /Precedent/, 'the same task is not handed it again');
  const unrelated = prompt(d, 's-two', 'cuál es la capital de Francia');
  assert.doesNotMatch(unrelated, /Precedent/);
  assert.equal(P.takePrecedent('s-two'), null, 'nothing kept for an ask that got nothing');
});

test('the stop hook: the record keeps the precedent that was handed over and whether the task used it, then forgets it', () => {
  const d = project();
  P.keepPrecedent('s-close', { task: `${day} · T1`, score: 9.1, files: ['orders.service.mjs'], chars: 310 });
  const lines = [{ type: 'user', uuid: 'p1', timestamp: '2026-10-17T10:00:00Z', message: { role: 'user', content: 'agrega reintentos con backoff al cliente de pedidos' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-backend · skills: ninguna' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: '/p/src/orders.service.mjs' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] } }];
  const transcript = path.join(home, 'prec-close.jsonl');
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const id = Prov.taskIds(d).next;
  spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: d, session_id: 's-close', stop_hook_active: true, last_assistant_message: `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y` }), env: process.env, encoding: 'utf8' });
  const rec = Prov.readTaskRecords(Prov.projectHome(d)).filter((r) => r.id === id).pop();
  assert.deepEqual(rec?.precedent, { task: `${day} · T1`, score: 9.1, chars: 310, files: 1, used: 'files' });
  assert.equal(P.takePrecedent('s-close'), null, 'the close took it');
});

test('a short ask is searched with its session\'s previous task, and the session\'s own tasks are never handed over: they are in its context', () => {
  n = 0;
  const c = [
    task('agrega reintentos con backoff al servicio de pedidos', ['/p/src/orders.service.mjs'], 'el backoff se prueba con reloj falso'),
    task('corrige el login que falla con tokens vencidos', ['/p/src/auth.mjs'], 'el token vencido devuelve 401'),
    task('ajusta los reintentos del servicio de pedidos con tope de cinco', ['/p/src/orders.service.mjs'], 'el tope va en la config', { session: 'live' }),
  ];
  const short = 'sigue con el punto 2';
  assert.equal(P.queryOf(short, c, 'other'), short, 'no task of this session: the ask alone');
  assert.equal(P.precedentFor('sí', c, 0, 'live'), null, 'counter-example: a bare "sí" asks for nothing, whatever its session did');
  assert.match(P.queryOf(short, c, 'live'), /reintentos .*tope va en la config .*orders\.service\.mjs/, 'logic: the previous task of the session beside it');
  const p = P.precedentFor(short, c, 0, 'live');
  assert.equal(p?.task, c[0].id, 'found through the session\'s context, in another session');
  assert.notEqual(P.precedentFor('ajusta los reintentos del servicio de pedidos', c, 0, 'live')?.task, c[2].id, 'counter-example: the session\'s own task is never handed');
  const long = 'revisa la hoja de estilos del header, el espaciado del menú lateral en móvil, los colores de los botones primarios y el contraste del pie';
  assert.equal(P.queryOf(long, c, 'live'), long, 'counter-example: a long ask names enough by itself');
  const css = [task('ajusta el espaciado del header en styles.css', ['/p/src/styles.css']), task('cambia el color del header', ['/p/src/app.css'], 'los colores son tokens', { session: 'ui' })];
  assert.equal(P.precedentFor('y el espaciado también', css, 0, 'ui')?.task, css[0].id, 'CSS/HTML: the same for a stylesheet');
});
