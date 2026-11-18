// Waymark 2.0.21 · failures 7, 9 and 10 of docs/plans/2.0.21.md, read from three weeks of real use of 2.0.20. Every case is a synthetic copy of a pattern seen
// there (ADR 0042): no project name, path, prompt or code of a real project. Run: node --test tests/real-use-2021.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-ru21-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);
const Eyes = await import(`file://${SCRIPTS}/eyes.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ru21-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  gitT(d, 'add', '-A'); gitT(d, 'commit', '-q', '-m', 'base');
  return d;
};
const hookRun = (script, payload, { wait = 60000 } = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, wait);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  c.stdin.end(JSON.stringify(payload));
});

let ids = 0;
const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input, out = 'ok', error = false) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }]; };
const notice = (taskId, toolUseId, file, summary = 'Background command "build" completed (exit code 0)', status = 'completed') => ({ type: 'user', timestamp: at(), message: { role: 'user', content: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<output-file>${file}</output-file>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>` } });
const CIERRE = '## Cierre · 2026-11-18 · T1\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y';
const blocked = (r) => /"decision":"block"/.test(r.out);
const recordsOf = (dir) => P.readRecords(P.projectHome(dir).log);

// ---- failure 7: a task whose turn was deferred for a background run is judged whole when it closes, even if what follows is a short reply ----
test('7: the turn deferred for a background agent keeps its start: the reply that follows the notification is not a question, the task is judged and blocked for its Cierre', async () => {
  const FILE = 'src/orders.service.mjs', dir = tmpRepo({ [FILE]: 'x\n' }), transcript = path.join(dir, 'defer.jsonl'), session = 'defer-then-reply';
  fs.writeFileSync(path.join(dir, FILE), 'y\n');
  const bg = call('Agent', { run_in_background: true });
  bg[1] = { type: 'user', timestamp: at(), toolUseResult: { isAsync: true, agentId: 'bg1' }, message: { content: [{ type: 'tool_result', tool_use_id: bg[0].message.content[0].id, content: 'launched' }] } };
  const first = [prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend'), ...call('Edit', { file_path: path.join(dir, FILE) }), ...bg, say('Espero la revisión.')];
  fs.writeFileSync(transcript, first.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const waiting = await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: 'Espero la revisión.', stop_hook_active: false });
  assert.match(waiting.out, /se evaluará cuando termine la tarea en segundo plano/, 'the first turn is deferred');
  assert.ok(recordsOf(dir).some((r) => r.kind === 'unevaluated' && r.files?.length), 'and the deferral keeps the files');
  const later = [...first, notice('bg1', bg[0].message.content[0].id, '/tmp/none.output', 'Agent "review" finished'), say('Listo.')];
  fs.writeFileSync(transcript, later.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const closing = await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: 'Listo.', stop_hook_active: false });
  assert.ok(blocked(closing), 'the files of the deferred turn are judged: a reply with no Cierre is blocked, not read as a question: ' + closing.out.slice(0, 300));
  const done = [...later, say(CIERRE)];
  fs.writeFileSync(transcript, done.map((l) => JSON.stringify(l)).join('\n') + '\n');
  await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: CIERRE, stop_hook_active: true });
  assert.ok(recordsOf(dir).some((r) => r.id && r.files?.some((f) => /orders\.service/.test(f))), 'the task is recorded with the files of the deferred turn');
});

test('7: counter-example — a crash record (not a deferral) still moves the start of the next turn', () => {
  const { sessionStart } = T;
  assert.equal(typeof sessionStart, 'function', 'the rule lives in one function the hook and the tests share');
  const records = [{ session: 's', id: '2026-11-18 · T1', at: '2026-11-18T09:00:00.000Z' }, { session: 's', kind: 'unevaluated', cause: 'unevaluated:deferred: a background task is still running', at: '2026-11-18T10:00:00.000Z' }, { session: 's', kind: 'unevaluated', cause: 'unevaluated:boom', at: '2026-11-18T10:05:00.000Z' }];
  assert.equal(sessionStart(records, 's'), Date.parse('2026-11-18T10:05:00.000Z'), 'the crash is the last record that counts');
  assert.equal(sessionStart(records.slice(0, 2), 's'), Date.parse('2026-11-18T09:00:00.000Z'), 'a deferral alone is skipped: the close before it is the start');
  assert.equal(sessionStart(records.slice(0, 2), 'other'), 0, 'another session has no start');
});

// ---- failure 9: the eyes are due when the user asked for them, or sent a screenshot or a design link ----
const L2_UI = (promptText) => [prompt(promptText), say('Waymark → L2 · dept-frontend'), ...call('Skill', { skill: 'dept-frontend' }), ...['/work/proj/src/app/shared/button/button.component.css', '/work/proj/src/app/shared/button/button.component.html'].flatMap((f) => call('Edit', { file_path: f })), ...call('Bash', { command: 'pnpm exec tsc --noEmit' })];
const judge = (lines, ctx = {}, reply = CIERRE) => cierreGaps(T.currentTurn(lines), reply, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj', procDelivered: ['dept-frontend'], eyes: { provider: 'ego' }, ...ctx });
const eyesOf = (g) => g.steps.find((s) => s.id === 'eyes');

test('9: asksEyes reads the words that ask for the screen, and only those', () => {
  for (const text of ['míralo con ego-browser', 'revisa con ego', 'compruébalo en el navegador', 'abre el browser y mide el padding', 'verifica visualmente que no se corte', 'mira cómo se ve en pantalla', 'usa los ojos para validar']) assert.equal(Eyes.asksEyes([text]), true, text);
  for (const text of ['agrega reintentos al servicio', 'corrige el typo del título', 'cambia el color del botón a azul', 'valida el formulario en el servidor']) assert.equal(Eyes.asksEyes([text]), false, text);
  assert.equal(Eyes.asksEyes(['agrega reintentos', 'ahora míralo en el navegador']), true, 'any prompt of the task asks');
  assert.equal(Eyes.asksEyes([]), false);
});

test('9: a UI task nobody asked to look at owes no eyes, no reference answer and shows no Ojos in the close', () => {
  const g = judge(L2_UI('ajusta el padding del botón'));
  assert.equal(eyesOf(g).applies, false, 'the testigo does not apply');
  assert.ok(!g.missing.some((m) => /browser|ego|references?/i.test(m)), 'nothing about the screen is blocked: ' + JSON.stringify(g.missing));
  assert.ok(!(g.omitted && 'Ojos' in g.omitted), 'and it is not recorded as omitted either: it never applied');
});

test('9: the same task owes the eyes when the request asks for them, carries a screenshot or a design link', () => {
  const asked = judge(L2_UI('ajusta el padding del botón y verifícalo con ego'));
  assert.equal(eyesOf(asked).applies, true, 'asked with words');
  assert.equal(eyesOf(asked).pass, false, 'and nobody looked');
  assert.ok(asked.missing.some((m) => /browser|ego/i.test(m)), 'the block names the way');
  const shot = judge(L2_UI('ajusta el padding del botón'), { requests: { images: 1, hosts: [] } });
  assert.equal(eyesOf(shot).applies, true, 'a screenshot in the request');
  const link = judge(L2_UI('ajusta el padding del botón'), { requests: { images: 0, hosts: ['www.figma.com'] } });
  assert.equal(eyesOf(link).applies, true, 'a design link in the request');
});

test('9: an L1 of styles only follows the same rule', () => {
  const css = [prompt('sube el padding'), say('Waymark → L1 · dept-frontend'), ...call('Skill', { skill: 'dept-frontend' }), ...call('Edit', { file_path: '/work/proj/src/app/shared/button/button.component.css' })];
  assert.equal(Eyes.eyesDue({ provider: 'ego', ui: true, level: 1, changed: ['/work/proj/a.css'], asked: false }), false);
  assert.equal(Eyes.eyesDue({ provider: 'ego', ui: true, level: 1, changed: ['/work/proj/a.css'], asked: true }), true);
  assert.equal(eyesOf(judge(css)).applies, false, 'no ask: no eyes');
});

// ---- failure 10: a build the shell ran in the background counts from its notification and the file it names, not only from a read the agent was told not to make ----
const BUILD_FILE = '/work/proj/src/orders.service.mjs';
const L2_EDIT = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), ...call('Skill', { skill: 'dept-backend' }), ...call('AskUserQuestion', { questions: [] }), ...call('Edit', { file_path: BUILD_FILE })];
const buildOwed = (g) => g.missing.some((m) => /run the build once/.test(m));
const writeOut = (text) => { const f = path.join(home, `bg-${++ids}.output`); fs.writeFileSync(f, text); return f; };
const launchOf = (id = 'bgb1') => { const c = call('Bash', { command: 'cd /work/proj && pnpm run build 2>&1 | tail -15', run_in_background: true }, `Command running in background with ID: ${id}. Output is being written to: C:\\Temp\\x\\${id}.output. You will be notified when it completes — do not poll that file or sleep while waiting.`); return { calls: c, useId: c[0].message.content[0].id, id }; };
const withNotice = (text, { summary, status, id = 'bgb1' } = {}) => {
  const l = launchOf(id), f = writeOut(text);
  const lines = [...L2_EDIT, ...l.calls, notice(id, l.useId, f, summary, status)];
  return { lines, notifications: T.taskNotifications(lines) };
};
const judgeBg = ({ lines, notifications }) => cierreGaps(T.currentTurn(lines), CIERRE, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1, notifications });

test('10: taskNotifications reads the id, the tool call, the status, the exit code and the output file of each notice', () => {
  const [n] = T.taskNotifications([notice('bgx', 'toolu_9', '/tmp/o.output', 'Background command "b" completed (exit code 2)')]);
  assert.deepEqual({ taskId: n.taskId, toolUseId: n.toolUseId, status: n.status, exit: n.exit, file: n.file }, { taskId: 'bgx', toolUseId: 'toolu_9', status: 'completed', exit: 2, file: '/tmp/o.output' });
  assert.deepEqual(T.taskNotifications([prompt('hola'), say('x')]), []);
});

test('10: a background build that the notification says completed and whose output shows success is the build', () => {
  assert.equal(buildOwed(judgeBg(withNotice('Application bundle generation complete. [4.2 seconds]'))), false, 'an Angular build');
  assert.equal(buildOwed(judgeBg(withNotice(''))), false, 'a build that prints nothing and exits 0 (nest build)');
});

test('10: counter-examples — a failure in the output, a failed status, no notice and a notice for another command do not count', () => {
  assert.equal(buildOwed(judgeBg(withNotice('error TS2322: Type string is not assignable to type number'))), true, 'a failure under `| tail`, whose exit is 0');
  assert.equal(buildOwed(judgeBg(withNotice('ok', { status: 'failed', summary: 'Background command "b" failed (exit code 1)' }))), true, 'the status says failed');
  const l = launchOf();
  assert.equal(buildOwed(judgeBg({ lines: [...L2_EDIT, ...l.calls], notifications: [] })), true, 'a launch nobody saw finish');
  const other = [...L2_EDIT, ...l.calls, notice('zzz', 'toolu_other', writeOut('Application bundle generation complete'))];
  assert.equal(buildOwed(judgeBg({ lines: other, notifications: T.taskNotifications(other) })), true, 'the notice of another task');
});

test('10: a notice whose output file is gone credits nothing and breaks nothing', () => {
  const l = launchOf('bgb3'), lines = [...L2_EDIT, ...l.calls, notice('bgb3', l.useId, path.join(home, 'removed.output'))];
  assert.equal(buildOwed(judgeBg({ lines, notifications: T.taskNotifications(lines) })), true, 'the build stays owed, as before the notice was read');
});

test('9: the omitted-eyes line is for a task that owed the look: no browser and nobody asked leaves no Ojos in the record', () => {
  const none = judge(L2_UI('ajusta el padding del botón'), { eyes: { provider: null } });
  assert.ok(!(none.omitted && 'Ojos' in none.omitted), 'never owed: not omitted');
  const asked = judge(L2_UI('ajusta el padding del botón y míralo en el navegador'), { eyes: { provider: null } });
  assert.ok(asked.omitted && 'Ojos' in asked.omitted, 'asked and no browser to look with: omitted, with its reason');
});

test('10: a code change after the build that the notice credits is still owed a build', () => {
  const l = launchOf('bgb2'), f = writeOut('Application bundle generation complete');
  const lines = [...L2_EDIT, ...l.calls, notice('bgb2', l.useId, f), ...call('Edit', { file_path: BUILD_FILE })];
  assert.equal(buildOwed(judgeBg({ lines, notifications: T.taskNotifications(lines) })), true);
});

// ---- failure 14: a reply that waits for something and does not claim to be finished is a pause, not an end ----
const { pausedReply, earlierWords } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
test('14: a reply that names a wait (the user\'s step, a restart, a notice) and has no Cierre pauses the task', () => {
  for (const text of [
    'Lancé el spec en segundo plano. Avísame cuando lo reinicies y cierro la tarea.',
    'La corrida del spec sigue en segundo plano. Espero su aviso antes de tocar `planner.ts`, para que el spec corra primero sobre el código viejo.',
    'Cuando termine, escribo `withContactIdentity` en el mapper y lo uso en el selector.',
    'Reinicia el API y te aviso cuando lo vea funcionando.',
    'Queda esperando tu prueba en Slack con la URL pública.',
    'Cambié el servicio y el spec.\n\nDime cuando confirmes el estado de la franja.',
  ]) assert.equal(pausedReply(text), true, text);
});

test('14: counter-examples — a finished claim, a Cierre, no wait, or a wait only in an earlier paragraph is no pause', () => {
  for (const text of [
    'Terminé el cambio. Avísame cuando lo reinicies.',
    'Listo, la tarea quedó cerrada; espero tu revisión.',
    '## Cierre · 2026-11-18 · T4\nResultado: hecho\nEvidencia: observada ok\nAprendido: x ← y\nAvísame cuando lo reinicies.',
    'Cambié el servicio y corrí el spec: 12 pasan.',
    'Espero que esto aclare la duda: el hook cuenta desde el prompt.',
    'Avísame cuando lo reinicies.\n\nAquí va el resumen de lo que cambió en el mapper, el servicio y los dos specs que lo cubren, sin nada pendiente por hacer.',
    '',
  ]) assert.equal(pausedReply(text), false, text);
});

// ---- failure 16: a skip the user quoted counts when their words come from an earlier prompt of the session or from a rule they wrote ----
const REVIEW_SKIP = `${CIERRE}\nReview: omitido (usuario: "el code-review se hará en general") — esta tarea solamente`;
const judgeSkip = (reply, ctx = {}) => cierreGaps(T.currentTurn(L2_EDIT), reply, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1, ...ctx });
const reviewOwed = (g) => g.missing.some((m) => /no review ran/.test(m));
test('16: a review skip quoted from an earlier prompt of the session or from a written rule is accepted, and the record says where it came from', () => {
  assert.equal(reviewOwed(judgeSkip(REVIEW_SKIP)), true, 'before: the words are in no source, the review is owed');
  const earlier = judgeSkip(REVIEW_SKIP, { userWords: [{ text: 'ok el code-review se hará en general al final', from: 'an earlier prompt of the session' }] });
  assert.equal(reviewOwed(earlier), false, 'an earlier prompt of the session');
  assert.ok(earlier.findings.some((f) => /earlier prompt of the session/.test(f) && /preferences\.md/.test(f)), 'and the finding offers writing it in preferences.md: ' + JSON.stringify(earlier.findings));
  const rule = judgeSkip(REVIEW_SKIP, { userWords: [{ text: 'El code-review se hará en general, no por tarea.', from: 'preferences.md' }] });
  assert.equal(reviewOwed(rule), false, 'a rule in preferences.md');
  assert.ok(!rule.findings.some((f) => /write it in preferences\.md/.test(f)), 'already written: nothing to offer');
});

test('16: counter-examples — words that are in no source, or too short, still fail; earlierWords reads only this session\'s earlier prompts', () => {
  assert.equal(reviewOwed(judgeSkip(REVIEW_SKIP, { userWords: [{ text: 'haz el servicio de reintentos', from: 'preferences.md' }] })), true, 'other words');
  assert.equal(reviewOwed(judgeSkip(`${CIERRE}\nReview: omitido (usuario: "no")`, { userWords: [{ text: 'no', from: 'preferences.md' }] })), true, 'too short');
  const records = [{ session: 's1', prompt: 'primer pedido', prompts: ['y su corrección'] }, { session: 's2', prompt: 'otra sesión' }, { session: 's1', kind: 'unevaluated', prompt: 'turno diferido' }];
  assert.deepEqual(earlierWords(records, 's1'), ['primer pedido', 'y su corrección', 'turno diferido']);
  assert.deepEqual(earlierWords(records, 'none'), []);
});

// ---- failure 15: a spec written after the code cannot be seen red in the tree: recorded, not blocked; a spec written first must still run before the code ----
const SPEC_FILE = '/work/proj/src/orders.service.spec.mjs';
const NEW_SPEC = call('Write', { file_path: SPEC_FILE, content: "import test from 'node:test';\ntest('retries', () => {});\n" });
const HEAD_L2 = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), ...call('Skill', { skill: 'dept-backend' }), ...call('AskUserQuestion', { questions: [] })];
const RUN_GREEN = () => call('Bash', { command: 'pnpm exec vitest run src/orders.service.spec.mjs' }, 'Tests 1 passed (1)');
const RUN_RED = () => call('Bash', { command: 'pnpm exec vitest run src/orders.service.spec.mjs' }, 'FAIL  retries\nAssertionError: expected 1 to be 3\nTests 1 failed (1)', true);
const redOwed = (g) => g.missing.some((m) => /never ran before the code it tests/.test(m));
const judgeTests = (lines) => cierreGaps(T.currentTurn(lines), CIERRE, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1 });
test('15: a spec written after the code that passes is recorded as "after the code", never blocked for a clean copy', () => {
  const g = judgeTests([...HEAD_L2, ...call('Edit', { file_path: BUILD_FILE }), ...NEW_SPEC, ...RUN_GREEN()]);
  assert.equal(redOwed(g), false, 'no clean copy is asked: ' + JSON.stringify(g.missing));
  assert.ok(g.findings.some((f) => /written after the code/.test(f) && /orders\.service\.spec/.test(f)), 'recorded: ' + JSON.stringify(g.findings));
});

test('15: counter-examples — a spec written first that never ran before the code is still owed; one that ran before it, or ran red after the code, is not', () => {
  assert.equal(redOwed(judgeTests([...HEAD_L2, ...NEW_SPEC, ...call('Edit', { file_path: BUILD_FILE }), ...RUN_GREEN()])), true, 'spec first, no run before the code');
  assert.equal(redOwed(judgeTests([...HEAD_L2, ...NEW_SPEC, ...RUN_RED(), ...call('Edit', { file_path: BUILD_FILE }), ...RUN_GREEN()])), false, 'spec first, ran red before the code');
  const afterRed = judgeTests([...HEAD_L2, ...call('Edit', { file_path: BUILD_FILE }), ...NEW_SPEC, ...RUN_RED(), ...RUN_GREEN()]);
  assert.equal(redOwed(afterRed), false, 'code first, it ran red once: fine');
  assert.ok(!afterRed.findings.some((f) => /written after the code/.test(f)), 'and nothing to record: a red run happened');
});

// ---- review of failures 14 to 16 (2026-11-18) ----
test('14 (review): more waits pause; a finished reply that ends "avísame cuando quieras" does not', () => {
  for (const text of ['Falta que reinicies el API para seguir.', 'Queda pendiente tu prueba en Slack.', 'Avísame cuando esté listo el API y sigo con el spec.']) assert.equal(pausedReply(text), true, text);
  for (const text of ['Cambios hechos. Avísame cuando quieras que siga.', 'Aplicado el cambio en el mapper. Avísame cuando lo veas.', 'Listo. Avísame cuando quieras.']) assert.equal(pausedReply(text), false, text);
});

test('15 (review): a spec written after the code and never run is still blocked by the testigo of the spec that changed after the last run', () => {
  const g = judgeTests([...HEAD_L2, ...call('Edit', { file_path: BUILD_FILE }), ...NEW_SPEC]);
  assert.equal(redOwed(g), false, 'no clean copy');
  assert.ok(g.missing.some((m) => /spec changed after the last test run|no test ran|a spec changed/.test(m)), 'but the run is owed: ' + JSON.stringify(g.missing));
});

// ---- failure 18: what Codex really does (10 sessions, 33 tasks of real use) ----
const { shellRuns } = await import(`file://${SCRIPTS}/runs.mjs`);
const Codex = await import(`file://${SCRIPTS}/agents/codex.mjs`);
test('18: Codex runs tests and the linter through node, and the hook sees them: vitest, jest, mocha and eslint by their package path', () => {
  const kind = (command) => { const r = shellRuns(command).find((p) => p.test || p.gate || p.build) || {}; return r.test ? 'test' : r.gate ? 'gate' : 'none'; };
  for (const command of ['node node_modules/vitest/vitest.mjs run src/a.spec.ts', 'node node_modules/vitest/vitest.mjs run src/a.spec.ts --reporter=dot','node ./node_modules/vitest/vitest.mjs related src/a.ts --run', 'node ./node_modules/jest/bin/jest.js src/a', 'node node_modules/mocha/bin/mocha.js test/a.js']) assert.equal(kind(command), 'test', command);
  for (const command of ['node node_modules/eslint/bin/eslint.js src', 'node node_modules/eslint/bin/eslint.js "src/**/*.ts"']) assert.equal(kind(command), 'gate', command);
  assert.equal(kind('node scripts/vitest.js'), 'none', 'counter-example: a project script that only has the name is not the CLI');
  assert.equal(kind('node scripts/eslint-report.mjs'), 'none', 'counter-example: another script');
});

const codexRows = (reply) => [
  { type: 'event_msg', timestamp: '2026-11-18T10:00:00Z', payload: { type: 'item_completed', turn_id: 't1', item: { type: 'UserMessage', id: 'u1', content: [{ type: 'text', text: 'agrega reintentos al servicio' }] } } },
  { type: 'response_item', timestamp: '2026-11-18T10:00:05Z', payload: { type: 'function_call', name: 'request_user_input_async', call_id: 'c1', arguments: JSON.stringify({ questions: [{ title: '¿Cómo reintento?', options: ['Backoff (Recomendado)', 'Cola'] }] }) } },
  { type: 'response_item', timestamp: '2026-11-18T10:00:06Z', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ accepted: true }) } },
  { type: 'event_msg', timestamp: '2026-11-18T10:01:00Z', payload: { type: 'item_completed', turn_id: 't2', item: { type: 'UserMessage', id: 'u2', content: [{ type: 'text', text: reply }] } } },
];
const ENVELOPE = (answer) => `<send_user_message_question_reply>\n${JSON.stringify([{ answer, question: '¿Cómo reintento?', questionItemId: '["request_user_input_async","c1",0]' }])}\n</send_user_message_question_reply>`;
test('18: the reply to a request_user_input_async window is the answer, not a new prompt: the task goes on and the window counts', () => {
  const lines = Codex.toLines(codexRows(ENVELOPE('Backoff (Recomendado)')));
  assert.equal(lines.filter(T.isPrompt).length, 1, 'only the real request is a prompt: ' + lines.filter(T.isPrompt).map((l) => T.promptText(l).slice(0, 40)).join(' | '));
  const answered = lines.find((l) => l.toolUseResult?.answers);
  assert.ok(answered, 'the window is answered in the lines the hook reads');
  assert.match(JSON.stringify(answered.toolUseResult.answers), /Backoff/, 'with the user\'s answer');
});

test('18: a free-text answer in the envelope is the answer too, and a message that only looks like one is still a prompt', () => {
  const free = Codex.toLines(codexRows(ENVELOPE('mejor dejemos el servicio como está')));
  assert.equal(free.filter(T.isPrompt).length, 1);
  assert.match(JSON.stringify(free.find((l) => l.toolUseResult?.answers).toolUseResult.answers), /dejemos el servicio como está/);
  const plainReply = Codex.toLines(codexRows('Backoff (Recomendado)'));
  assert.equal(plainReply.filter(T.isPrompt).length, 2, 'counter-example: a reply typed in the chat stays a prompt, as before');
});

test('18: the Codex note gives the exact arguments of the window, since a third of the real calls were refused for a field that does not exist', () => {
  const note = Codex.note('C:/skills');
  assert.match(note, /"title"/);
  assert.match(note, /"options"/);
  assert.match(note, /no other field/);
});

// ---- review of failure 18 (2026-11-18) ----
test('18 (review): a skip quoted from the words of a free-text answer to a window counts; words that are in no answer still fail', () => {
  const REVIEW = `${CIERRE}\nReview: omitido (usuario: "sin code-review en esta tarea") — esta tarea solamente`;
  const decided = (chosen) => ({ decisions: [{ question: '¿Cómo?', chosen, discarded: [] }] });
  assert.equal(reviewOwed(judgeSkip(REVIEW, decided('mejor sin code-review en esta tarea, gracias'))), false, 'the words are inside the answer');
  assert.equal(reviewOwed(judgeSkip(REVIEW, decided('Backoff'))), true, 'counter-example: the answer does not hold them');
});

test('18 (review): two questions of one window are answered by their own item, even when the reply lists them crossed', () => {
  const rows = codexRows(ENVELOPE('x'));
  rows[1].payload.arguments = JSON.stringify({ questions: [{ title: 'Primera', options: ['A1', 'A2'] }, { title: 'Segunda', options: ['B1', 'B2'] }] });
  rows[3].payload.item.content[0].text = `<send_user_message_question_reply>\n${JSON.stringify([{ answer: 'B2', question: 'Segunda', questionItemId: '["request_user_input_async","c1",1]' }, { answer: 'A1', question: 'Primera', questionItemId: '["request_user_input_async","c1",0]' }])}\n</send_user_message_question_reply>`;
  const answers = Codex.toLines(rows).find((l) => l.toolUseResult?.answers).toolUseResult.answers;
  assert.equal(answers['Primera'], 'A1');
  assert.equal(answers['Segunda'], 'B2');
});

// ---- failure 7b: a deferred turn with files keeps the task open: the prompts that follow it, with no notice, belong to the same stretch until it closes ----
const { unclosedDeferral } = T;
test('7b: unclosedDeferral finds the deferral of this session that changed files, has no close after it and is under a day old', () => {
  const now = Date.parse('2026-11-18T12:00:00.000Z');
  const defer = (extra = {}) => ({ session: 's', kind: 'unevaluated', cause: 'unevaluated:deferred: a background task is still running', at: '2026-11-18T10:00:00.000Z', files: ['a.mjs'], ...extra });
  assert.equal(unclosedDeferral([defer()], 's', now)?.files[0], 'a.mjs');
  assert.equal(unclosedDeferral([defer(), { session: 's', id: '2026-11-18 · T1', at: '2026-11-18T11:00:00.000Z' }], 's', now), null, 'a close after it settles it');
  assert.equal(unclosedDeferral([defer({ files: [] })], 's', now), null, 'a deferral that changed nothing holds nothing');
  assert.equal(unclosedDeferral([defer({ at: '2026-11-17T10:00:00.000Z' })], 's', now), null, 'over a day old: abandoned');
  assert.equal(unclosedDeferral([defer()], 'other', now), null, 'another session');
  assert.equal(unclosedDeferral([defer({ cause: 'unevaluated:boom' })], 's', now), null, 'a crash is not a deferral');
});

test('7b: a question asked while a deferred turn is open does not end the task: the stretch is judged and its Cierre asked', async () => {
  const FILE = 'src/orders.service.mjs', dir = tmpRepo({ [FILE]: 'x\n' }), transcript = path.join(dir, 'defer7b.jsonl'), session = 'defer-then-question';
  fs.writeFileSync(path.join(dir, FILE), 'y\n');
  // the agent launched 40 minutes ago and its notice never came (the real case: the session was closed meanwhile): it is no longer waited for, the deferral stays
  const old = (ms) => new Date(Date.now() - 40 * 60000 + ms).toISOString();
  const bg = call('Agent', { run_in_background: true });
  bg[0].timestamp = old(2000);
  bg[1] = { type: 'user', timestamp: old(3000), toolUseResult: { isAsync: true, agentId: 'bg7' }, message: { content: [{ type: 'tool_result', tool_use_id: bg[0].message.content[0].id, content: 'launched' }] } };
  const stamp = (l, ms) => ({ ...l, timestamp: old(ms) });
  const first = [stamp(prompt('ajusta el servicio'), 0), stamp(say('Waymark → L2 · dept-backend'), 500), ...call('Edit', { file_path: path.join(dir, FILE) }).map((l) => stamp(l, 1000)), ...bg, stamp(say('Espero la revisión.'), 4000)];
  const write = (lines) => fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  P.appendRecord(dir, { kind: 'unevaluated', cause: 'unevaluated:deferred: a background task is still running', agent: 'claude', at: old(5000), session, cwd: dir, prompt: 'ajusta el servicio', files: [path.join(dir, FILE)] });
  const asked = [...first, prompt('una duda: ¿qué hace el servicio?'), say('Waymark → Q · dept-backend'), say('El servicio reintenta tres veces.')];
  write(asked);
  const answer = await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: 'El servicio reintenta tres veces.', stop_hook_active: false });
  assert.ok(blocked(answer), 'the work of the first ask is judged, not recorded as a question: ' + answer.out.slice(0, 300));
  assert.ok(!recordsOf(dir).some((r) => r.kind === 'Q'), 'no question record closes the stretch');
  const closed = [...asked, say(CIERRE)];
  write(closed);
  await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: CIERRE, stop_hook_active: true });
  assert.ok(recordsOf(dir).some((r) => r.id && r.files?.some((f) => /orders\.service/.test(f))), 'the task is recorded with the files of the deferred turn');
});

test('7b: counter-example — with no deferral open, a question is still a question', async () => {
  const dir = tmpRepo({ 'src/a.mjs': 'x\n' }), transcript = path.join(dir, 'plain7b.jsonl');
  fs.writeFileSync(transcript, [prompt('¿qué hace a.mjs?'), say('Waymark → Q · dept-backend'), say('Exporta una constante.')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const out = await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: 'plain-q', last_assistant_message: 'Exporta una constante.', stop_hook_active: false });
  assert.ok(!blocked(out), 'nothing to judge');
  assert.ok(recordsOf(dir).some((r) => r.kind === 'Q'));
});

// ---- failure 17: the guards read what the user wrote in memory.md (a design host, a related repository) and the .env denial points to .env.example ----
const withMemory = (dir, conventions, extra = '') => fs.writeFileSync(path.join(dir, '.waymark', 'memory.md'), `# P\n\n## Work in progress\n\n## Project map\n${extra}\n\n## Conventions specific to this project\n${conventions}\n\n## Repeated procedures\n- Docs: https://wiki.example.org/x\n`);
const claudeAgent = await import(`file://${SCRIPTS}/agents/claude.mjs`);
const ToolHook = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { reposNotNamed } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const DESIGN_HOST = 'https://claude.ai/design/p/abc-123';
const NOT_NAMED = /a repository the task's request does not name/;

test('17a: memoryHosts reads the hosts of the URLs in Conventions only, never a local host, a comment or another section', () => {
  const memory = `# P\n\n## Conventions specific to this project\n- Design link: ${DESIGN_HOST} (the user's design)\n- Local: http://localhost:4200/ and https://app.localhost:3000\n- <!-- https://hidden.example.com/x -->\n- Staging https://stg.example.com/a, https://aws.example.net\n\n## Repeated procedures\n- Docs: https://wiki.example.org/x\n`;
  assert.deepEqual(Eyes.memoryHosts(memory).sort(), ['aws.example.net', 'claude.ai', 'stg.example.com']);
  assert.deepEqual(Eyes.memoryHosts(''), []);
  assert.deepEqual(Eyes.memoryHosts('# P\n\n## Work in progress\n- https://elsewhere.example.com/\n'), []);
});

test('17a: the eyes guard lets an ego script open the design link written in Conventions, and still denies every other host', () => {
  const dir = tmpRepo(), transcript = path.join(dir, 't17a.jsonl');
  fs.writeFileSync(transcript, [prompt('ajusta el botón como en el diseño')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const run = (url, session) => ToolHook.gate({ tool_name: 'Bash', tool_input: { command: `ego-browser nodejs -e 'await page.goto("${url}")'` }, cwd: dir, session_id: session, transcript_path: transcript }, claudeAgent);
  assert.match(run(DESIGN_HOST, 's17a-none') || '', /neither the local dev server/, 'with no line in Conventions it is denied, as before');
  withMemory(dir, `- Design link: ${DESIGN_HOST} (the user's design; the eyes may open it, read only)`);
  assert.equal(run(DESIGN_HOST, 's17a-yes'), null, 'the design link of Conventions');
  assert.match(run('https://prod.example.com/', 's17a-yes') || '', /neither the local dev server/, 'counter-example: another host stays denied');
  assert.match(run('https://wiki.example.org/x', 's17a-yes') || '', /neither the local dev server/, 'counter-example: a URL of another section is no design link');
});

test('17a: the end-of-turn hook counts the design link of Conventions as a design look, not as an off host', () => {
  const lines = [prompt('ajusta el botón'), say('Waymark → L2 · dept-frontend'), ...call('Edit', { file_path: '/work/proj/src/app/button.component.css' }), ...call('Bash', { command: `ego-browser nodejs -e 'await page.goto("${DESIGN_HOST}")'` })];
  const tools = T.currentTurn(lines).tools;
  assert.equal(Eyes.observeEyes(tools, { provider: 'ego', allowed: [] }).offHost, 1);
  assert.equal(Eyes.observeEyes(tools, { provider: 'ego', allowed: Eyes.memoryHosts(`## Conventions specific to this project\n- Design link: ${DESIGN_HOST}\n`) }).design, 1);
});

test('17b: a related repository the user marked confirmed in memory.md is not denied; one marked to confirm, or not listed, still is', () => {
  const memory = '# P\n\n## Identity\n- Related projects: chat-api (../chat-api) (confirmed 2026-11-18 by the user), billing (../billing) (to confirm), legacy-web (confirmed 2026-11-19)\n- Stack: x\n';
  assert.deepEqual(ToolHook.confirmedRepos(memory).sort(), ['chat-api', 'legacy-web']);
  assert.deepEqual(ToolHook.confirmedRepos('- Related projects: a (to confirm), b (../b)'), [], 'only the user writes the confirmation');
  assert.deepEqual(ToolHook.confirmedRepos(''), []);
  const state = path.join(home, 'repo-gate-17b.json'), lines = [prompt('ajusta la pantalla')], confirmed = ToolHook.confirmedRepos(memory);
  assert.equal(ToolHook.checkRepo('/work/chat-api', '/work/chat', lines, 's17b1', state, confirmed), null, 'confirmed: no denial');
  assert.ok(ToolHook.checkRepo('/work/billing', '/work/chat', lines, 's17b2', state, confirmed), 'counter-example: marked (to confirm) is denied');
  assert.ok(ToolHook.checkRepo('/work/chat-api-v2', '/work/chat', lines, 's17b3', state, confirmed), 'counter-example: a longer name is not the confirmed one');
});

test('17b: the gate reads the confirmation from the project memory: an edit in the confirmed repository passes the repository guard', () => {
  const own = tmpRepo(), other = fs.mkdtempSync(path.join(SCRIPTS, '..', '..', '..', '.wm-ru21-17b-')), transcript = path.join(own, 't17b.jsonl');
  temps.push(other); gitT(other, 'init', '-q'); fs.mkdirSync(path.join(other, 'src')); fs.writeFileSync(path.join(other, 'src', 'a.mjs'), 'x\n'); // outside the temp folder: a file there is exempt from the guards
  fs.writeFileSync(transcript, [prompt('ajusta la pantalla')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const edit = (session) => ToolHook.gate({ tool_name: 'Edit', tool_input: { file_path: path.join(other, 'src', 'a.mjs'), old_string: 'x', new_string: 'y' }, cwd: own, session_id: session, transcript_path: transcript }, claudeAgent) || '';
  assert.match(edit('s17b-gate-1'), NOT_NAMED, 'not listed: asked');
  withMemory(own, '- x: y', `- Related projects: ${path.basename(other)} (${other}) (confirmed 2026-11-18 by the user)`);
  assert.doesNotMatch(edit('s17b-gate-2'), NOT_NAMED, 'confirmed: the repository guard says nothing');
});

test('17b: the end-of-turn hook does not list a confirmed repository as one the request does not name', () => {
  const changed = [path.join(tmpRepo({ 'src/a.ts': 'x\n' }), 'src', 'a.ts')], repo = path.basename(path.dirname(path.dirname(changed[0])));
  assert.deepEqual(reposNotNamed(changed, '/nowhere-wm/chat', [], ''), [repo], 'not named: listed');
  assert.deepEqual(reposNotNamed(changed, '/nowhere-wm/chat', [], '', [repo.toLowerCase()]), [], 'confirmed: not listed');
  assert.deepEqual(reposNotNamed(changed, '/nowhere-wm/chat', [], '', ['other']), [repo], 'counter-example: another repo confirmed');
});

test('17c: the denial of a .env file points to .env.example; the denial of a key does not', () => {
  const dir = tmpRepo({ '.env.development': 'PORT=1\n', '.env.example': 'PORT=\n' });
  const env = ToolHook.checkSensitive({ reads: [path.join(dir, '.env.development')] }, dir, 's17c-1');
  assert.match(env || '', /\.env\.example/, 'the way to the ports and URLs with no secret');
  assert.match(env || '', /only the user can allow it/, 'who may allow what does not change');
  const key = ToolHook.checkSensitive({ reads: [path.join(os.homedir(), '.ssh', 'id_rsa')] }, dir, 's17c-2');
  assert.ok(key, 'a private key stays denied');
  assert.doesNotMatch(key || '', /\.env\.example/, 'counter-example: the pointer is for .env files only');
});

// ---- leftovers of failure 10: a notice whose output file is gone says so, and a gate's time is never a failure ----
test('10: a notice whose output file is gone leaves a finding that names the file and the way out, and a notice whose file exists leaves none', () => {
  const l = launchOf('bgb4'), gone = path.join(home, 'vanished.output'), lines = [...L2_EDIT, ...l.calls, notice('bgb4', l.useId, gone)];
  const g = judgeBg({ lines, notifications: T.taskNotifications(lines) });
  assert.ok(g.findings.some((f) => /background (?:build|command)/i.test(f) && f.includes('vanished.output') && /run it again|foreground/i.test(f)), 'the finding: ' + JSON.stringify(g.findings));
  const ok = judgeBg(withNotice('Application bundle generation complete'));
  assert.ok(!ok.findings.some((f) => /output file/i.test(f)), 'a file that exists says nothing');
});

test('10: a gate that runs past its limit is not judged: ok is null, `W testigos` shows it as not judged and its exit does not fail for it', async () => {
  const { runGate, gateLine, gateFails } = await import(`file://${SCRIPTS}/testigos.mjs`);
  const slow = runGate({ cmd: 'node -e "setTimeout(() => {}, 4000)"', from: 'x' }, os.tmpdir(), 300);
  assert.equal(slow.timedOut, true);
  assert.equal(slow.ok, null, 'a time is no verdict');
  assert.match(gateLine(slow), /^— typecheck now .*over \d+ s.*not judged/);
  assert.equal(gateFails(slow), false);
  const bad = runGate({ cmd: 'node -e "process.exit(1)"', from: 'x' }, os.tmpdir(), 5000);
  assert.equal(bad.ok, false);
  assert.match(gateLine(bad), /^✘ typecheck now/);
  assert.equal(gateFails(bad), true);
  assert.equal(gateFails(null), false);
});
