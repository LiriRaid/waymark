// Waymark 2.0.19 · point 2: records and task boundaries, no work without a record and no record without work. Every case is a
// synthetic copy of a pattern; each fix has a logic case (.mjs), a CSS/HTML case (.css edit) and the counter-example that must
// keep working as it did. Run: node --test tests/records.test.mjs
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-rec-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps, touchedRepos } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { real } = await import(`file://${SCRIPTS}/lib/paths.mjs`);
const { currentTurn, pendingBackground, BACKGROUND_WAIT_MS } = await import(`file://${SCRIPTS}/transcript.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-rec-')); temps.push(d); gitT(d, 'init', '-q');
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

const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const prompt = (text, when = at()) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: when, message: { role: 'user', content: text } });
const say = (text, when = at()) => ({ type: 'assistant', timestamp: when, message: { content: [{ type: 'text', text }] } });
let ids = 0;
const call = (name, input, when = at()) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: when, message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: when, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
const launch = (toolUseId, agentId, when = at()) => ({ type: 'user', timestamp: when, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Async agent launched successfully.' }] }, toolUseResult: { isAsync: true, status: 'async_launched', ...(agentId ? { agentId } : {}) } });
const notice = (body) => ({ type: 'user', timestamp: at(), message: { role: 'user', content: `<task-notification>\n${body}\n</task-notification>` } });
const CIERRE = (id = '2026-10-25 · T1') => `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida de la lectura (check: node --check)\nAprendido: x ← y`;

// ---- 2a · a background agent is matched by its task-id as well as by the launch's tool-use id ----
test('2a: logic — a notification that carries only the agent\'s task-id releases its launch; one that never came still holds it', () => {
  const turn = [prompt('corre el review del servicio'), say('Waymark → L2 · dept-backend'), ...call('Agent', { run_in_background: true }), launch('toolu_a1', 'a79f')];
  assert.deepEqual(pendingBackground(turn), ['toolu_a1'], 'counter-example: a launch with no notification is still pending');
  assert.deepEqual(pendingBackground([...turn, notice('<task-id>a79f</task-id>\n<status>completed</status>')]), [], 'no tool-use-id in the notification: the agent id matches');
  assert.deepEqual(pendingBackground([...turn, notice('<task-id>other</task-id>')]), ['toolu_a1'], 'counter-example: another agent\'s notification releases nothing');
});
test('2a: an agent that never reports is not waited for past the limit', () => {
  const old = [prompt('corre el review', at(-3 * BACKGROUND_WAIT_MS)), say('Waymark → L2', at(-3 * BACKGROUND_WAIT_MS)), launch('toolu_a2', 'dead', at(-2 * BACKGROUND_WAIT_MS))];
  assert.deepEqual(pendingBackground(old), [], 'launched hours ago, no notification: the turn is judged');
  const recent = [prompt('corre el review'), say('Waymark → L2'), launch('toolu_a3', 'live', at(-1000))];
  assert.deepEqual(pendingBackground(recent), ['toolu_a3'], 'counter-example: a recent launch still holds');
});
for (const [kind, file, label] of [['logic', 'src/orders.service.mjs', 'a .mjs change'], ['CSS/HTML', 'src/app.css', 'a stylesheet change']]) {
  test(`2a: ${kind} — a reply that carries its Cierre is judged while the review still runs (${label}); one that only waits is not`, async () => {
    const dir = tmpRepo({ [file]: 'x\n' });
    const transcript = path.join(dir, 't.jsonl');
    const lines = (last) => [prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend'), ...call('Edit', { file_path: path.join(dir, file) }), ...call('Agent', { run_in_background: true }), launch('toolu_bg', 'bg1'), say(last)];
    const stop = async (last, session) => { fs.writeFileSync(transcript, lines(last).map((l) => JSON.stringify(l)).join('\n') + '\n'); return hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: last }); };
    const waiting = (await stop('Espero el review.', `rec-wait-${kind}`)).out;
    assert.doesNotMatch(waiting, /"decision":"block"/, 'waiting: no block');
    assert.match(waiting, /se evaluará cuando termine la tarea en segundo plano/, 'and a notice that says so (docs/adr/0044)');
    assert.notEqual((await stop(CIERRE(), `rec-cierre-${kind}`)).out.trim(), '', 'a Cierre in the reply: the hook judges it (here it answers)');
  });
}

// ---- 2c · the changes of a turn the user interrupted are judged with the next one ----
const writeIn = (dir, file, body) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), body); };
for (const [kind, file] of [['logic', 'src/orders.service.mjs'], ['CSS/HTML', 'src/app.css']]) {
  test(`2c: ${kind} — a file changed in a turn that never closed is still the next turn's change; after a close it is not`, async () => {
    const dir = tmpRepo({ [file]: 'a\n', 'src/other.mjs': 'a\n' });
    const prompt1 = (session, text) => hookRun('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', prompt: text, cwd: dir, session_id: session });
    // interrupted: prompt 1, an edit, no close (the hook never ran), prompt 2
    await prompt1(`s-int-${kind}`, 'cambia el servicio');
    writeIn(dir, file, 'b\n');
    await prompt1(`s-int-${kind}`, 'continúa');
    assert.ok(P.turnChanged(`s-int-${kind}`, dir).some((f) => f.endsWith(path.basename(file))), 'the interrupted turn\'s edit is in the diff the next close reads');
    // counter-example: the turn closed (open entry removed), the next prompt starts clean
    await prompt1(`s-closed-${kind}`, 'cambia otra cosa');
    writeIn(dir, 'src/other.mjs', 'b\n');
    P.closeOpen(P.projectHome(dir), `s-closed-${kind}`);
    await prompt1(`s-closed-${kind}`, 'otra tarea');
    assert.ok(!P.turnChanged(`s-closed-${kind}`, dir).some((f) => f.endsWith('other.mjs')), 'a closed turn\'s edit belongs to its own record, not the next');
  });
}
test('2c: an open turn older than the day limit is not carried over', () => {
  const dir = tmpRepo();
  P.markOpen(dir, 's-old', 'algo viejo', new Date(Date.now() - 7 * 3600000));
  assert.equal(P.openTurn(dir, 's-old'), null);
  P.markOpen(dir, 's-new', 'algo reciente', new Date());
  assert.equal(P.openTurn(dir, 's-new').prompt, 'algo reciente');
});

// ---- 2d · no record without work: a turn no prompt started, or an empty one, that changed nothing ----
const outsideTask = (promptText, more = {}) => {
  const lines = [prompt(promptText), say('Waymark → L2 · dept-devops'), ...call('Bash', { command: 'git push' })];
  return cierreGaps(currentTurn(lines), CIERRE(), undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [], outside: true, ...more });
};
test('2d: logic — a notification turn after the close, with no change, writes no ghost task; a real outside task still does', () => {
  assert.equal(outsideTask('sube el cambio', { resumed: true }), null, 'resumed by a notification');
  const again = [prompt('sube el cambio'), say('Waymark → L2 · dept-devops'), ...call('Bash', { command: 'git push' }), prompt('sube el cambio'), say('Waymark → L2 · dept-devops'), ...call('Bash', { command: 'git push' })];
  assert.ok(cierreGaps(currentTurn(again), CIERRE(), undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [], outside: true }), 'counter-example: the same words asked again are a new task, not a ghost');
  assert.equal(outsideTask('   '), null, 'an empty prompt');
  assert.ok(outsideTask('sube el cambio'), 'counter-example: a task with a Cierre whose changes are all outside the project is recorded');
});
test('2d: CSS/HTML — the same turn after a styles task: with a file changed it is still a task', () => {
  const lines = [prompt('ajusta el margen del botón'), say('Waymark → L1 · dept-frontend'), ...call('Edit', { file_path: '/work/proj/src/app.css' })];
  assert.ok(cierreGaps(currentTurn(lines), CIERRE(), undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [], resumed: true }), 'counter-example: a changed stylesheet is work, whatever the prompt');
  assert.equal(outsideTask('ajusta el margen del botón', { resumed: true }), null);
});

// ---- 2d · one short record in every other project a task changed files in ----
for (const [kind, file] of [['logic', 'src/b.service.mjs'], ['CSS/HTML', 'src/b.css']]) {
  test(`2d: ${kind} — a task that changes a sibling project's file leaves a "touched" record there, no task ID and no counter move`, () => {
    const a = tmpRepo({ 'src/a.mjs': 'a\n' }), b = tmpRepo({ [file]: 'a\n' }), plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-rec-')); temps.push(plain); gitT(plain, 'init', '-q');
    const rec = { id: '2026-10-25 · T1', agent: 'claude', at: new Date().toISOString(), session: 's-two', cierre: '## Cierre · x\nAprendido: el estilo vive en b' };
    const got = touchedRepos([path.join(a, 'src/a.mjs'), path.join(b, file), path.join(plain, 'x.css')], a, rec, 'a');
    assert.deepEqual(got.map((g) => g.root.replace(/\\/g, '/')), [real(b).replace(/\\/g, '/')], 'only the project with Waymark memory, never the one the task ran in (git spells its root as the filesystem does: 8.3 short names expanded)');
    assert.equal(got[0].record.kind, 'touched');
    assert.deepEqual(got[0].record.files, [file], 'the path relative to that project');
    const before = P.taskIds(b).next;
    P.appendRecord(b, got[0].record);
    assert.equal(P.taskIds(b).next, before, 'no ID taken there');
    assert.match(P.tasksMarkdown(P.projectHome(b)), new RegExp(`Touched from another project[\\s\\S]*2026-10-25 · T1 from a[\\s\\S]*${path.basename(file)}`));
    assert.deepEqual(touchedRepos([path.join(b, file)], a, { ...rec, repos: [{ root: b, commits: ['x'] }] }, 'a'), [], 'counter-example: a project the task committed in already holds it as a note');
  });
}

for (const [kind, file] of [['logic', 'src/b.service.mjs'], ['CSS/HTML', 'src/b.css']]) {
  test(`2d: ${kind} — a file typed through a link to the sibling (an 8.3 short name on Windows) is still that project's file`, () => {
    const a = tmpRepo({ 'src/a.mjs': 'a\n' }), b = tmpRepo({ [file]: 'a\n' }), alias = path.join(os.tmpdir(), `wm-alias-${process.pid}-${kind.length}`);
    temps.push(alias);
    try { fs.symlinkSync(b, alias, 'junction'); } catch { return; } // no right to make a link here: nothing to show
    const rec = { id: '2026-10-25 · T1', agent: 'claude', at: new Date().toISOString(), session: 's-alias', cierre: '## Cierre · x\nAprendido: x' };
    assert.deepEqual(touchedRepos([path.join(alias, file)], a, rec, 'a').map((g) => g.record.files), [[file]], 'the path relative to that project, whichever way it was spelled');
    const outside = tmpRepo({ 'src/c.mjs': 'a\n' });
    assert.deepEqual(touchedRepos([path.join(outside, 'src/c.mjs'), path.join(alias, file)], a, rec, 'a').find((g) => real(g.root) === real(b)).record.files, [file], 'counter-example: a file of another project stays out of this one');
  });
}

// the same, end to end: the end-of-turn hook of the project the session ran in writes the record in the sibling too
for (const [kind, file] of [['logic', 'src/b.service.mjs'], ['CSS/HTML', 'src/b.css']]) {
  test(`2d: ${kind} — the end-of-turn hook leaves the "touched" record in the sibling project`, async () => {
    // the sibling sits inside the project's folder only so the temp folder's exemption does not hide its files; it is its own repo with its own memory
    const a = tmpRepo({ 'src/a.mjs': 'a\n' }), b = path.join(a, 'sib');
    fs.mkdirSync(path.join(b, '.waymark'), { recursive: true });
    fs.mkdirSync(path.join(b, path.dirname(file)), { recursive: true });
    gitT(b, 'init', '-q');
    fs.writeFileSync(path.join(b, '.waymark', 'memory.md'), '# S\n\n## Work in progress\n');
    fs.writeFileSync(path.join(b, file), 'a\n');
    const transcript = path.join(a, 't.jsonl');
    const lines = [prompt('ajusta el estilo del hermano'), say('Waymark → L1 · dept-frontend'), ...call('Edit', { file_path: path.join(b, file) })];
    fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const id = P.taskIds(a).next;
    await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: a, session_id: `s-sib-${kind}`, stop_hook_active: true, last_assistant_message: `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: el estilo vive en el hermano ← lo dijo el pedido` });
    const touched = P.readRecords(P.projectHome(b).log).filter((r) => r.kind === 'touched');
    assert.equal(touched.length, 1, 'the sibling holds one');
    assert.equal(touched[0].task, id);
    assert.deepEqual(touched[0].files, [file]);
    assert.ok(!P.readRecords(P.projectHome(a).log).some((r) => r.kind === 'touched'), 'counter-example: the project the task ran in holds the task itself, not a pointer');
  });
}

// ---- 2i · two sessions on one project ----
test('2i: logic — a second session is told another has a turn open; the first one is not told about itself', async () => {
  const dir = tmpRepo();
  const prompt1 = (session, text) => hookRun('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', prompt: text, cwd: dir, session_id: session });
  const first = await prompt1('s-a', 'agrega reintentos');
  const second = await prompt1('s-b', 'cambia el color');
  assert.match(second.out, /Another session[^"]*has a turn open in this project since [\d:]+ \(\\"agrega reintentos\\"\)/); // the hook's JSON escapes the quotes
  assert.ok(!/Another session/.test(first.out), 'counter-example: the first session has no other to warn about');
});
test('2i: CSS/HTML — an open turn older than two hours is another day\'s: no warning', async () => {
  const dir = tmpRepo();
  P.markOpen(dir, 's-stale', 'ajusta el padding', new Date(Date.now() - 3 * 3600000));
  const r = await hookRun('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'ajusta el color', cwd: dir, session_id: 's-fresh' });
  assert.ok(!/Another session/.test(r.out), 'counter-example: a stale open turn is not a second session');
});
