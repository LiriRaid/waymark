// Waymark 2.0.18 · point 12: every hook runs through hook-run.cjs, so a Node too old to parse a hook no longer kills it in silence, and the
// notice that a newer release exists is tested (docs/adr/0040). Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts').replace(/\\/g, '/');
const RUN = `${SCRIPTS}/hook-run.cjs`;
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-run-${name}-`)); temps.push(d); return d; };
const I = await import(`file://${SCRIPTS}/install-hooks.mjs`);
const W = await import(`file://${SCRIPTS}/waymark.mjs`);
const { release } = await import(`file://${SCRIPTS}/lib/version.mjs`);

// A hook that says who ran it: its pid and its parent's, what it was given and what it read; and a mark file, so a hook that did not run shows.
const dir = tmp('stub');
const STUB = path.join(dir, 'stub-hook.mjs').replace(/\\/g, '/');
fs.writeFileSync(STUB, `import fs from 'node:fs';
let input = '';
for await (const c of process.stdin) input += c;
fs.writeFileSync(${JSON.stringify(path.join(dir, 'ran'))}, 'yes');
console.log(JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv.slice(2), stdin: input.trim(), main: process.argv[1].replace(/\\\\/g, '/').endsWith('stub-hook.mjs') }));
process.exitCode = 3;
`);
const launch = (env, args = [STUB, '--agent', 'codex', '--event', 'Stop']) => {
  fs.rmSync(path.join(dir, 'ran'), { force: true });
  const r = spawnSync(process.execPath, [RUN, ...args], { input: 'hola', encoding: 'utf8', env: { ...process.env, ...env }, timeout: 30000 });
  return { ...r, out: (() => { try { return JSON.parse(r.stdout.trim().split('\n')[0]); } catch { return null; } })(), ran: fs.existsSync(path.join(dir, 'ran')) };
};
// an environment with no other Node anywhere: no nvm, a home and an AppData with nothing in them
const bare = () => { const h = tmp('bare'); return { NVM_HOME: '', NVM_DIR: path.join(h, 'none'), APPDATA: h, USERPROFILE: h, HOME: h, WAYMARK_HOME: path.join(h, '.waymark'), WAYMARK_NODE: '' }; };

test('a Node that is new enough runs the hook in the launcher\'s own process, with its arguments, its stdin and its exit code', () => {
  const r = launch({});
  assert.deepEqual([r.status, r.ran], [3, true], r.stderr);
  assert.equal(r.out.pid, r.pid, 'the hook is the launcher\'s process: no second process per call');
  assert.deepEqual([r.out.argv, r.out.stdin, r.out.main], [['--agent', 'codex', '--event', 'Stop'], 'hola', true]);
});

test('a Node too old hands the hook to WAYMARK_NODE, with the same arguments, stdin and exit code', () => {
  const r = launch({ ...bare(), WAYMARK_ACTIVE_NODE: '14.21.3', WAYMARK_NODE: process.execPath });
  assert.deepEqual([r.status, r.ran], [3, true], r.stderr);
  assert.equal(r.out.ppid, r.pid, 'the hook ran as the launcher\'s child');
  assert.deepEqual([r.out.argv, r.out.stdin, r.out.main], [['--agent', 'codex', '--event', 'Stop'], 'hola', true]);
});

test('a Node too old uses the one install-hooks pinned in ~/.waymark/node', () => {
  const env = { ...bare(), WAYMARK_ACTIVE_NODE: '14.21.3' };
  fs.mkdirSync(env.WAYMARK_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.WAYMARK_HOME, 'node'), fs.realpathSync(process.execPath).replace(/\\/g, '/'));
  const r = launch(env);
  assert.deepEqual([r.status, r.ran, r.out.ppid === r.pid], [3, true, true], r.stderr);
});

test('a pinned Node that is gone, or too old, is not used', () => {
  const env = { ...bare(), WAYMARK_ACTIVE_NODE: '14.21.3' };
  fs.mkdirSync(env.WAYMARK_HOME, { recursive: true });
  fs.writeFileSync(path.join(env.WAYMARK_HOME, 'node'), path.join(env.HOME, 'removed', 'node'));
  const r = launch(env);
  assert.equal(r.ran, false, 'nothing ran');
  assert.match(r.stdout, /need Node 18 or newer/);
});

test('with no Node that can run it, the hook says so in a message the agent shows, exits 0 and runs nothing', () => {
  const r = launch({ ...bare(), WAYMARK_ACTIVE_NODE: '14.21.3' });
  assert.equal(r.status, 0, 'a hook that cannot run never breaks the agent');
  assert.equal(r.ran, false);
  const msg = JSON.parse(r.stdout.trim().split('\n')[0]).systemMessage;
  assert.match(msg, /active Node is v14\.21\.3/);
  assert.match(msg, /stub-hook\.mjs did not run/);
  assert.match(msg, /not recorded and its Cierre is not checked/);
  assert.match(msg, /nvm use/);
  assert.match(msg, /WAYMARK_NODE/);
  assert.match(r.stderr, /Waymark: the active Node/, 'the same words reach stderr, for the log');
});

test('started with no hook script, or with one that does not exist, it says so and never throws a stack at the agent as success', () => {
  const none = launch({}, []);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /no hook script to run/);
  const gone = launch({}, [path.join(dir, 'missing-hook.mjs')]);
  assert.equal(gone.status, 1, 'a hook that fails to load is an error, as before the launcher');
  assert.match(gone.stderr, /missing-hook\.mjs failed to load/);
});

test('hook-run.cjs is written in syntax an old Node parses: no ??, ?., optional catch, async, await, **, ... or class fields', () => {
  const text = fs.readFileSync(`${SCRIPTS}/hook-run.cjs`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').replace(/'[^'\n]*'|"[^"\n]*"/g, "''").replace(/\/\/.*$/gm, '');
  for (const [re, why] of [[/\?\?/, '??'], [/\?\./, '?.'], [/catch\s*\{/, 'catch without a binding'], [/\basync\b/, 'async'], [/\bawait\b/, 'await'], [/\*\*/, '**'], [/\.\.\./, 'spread'], [/\bstatic\b/, 'static']]) {
    assert.equal(re.test(text), false, `hook-run.cjs must not use ${why}: an old Node would not even start it`);
  }
  const r = spawnSync(process.execPath, ['--check', RUN], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('every agent registers its hooks through the launcher, naming the hook script after it, and the matchers that find a hook still find it', () => {
  for (const agent of ['claude', 'codex', 'gemini', 'cursor', 'copilot', 'kiro', 'antigravity']) {
    const { settings } = I.planHooks({}, { scripts: '/s/waymark/scripts', agent });
    const commands = JSON.stringify(settings);
    for (const file of ['session-hook.mjs', 'rule0-hook.mjs', 'stop-hook.mjs']) {
      assert.ok(commands.includes(`node \\"/s/waymark/scripts/hook-run.cjs\\" \\"/s/waymark/scripts/${file}\\"`), `${agent}: ${file} is registered through hook-run.cjs`);
    }
    assert.equal(/node \\"[^"]*\/(session|rule0|tool|stop)-hook\.mjs/.test(commands), false, `${agent}: no hook is started by node directly`);
  }
  assert.equal(I.hookCommand('/s', 'stop-hook.mjs'), 'node "/s/hook-run.cjs" "/s/stop-hook.mjs"');
});

test('hooks registered the old way (node <hook>) are updated to the launcher, never duplicated', () => {
  const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "/s/waymark/scripts/stop-hook.mjs"' }] }], SessionStart: [{ hooks: [{ type: 'command', command: 'node "/other/tool.mjs"' }] }] } };
  const { settings, steps } = I.planHooks(old, { scripts: '/s/waymark/scripts', agent: 'claude' });
  assert.equal(settings.hooks.Stop.length, 1, 'one Stop entry');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, I.hookCommand('/s/waymark/scripts', 'stop-hook.mjs'));
  assert.ok(steps.some((s) => /^update Stop command/.test(s)), steps.join('\n'));
  assert.ok(settings.hooks.SessionStart.some((e) => e.hooks.some((h) => h.command === 'node "/other/tool.mjs"')), 'the user\'s own hook stays');
  assert.deepEqual(I.planHooks(settings, { scripts: '/s/waymark/scripts', agent: 'claude' }).steps.filter((s) => /Stop|Session|Prompt/.test(s)), [], 'idempotent');
});

test('pinNode writes the real path of the Node that registered the hooks to ~/.waymark/node', () => {
  const h = tmp('pin');
  process.env.WAYMARK_HOME = path.join(h, '.waymark');
  const at = I.pinNode();
  assert.equal(at, fs.realpathSync(process.execPath).replace(/\\/g, '/'));
  assert.equal(fs.readFileSync(path.join(h, '.waymark', 'node'), 'utf8'), at);
  assert.ok(I.MIN_NODE >= 18);
  assert.match(fs.readFileSync(`${SCRIPTS}/hook-run.cjs`, 'utf8'), new RegExp(`var MIN = ${I.MIN_NODE};`), 'the launcher and install-hooks hold the same number');
});

test('check\'s probe runs a hook through the launcher: one that answers is alive, one that does not exist is listed by its name', () => {
  assert.equal(W.hooksHealth([{ agent: 'claude', commands: [I.hookCommand(SCRIPTS, 'stop-hook.mjs'), `${I.hookCommand(SCRIPTS, 'session-hook.mjs')} --agent codex`] }]), '');
  const dead = W.hooksHealth([{ agent: 'claude', commands: [I.hookCommand(SCRIPTS, 'gone-hook.mjs')] }]);
  assert.match(dead, /not answering: claude gone-hook\.mjs/, dead);
});

// ---- the notice that a newer release exists ----

const serve = (body, status = 200) => new Promise((resolve) => {
  const s = http.createServer((q, a) => { a.writeHead(status, { 'content-type': 'text/plain' }); a.end(body); });
  s.unref(); // a failed assertion must not leave a listening server holding the test process open
  s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}/VERSION`, close: () => s.close() }));
});
const noticeFor = async (url) => { process.env.WAYMARK_UPDATE_URL = url; try { return await W.update(); } finally { delete process.env.WAYMARK_UPDATE_URL; } };
const INSTALLED = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim();
const bump = (v, by) => { const [a, b, c] = release(v).split('.').map(Number); return `${a}.${b}.${c + by}`; }; // a pre-release (2.0.20-dev) bumps from the release it leads to

test('update notice: a newer version on main is offered with its three answers; the same, an older one, an error page and no server say nothing', async () => {
  const newer = await serve(`${bump(INSTALLED, 1)}\n`);
  const msg = await noticeFor(newer.url); newer.close();
  assert.match(msg, new RegExp(`^update: Waymark ${INSTALLED.replace(/\./g, '\\.')} → ${bump(INSTALLED, 1).replace(/\./g, '\\.')}\\.`));
  assert.match(msg, /Actualizar ahora \/ Más tarde \/ Ver cambios/);
  assert.match(msg, /INSTALL\.md §9/);
  for (const body of [INSTALLED, '0.0.1', 'not a version']) {
    const s = await serve(body); assert.equal(await noticeFor(s.url), '', `served "${body}"`); s.close();
  }
  const missing = await serve('nope', 404); assert.equal(await noticeFor(missing.url), '', 'a 404 says nothing'); missing.close();
  const closed = await serve('9.9.9'); const url = closed.url; closed.close();
  assert.equal(await noticeFor(url), '', 'no server: the check fails without a word and never blocks');
});

test('update notice: it is part of check, which the session hook points to; INSTALL §9 ends by verifying the signature', async () => {
  const s = await serve(`${bump(INSTALLED, 1)}\n`);
  process.env.WAYMARK_UPDATE_URL = s.url;
  try { assert.ok((await W.check(tmp('proj'))).some((l) => l.startsWith('update: Waymark')), 'check lists the notice'); } finally { delete process.env.WAYMARK_UPDATE_URL; s.close(); }
  const install = fs.readFileSync(path.join(ROOT, 'INSTALL.md'), 'utf8');
  const nine = install.slice(install.indexOf('## 9. Update'), install.indexOf('## 10. Uninstall'));
  assert.match(nine, /verify --install --require-signature/);
  assert.ok(nine.indexOf('verify --install --require-signature') < nine.indexOf('Report with the same list'), 'the verification comes before the report');
});

test('update notice (2.0.20): a pre-release is older than the release it leads to, and the same pre-release is not an update', () => {
  assert.equal(W.newer('2.0.20', '2.0.20-dev'), true, 'the release is offered to a dev install of it');
  assert.equal(W.newer('2.0.20-dev', '2.0.20'), false, 'counter-example: a dev build is never newer than its release');
  assert.equal(W.newer('2.0.20-dev', '2.0.20-dev'), false, 'the same pre-release: nothing to update');
  assert.equal(W.newer('2.0.21', '2.0.20-dev'), true);
  assert.equal(W.newer('2.0.20', '2.0.20'), false);
});
