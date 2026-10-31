// 2.0.20 · the Cierre written before the work was done (a real L2 task: the routing line sat under megabytes of ego output, so the first change was handed neither the
// procedures nor the list of what the close asks; the last short turn was judged L1; ego landed on the sign-in page). Synthetic copies of those shapes (ADR 0042).
import './helpers/isolate.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-early-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { packContext } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);
const E = await import(`file://${SCRIPTS}/eyes.mjs`);
const { eyesGaps } = E;
const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-early-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
let ids = 0;
const prompt = (text, at) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at, message: { role: 'user', content: text } });
const say = (text, at) => ({ type: 'assistant', timestamp: at, message: { content: [{ type: 'text', text }] } });
const run = (name, input, { out = 'ok' } = {}) => {
  const id = `e${++ids}`;
  return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] } }];
};

test('the route is read back to the task\'s start: a routing line under megabytes of tool output still hands the close list at the first change', async () => {
  const repo = withMemory(repoAt('route'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.mjs'), 'x');
  fs.writeFileSync(path.join(repo, 'src', 'b.mjs'), 'y');
  const big = 'x'.repeat(200 * 1024); // an ego capture or a page dump
  const lines = [prompt('rehaz la pantalla', '2026-10-30T10:00:00Z'), say('Waymark → L2 · dept-backend · skills: dept-backend', '2026-10-30T10:00:01Z'), ...run('Skill', { skill: 'dept-backend', args: 'L2' })];
  for (let i = 0; i < 12; i++) lines.push(...run('Bash', { command: `ego-browser nodejs < probe${i}.mjs` }, { out: big })); // 2.4 MB after the routing line
  const transcript = path.join(home, 'long-session.jsonl');
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n'));
  const packed = path.join(home, 'packed-route.json');
  const call = (f) => ({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', f) }, cwd: repo, session_id: 's-route', transcript_path: transcript });
  const first = await packContext(call('a.mjs'), claude, packed);
  assert.match(first || '', /At L2 and above the close also asks for/, 'the first change of an L2 task is handed what the close asks, whatever the transcript\'s size');
  assert.match(first || '', /A step only the user can do[^.]*asked and waited for in the same turn, with no Cierre/, 'and that a step only the user can do is waited for, never a parcial');
  assert.equal(JSON.parse(fs.readFileSync(packed, 'utf8'))['s-route'].route.level, 2, 'the route is kept in the task\'s state: the next edit does not read the transcript again');
  const second = await packContext(call('b.mjs'), claude, packed);
  assert.doesNotMatch(second || '', /At L2 and above/, 'once per task');
});

test('a short turn that continues the task keeps the task\'s level (the migrate after an L2 build is not an L1)', () => {
  const turn1 = [prompt('rehaz la pantalla', '2026-10-30T10:00:00Z'), say('Waymark → L2 · dept-frontend · skills: dept-frontend', '2026-10-30T10:00:01Z'), ...run('Edit', { file_path: '/p/a.ts' }), say('## Cierre · 2026-10-30 · T2\nResultado: parcial (falta la migración)')];
  const turn2 = [prompt('haz el migrate tu porfavor', '2026-10-30T10:30:00Z'), say('Waymark → L1 · dept-data · skills: dept-data', '2026-10-30T10:30:01Z'), ...run('Bash', { command: 'pnpm run prisma:migrate' })];
  assert.equal(T.taskLevel([...turn1, ...turn2]), 2, 'the stretch\'s highest level');
  assert.equal(T.taskLevel(turn2), 1, 'a task that never was L2 stays L1');
  assert.equal(T.taskLevel([prompt('a'), say('Waymark → L3 · dept-architecture · skills: x'), prompt('b'), say('Waymark → L1 · dept-qa · skills: x')]), 3, '3 stays 3');
});

test('ego on the app\'s sign-in page is not a gap the agent closes: it asks the user to sign in and waits, with no Cierre', () => {
  const tools = [
    { name: 'Bash', input: { command: 'ego-browser nodejs <<\'EOF\'\nconst t = await taskSpace("p");\nconst r = await t.page("p2").evaluate(() => getBoundingClientRect());\nEOF' }, id: 'g1' },
  ];
  const out = (t) => 'http://localhost:4200/login?returnUrl=%2Fshifts\n{"title":"App"}';
  const seen = E.observeEyes(tools, { from: -1, outOf: out });
  assert.equal(seen.login, true, 'the page after the last change is the local sign-in');
  const gap = eyesGaps({ ...seen, afterLastChange: false }, 'ego', null, {});
  assert.match(gap.join(' '), /sign-in page.*not a Cierre yet.*no Cierre/);
  const fine = E.observeEyes(tools, { from: -1, outOf: () => 'http://localhost:4200/shifts\n{}' });
  assert.equal(fine.login, undefined, 'a page of the app is no login');
  assert.doesNotMatch(eyesGaps({ ...fine, afterLastChange: false }, 'ego', null, {}).join(' '), /sign-in page/);
  // the gap is asked in the choice window, with the two answers, and waited for
  assert.match(gap.join(' '), /choice window.*(ya inicié sesión|signed in)/is, 'the agent asks in the window and waits for the answer');
});

test('a /login link a script prints inside a page that holds a session is no sign-in page; only the page the call landed on counts', () => {
  const tools = [{ name: 'Bash', input: { command: 'ego-browser nodejs <<\'EOF\'\nconst t = await taskSpace("p");\nconst r = await t.page("p2").evaluate(() => [...document.links].map(a => a.href));\nconsole.log(r);\nEOF' }, id: 'g2' }];
  const listing = 'http://localhost:4200/shifts\n["http://localhost:4200/login","http://localhost:4200/shifts/1"]';
  assert.equal(E.observeEyes(tools, { from: -1, outOf: () => listing }).login, undefined, 'a link to /login in the list of links of a page of the app');
  const grep = 'src/app.routes.ts:12:  { path: "login" } // http://localhost:4200/login';
  assert.equal(E.observeEyes(tools, { from: -1, outOf: () => grep }).login, undefined, 'a line of source that names the address');
  assert.equal(E.observeEyes(tools, { from: -1, outOf: () => 'http://localhost:4200/login\n{}' }).login, true, 'the page the call landed on is the sign-in');
  assert.equal(E.observeEyes(tools, { from: -1, outOf: () => 'step 1 done\nhttp://localhost:4200/login?returnUrl=%2F\n{}' }).login, true, 'a line the script printed before the address does not hide the sign-in');
});

test('the stop hook judges the closing short turn at the task\'s level, so build, review and eyes are still owed', async () => {
  const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`), P = await import(`file://${SCRIPTS}/provenance.mjs`);
  const lines = [prompt('haz el migrate', '2026-10-30T10:30:00Z'), say('Waymark → L1 · dept-data · skills: dept-data', '2026-10-30T10:30:01Z'), ...run('Edit', { file_path: '/work/p/prisma/schema.prisma' })];
  const reply = `## Cierre · 2026-10-30 · T2\nResultado: hecho\nEvidencia: inferida de la migración (check: abre la base)\nAprendido: la migración se aplica`;
  const at = (taskLevel) => cierreGaps(T.currentTurn(lines), reply, undefined, undefined, { ids: P.taskIds('/work/p'), taskLevel, cwd: '/work/p', decisions: [] });
  assert.equal(at(0)?.level, 1, 'alone it is an L1');
  assert.equal(at(2)?.level, 2, 'inside an L2 task it is judged L2');
});

// the whole hook: a task whose only gap is the user's sign-in on ego's tab is not blocked and not recorded; it stays open for the next message
test('the stop hook leaves a sign-in-only gap unblocked and keeps the task open; with other gaps the block carries it', async () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-early-home-')); temps.push(fakeHome);
  const egoDir = path.join(fakeHome, '.local', 'share', 'ego', 'active_version_dir'); fs.mkdirSync(egoDir, { recursive: true });
  for (const x of ['', '.exe']) fs.writeFileSync(path.join(egoDir, `ego-browser${x}`), '');
  const dir = repoAt('login'); withMemory(dir);
  fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'app.css'), 'a{}');
  gitT(dir, 'add', '-A'); gitT(dir, 'commit', '-q', '-m', 'base');
  const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
  const shot = run('Bash', { command: 'ego-browser nodejs <<\'EOF\'\nawait page.evaluate(() => document.body.getBoundingClientRect());\nEOF' }, { out: 'http://localhost:4200/login?returnUrl=%2F\n{}' });
  const last = '## Cierre · 2026-10-30 · T1\nResultado: hecho\nEvidencia: observada la página de login\nAprendido: x ← y';
  const transcript = path.join(dir, 'login.jsonl');
  fs.writeFileSync(transcript, [prompt('ajusta el estilo', at()), say('Waymark → L2 · dept-frontend', at()), ...run('Edit', { file_path: path.join(dir, 'src', 'app.css'), old_string: 'a{}', new_string: 'a{color:red}' }), ...shot, say(last, at())].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'src', 'app.css'), 'a{color:red}');
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { env: { ...process.env, WAYMARK_HOME: home, HOME: fakeHome, USERPROFILE: fakeHome, Path: path.dirname(process.execPath) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => resolve(o));
    c.stdin.end(JSON.stringify({ transcript_path: transcript, cwd: dir, session_id: 's-login', last_assistant_message: last, stop_hook_active: false }));
  });
  // the other testigos of this bare fixture still block; the sign-in gap is in the same block, asking to pause and not for a Cierre
  assert.match(out, /the ego space shows the app\'s sign-in page|the ego space shows the app's sign-in page/, 'the gap reaches the agent as an ask-and-wait: ' + out.slice(0, 200));
  const { signInOnly } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  assert.equal(signInOnly(["the ego space shows the app's sign-in page (no session in it)"]), true, 'alone, it is no block: the task stays open with a notice');
  assert.equal(signInOnly(["the ego space shows the app's sign-in page", 'run the build once']), false, 'with anything the agent can do, the block stands');
  assert.equal(signInOnly([]), false);
});

test('a re-route inside the task wins over the route the task\'s state kept', async () => {
  const repo = withMemory(repoAt('reroute'));
  fs.mkdirSync(path.join(repo, 'src'));
  for (const f of ['a.mjs', 'b.mjs']) fs.writeFileSync(path.join(repo, 'src', f), 'x');
  const transcript = path.join(home, 'reroute.jsonl'), packed = path.join(home, 'packed-reroute.json');
  const first = [prompt('ajusta', '2026-10-30T10:00:00Z'), say('Waymark → L2 · dept-backend · skills: dept-backend', '2026-10-30T10:00:01Z'), ...run('Skill', { skill: 'dept-backend', args: 'L2' })];
  fs.writeFileSync(transcript, first.map((l) => JSON.stringify(l)).join('\n'));
  const call = (f) => ({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', f) }, cwd: repo, session_id: 's-reroute', transcript_path: transcript });
  await packContext(call('a.mjs'), claude, packed);
  assert.equal(JSON.parse(fs.readFileSync(packed, 'utf8'))['s-reroute'].route.dept, 'dept-backend');
  fs.writeFileSync(transcript, [...first, say('Waymark → L2 · dept-frontend · skills: dept-frontend', '2026-10-30T10:05:00Z'), ...run('Skill', { skill: 'dept-frontend', args: 'L2' })].map((l) => JSON.stringify(l)).join('\n'));
  await packContext(call('b.mjs'), claude, packed);
  assert.equal(JSON.parse(fs.readFileSync(packed, 'utf8'))['s-reroute'].route.dept, 'dept-frontend', 'the kept route never pins a task to its first department');
});

// the whole hook on the path with no block: the change was seen, the only thing left is the user's sign-in on ego's tab
test('the stop hook with every other proof in place: a sign-in-only close is no block, no record, and the task stays open with a notice', async () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-early-home2-')); temps.push(fakeHome);
  const egoDir = path.join(fakeHome, '.local', 'share', 'ego', 'active_version_dir'); fs.mkdirSync(egoDir, { recursive: true });
  for (const x of ['', '.exe']) fs.writeFileSync(path.join(egoDir, `ego-browser${x}`), '');
  const dir = repoAt('login-free'); withMemory(dir);
  fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'app.css'), 'a{}');
  gitT(dir, 'add', '-A'); gitT(dir, 'commit', '-q', '-m', 'base');
  const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
  const gate = run('Bash', { command: 'node --check src/app.css' }, { out: '' });
  const look = run('Bash', { command: 'ego-browser nodejs <<\'EOF\'\nawait page.evaluate(() => document.body.getBoundingClientRect());\nEOF' }, { out: 'http://localhost:4200/login?returnUrl=%2F\n{}' });
  const last = '## Cierre · 2026-10-30 · T1\nResultado: hecho\nEvidencia: observada la página de login\nAprendido: x ← y';
  const transcript = path.join(dir, 'free.jsonl');
  fs.writeFileSync(transcript, [prompt('ajusta el estilo', at()), say('Waymark → L1 · dept-frontend · skills: dept-frontend', at()), say('Camino: cambiar el color en app.css', at()), ...run('Skill', { skill: 'dept-frontend', args: 'L1' }), ...run('Bash', { command: 'node "C:/x/waymark/scripts/waymark.mjs" memory Identity' }), ...run('Read', { file_path: 'C:/x/skills/dept-frontend/procedures.md' }), ...run('Edit', { file_path: path.join(dir, 'src', 'app.css'), old_string: 'a{}', new_string: 'a{color:red}' }), ...gate, ...look, say(last, at())].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'src', 'app.css'), 'a{color:red}');
  const out = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { env: { ...process.env, WAYMARK_HOME: home, HOME: fakeHome, USERPROFILE: fakeHome, Path: path.dirname(process.execPath) }, stdio: ['pipe', 'pipe', 'pipe'] });
    let o = ''; c.stdout.on('data', (d) => { o += d; }); c.on('close', () => resolve(o));
    c.stdin.end(JSON.stringify({ transcript_path: transcript, cwd: dir, session_id: 's-free', last_assistant_message: last, stop_hook_active: false }));
  });
  assert.doesNotMatch(out, /"decision":"block"/, 'nothing the agent can close is left: ' + out.slice(0, 600));
  assert.match(out, /la tarea sigue abierta/, 'the user is told the task stays open: [' + out.slice(0, 300) + ']');
  const P = await import(`file://${SCRIPTS}/provenance.mjs`);
  assert.equal(P.readRecords(P.projectHome(dir).log).filter((r) => r.id).length, 0, 'no record: the task is not closed');
});
