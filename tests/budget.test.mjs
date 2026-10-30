// Waymark 2.0.19 · point 2 (2g, 2h): a big task is told to split, the context brake advises mid-task and holds between tasks, a courtesy
// or a memory-only turn is no task, and "apply the findings" is the user's own decision. Synthetic copies of the patterns: a logic case,
// a CSS/HTML case and the counter-example for each. Run: node --test tests/budget.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
process.env.WAYMARK_BRAKE_MODE = 'block'; // the cases here are the brake that stops a prompt (opt-in now); the default advice is tests/brake-advice.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-bud-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { softCapLine, softCap, SOFT_CAP, brake } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = (memory = '# P\n\n## Work in progress\n') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bud-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), memory);
  return d;
};
const hookRun = (script, payload, env = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, WAYMARK_HOME: home, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, 60000);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  c.stdin.end(JSON.stringify(payload));
});

let ids = 0, n = 0;
const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const prompt = (text, when = at()) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: when, message: { role: 'user', content: text } });
const say = (text, when = at()) => ({ type: 'assistant', timestamp: when, message: { content: [{ type: 'text', text }] } });
const call = (name, input, when = at()) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: when, message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: when, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
const CIERRE = '## Cierre · 2026-10-25 · T1\nResultado: hecho\nEvidencia: inferida de la lectura (check: node --check)\nAprendido: x ← y';

// ---- 2g · the soft cap of a task ----
const cap = (lines, mark, memory, session) => {
  const dir = tmpRepo(memory), state = path.join(dir, 'cap.json');
  const hook = { session_id: session || `s-cap-${++n}`, cwd: dir };
  const agent = { read: () => lines };
  return [softCapLine(hook, agent, dir, mark, Date.now(), state), () => softCapLine(hook, agent, dir, mark, Date.now(), state)];
};
const edits = (count, ext, when) => Array.from({ length: count }, (_, i) => call('Edit', { file_path: `/work/proj/src/f${i}.${ext}` }, when)).flat();
test('2g: logic — past 150 calls the agent is told once to offer a new task; below it, and after the telling, nothing', () => {
  const mark = Date.now() - 10 * 60000;
  const [first, again] = cap(Array.from({ length: 80 }, () => call('Bash', { command: 'git status' }, at(-5000))).flat(), mark); // 80 calls: not enough
  assert.equal(first, '', 'counter-example: 80 calls is under the cap');
  const calls = Array.from({ length: 160 }, () => call('Bash', { command: 'git status' }, at(-5000))).flat();
  const [told, repeat] = cap(calls, mark);
  assert.match(told, /Task size: this task has run 10 min, 160 calls and 0 changed files \(soft cap 60 min \/ 150 calls \/ 40 files\): offer the user, in your choice window, to close it/);
  assert.equal(repeat(), '', 'told once per task');
  assert.equal(again(), '');
});
test('2g: CSS/HTML — 45 changed stylesheets reach the files cap; the minutes cap counts the time worked since the task\'s start', () => {
  const [told] = cap(edits(45, 'css', at(-5000)), Date.now() - 5 * 60000);
  assert.match(told, /45 changed files/);
  const start = Date.now() - 76 * 60000; // before the first call, so none falls outside the task
  const [slow] = cap(Array.from({ length: 16 }, (_, i) => call('Read', { file_path: '/work/proj/src/app.css' }, at(-(75 - i * 5) * 60000))).flat(), start);
  assert.match(slow, /run 7\d min, 16 calls/);
  const [calls] = cap(edits(45, 'css', at(-5000)), 0);
  assert.equal(calls, '', 'counter-example: no task in progress, nothing to measure');
  const [older] = cap(edits(45, 'css', at(-3 * 3600000)), Date.now() - 5 * 60000);
  assert.equal(older, '', 'counter-example: calls from before the task started are not its own');
});
test('2g: a project sets its own numbers in memory.md', () => {
  assert.deepEqual(softCap('- Soft cap: 90 min / 200 calls / 60 files'), { minutes: 90, calls: 200, files: 60 });
  assert.deepEqual(softCap('## Conventions\n- …'), SOFT_CAP);
  const calls = Array.from({ length: 160 }, () => call('Bash', { command: 'git status' }, at(-5000))).flat();
  const [told] = cap(calls, Date.now() - 10 * 60000, '# P\n\n- Soft cap: 90 min / 200 calls / 60 files\n');
  assert.equal(told, '', '160 calls is under this project\'s 200');
});

// ---- 2g · the context brake advises mid-task and holds between tasks ----
const asAgent = { out: { blockPrompt: (reason) => ({ block: reason }) } };
const braked = (dir, session, context, { midTask = false } = {}) => {
  const state = path.join(dir, `brake-${session}.json`);
  if (midTask) P.markTaskStart(session);
  else P.clearTaskStart(session);
  return brake({ session_id: session, cwd: dir, prompt: 'sigue con el siguiente paso' }, asAgent, { context, lastAt: Date.now() }, state);
};
test('2g: logic — a task in progress past 500k is told to offer a new session, once, and its message is never held; between tasks the brake holds it', () => {
  const dir = tmpRepo();
  const mid = braked(dir, 's-mid', 600000, { midTask: true });
  assert.ok(!mid.block && /Offer the user, in your choice window, to close this task and continue in a new session/.test(mid.line), 'advises, never blocks');
  assert.equal(braked(dir, 's-mid', 600000, { midTask: true }), null, 'once per step');
  assert.equal(braked(dir, 's-mid-2', 400000, { midTask: true }), null, 'counter-example: under 500k mid-task nothing is said');
  assert.match(braked(dir, 's-between', 400000).block.block, /holds ~400k tokens/, 'between tasks it holds the message, as before');
});
test('2g: CSS/HTML — a task that closed parcial no longer switches the brake off', () => {
  const dir = tmpRepo();
  P.appendRecord(dir, { id: '2026-10-25 · T1', agent: 'claude', at: at(), session: 's-parcial', cwd: dir, files: ['src/app.css'], cierre: '## Cierre · 2026-10-25 · T1\nResultado: parcial (falta el ancho)\nAprendido: x ← y', outcome: { result: 'parcial' } });
  assert.match(braked(dir, 's-parcial', 450000).block.block, /holds ~450k tokens/, 'closed parcial = between tasks: the brake holds');
  const own = tmpRepo();
  assert.equal(braked(own, 's-free', 100000), null, 'counter-example: a small session is never braked');
});
test('2g: a prompt the brake holds starts no task and leaves no open turn', async () => {
  const dir = tmpRepo(), file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, [prompt('hola'), { type: 'assistant', timestamp: at(), message: { model: 'm', usage: { input_tokens: 400000 }, content: [{ type: 'text', text: 'Waymark → Q · dept-qa' }] } }].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = await hookRun('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'ahora cambia el color', cwd: dir, session_id: 's-held', transcript_path: file }, { WAYMARK_BRAKE_TOKENS: '300000' });
  assert.match(r.out, /"decision":"block"/, 'the prompt was held');
  assert.ok(!fs.existsSync(path.join(dir, '.waymark', 'open.json')), 'no open turn for a prompt the model never saw');
  assert.equal(P.taskStartMark('s-held'), 0, 'no task start either');
});

// ---- 2g · a courtesy or a memory-only turn is no task ----
const turnOf = (promptText, ...tools) => currentTurn([prompt(promptText), say('Waymark → L1 · dept-devex'), ...tools.flat()]);
const outside = (t) => cierreGaps(t, CIERRE, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [], outside: true });
test('2g: logic — a thanks, or a turn that only wrote memory, leaves no record; one that ran a command that acts still does', () => {
  assert.equal(outside(turnOf('gracias, quedó bien', call('Write', { file_path: '/home/u/.claude/projects/p/memory/note.md' }))), null, 'a courtesy');
  assert.equal(outside(turnOf('guarda esto en memoria', call('Write', { file_path: '/home/u/.claude/projects/p/memory/note.md' }), call('Bash', { command: 'node /s/waymark.mjs memory conventions' }))), null, 'memory only, with the routine\'s own command');
  assert.ok(outside(turnOf('sube el cambio', call('Bash', { command: 'git push origin develop' }))), 'counter-example: a push is work outside the project');
});
test('2g: CSS/HTML — the same for a styles ask: a thanks after it is nothing; the stylesheet edit itself is a task', () => {
  assert.equal(outside(turnOf('perfecto, gracias', call('Read', { file_path: '/work/proj/src/app.css' }))), null);
  const lines = [prompt('ajusta el margen'), say('Waymark → L1 · dept-frontend'), ...call('Edit', { file_path: '/work/proj/src/app.css' })];
  assert.ok(cierreGaps(currentTurn(lines), CIERRE, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [] }), 'counter-example: a changed file is work');
});

// ---- 2h · "apply the findings" is the user's own decision ----
for (const [kind, text] of [['logic', 'aplica los hallazgos del review en el servicio'], ['CSS/HTML', 'corrige los hallazgos del review de estilos']]) {
  test(`2h: ${kind} — "${text}" counts as the decision, recorded as the user's words; asking about the findings does not`, () => {
    const lines = [prompt(text), say('Waymark → L2 · dept-backend')];
    assert.equal(P.askedChoice(lines), true);
    const d = P.decisionsIn(lines);
    assert.equal(d.length, 1);
    assert.equal(d[0].source, 'prompt');
    assert.match(d[0].chosen, /hallazgos/);
    assert.equal(P.askedChoice([prompt('revisa los hallazgos del review y dime cuáles aplican'), say('Waymark → Q · dept-qa')]), false, 'counter-example: reading them is a question, not an order');
    assert.equal(P.askedChoice([prompt('agrega un filtro por fecha'), say('Waymark → L2 · dept-backend')]), false, 'counter-example: any other ask still goes through the window');
  });
}
test('2h: a batch that only applies the findings is asked for one delta review, not a whole round', () => {
  const FILE = '/work/proj/src/orders.service.mjs';
  const lines = [prompt('aplica los hallazgos del review'), say('Waymark → L2 · dept-backend'), ...call('Skill', { skill: 'dept-backend' }), ...call('Read', { file_path: '/skills/dept-backend/procedures.md' }), ...call('Bash', { command: 'node "/s/waymark/scripts/waymark.mjs" pack src/orders.service.mjs' }), ...call('Edit', { file_path: FILE })];
  const g = cierreGaps(currentTurn(lines), CIERRE, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: P.decisionsIn(lines), cwd: '/work/proj' });
  const review = g.steps.find((s) => s.id === 'review');
  assert.equal(review.pass, false);
  assert.match(review.why[0], /one delta review of only the files this batch changed/);
  const plain = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), ...call('AskUserQuestion', { questions: [] }), ...call('Edit', { file_path: FILE })];
  const g2 = cierreGaps(currentTurn(plain), CIERRE, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj' });
  assert.ok(!/delta review/.test(g2.steps.find((s) => s.id === 'review').why.join(' ')), 'counter-example: an ordinary task is asked for its review as before');
});

test('2h: an order that adds more work than the fix still goes through the window', () => {
  for (const text of ['aplica los hallazgos del review y además migra la tabla de pedidos', 'fix the findings and also rename the service', `aplica los hallazgos ${'x'.repeat(200)}`]) {
    assert.equal(P.askedChoice([prompt(text), say('Waymark → L2 · dept-backend')]), false, text.slice(0, 50));
  }
  assert.equal(P.askedChoice([prompt('aplica los hallazgos del review'), say('Waymark → L2')]), true, 'counter-example: the plain order is the decision');
});

// ---- M3 · the size counts what a command changed and the time worked, and a courtesy that acts is work ----
test('2g: logic — files a command changes (sed -i) count toward the cap, as Edit does', () => {
  const dir = tmpRepo();
  fs.mkdirSync(path.join(dir, 'src'));
  for (let i = 0; i < 15; i++) fs.writeFileSync(path.join(dir, 'src', `s${i}.ts`), 'a');
  const size = (cmd) => softCapLine({ session_id: `s-sh-${++n}`, cwd: dir }, { read: () => [...edits(30, 'ts', at(-5000)), ...Array.from({ length: 15 }, (_, i) => call('Bash', { command: `${cmd} src/s${i}.ts` }, at(-5000))).flat()] }, dir, Date.now() - 5 * 60000, Date.now(), path.join(dir, `cap-${n}.json`));
  assert.match(size("sed -i 's/a/b/'"), /45 changed files/);
  assert.equal(size('cat'), '', 'counter-example: a command that only reads changes nothing');
});
test('2g: logic — the minutes are the time worked: a pause longer than 15 minutes is not counted', () => {
  const mark = Date.now() - 75 * 60000;
  const [idle] = cap([...call('Bash', { command: 'git status' }, at(-75 * 60000)), ...call('Bash', { command: 'git status' }, at(-3 * 60000))], mark);
  assert.equal(idle, '', 'one call, a 72-minute pause, one call: a few minutes worked');
  const steady = Array.from({ length: 16 }, (_, i) => call('Bash', { command: 'git status' }, at(-(75 - i * 5) * 60000))).flat();
  assert.match(cap(steady, mark)[0], /this task has run 7\d min/, 'counter-example: steady work past the hour is told');
});
test('2g: CSS/HTML — at the close of a long autonomous turn the user is told in their words, once', () => {
  const dir = tmpRepo(), state = path.join(dir, 'cap.json');
  const hook = { session_id: `s-cap-close-${++n}`, cwd: dir }, agent = { read: () => edits(45, 'css', at(-5000)) };
  const mark = Date.now() - 5 * 60000;
  assert.match(softCapLine(hook, agent, dir, mark, Date.now(), state, null, { user: true }), /tarea grande: 5 min, 45 llamadas y 45 archivos cambiados/);
  assert.equal(softCapLine(hook, agent, dir, mark, Date.now(), state, null, { user: true }), '', 'once');
});
test('2g: a courtesy that acts is work: "ok sube el cambio" with a push, "listo, despliega" with a deploy, leave a record; a thanks alone does not', () => {
  assert.ok(outside(turnOf('ok sube el cambio', call('Bash', { command: 'git push origin develop' }))));
  assert.ok(outside(turnOf('listo, ahora despliega a producción', call('Bash', { command: 'firebase deploy --only hosting' }))));
  assert.ok(outside(turnOf('vale, sube los estilos', call('Bash', { command: 'git push' }))), 'CSS/HTML: the push of a styles change');
  assert.equal(outside(turnOf('ok gracias', call('Read', { file_path: '/work/proj/src/app.css' }))), null, 'counter-example: a thanks that only reads');
});
