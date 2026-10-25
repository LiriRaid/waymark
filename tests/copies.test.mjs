// Waymark 2.0.19 · point 5: clean copies in a folder Waymark owns, removed with their task, the improvised ones listed, no link to a node_modules,
// and a test suite that leaves nothing in the machine's temp folder. Synthetic copies of the patterns: a logic case, a CSS/HTML case and the
// counter-example for each. Run: node --test tests/copies.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = process.env.WAYMARK_HOME; // the sandbox's
const { SANDBOX } = await import('./helpers/isolate.mjs');
const C = await import(`file://${SCRIPTS}/copy.mjs`);
const R = await import(`file://${SCRIPTS}/runs.mjs`);
const { checkLink } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const W = await import(`file://${SCRIPTS}/waymark.mjs`);
const G = await import(`file://${ROOT}/scripts/gate-tests.mjs`);
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const repo = (files = { 'src/a.mjs': 'a\n' }) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-copy-')); temps.push(d); gitT(d, 'init', '-q');
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  gitT(d, 'add', '-A'); gitT(d, 'commit', '-q', '-m', 'base');
  return d;
};
const hookRun = (script, payload) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, 20000);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  c.stdin.end(JSON.stringify(payload));
});

// ---- the copy is made, and removed, in a folder Waymark owns ----
test('5: logic — a copy lands in a short folder of Waymark\'s root, is a registered worktree, and `remove` takes both away, however deep it grew', () => {
  const d = repo();
  const c = C.makeCopy(d, 'HEAD');
  assert.ok(!c.error, c.error);
  assert.equal(path.dirname(c.path), C.copyRoot(), 'a numbered folder of the root, not one the agent invents');
  assert.ok(path.basename(c.path).length <= 3);
  assert.match(gitT(d, 'worktree', 'list').stdout.replace(/\\/g, '/'), new RegExp(c.path.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]]/g, '\\$&')));
  assert.ok(fs.existsSync(path.join(c.path, 'src', 'a.mjs')), 'a copy of HEAD');
  let deep = c.path;
  try { for (let i = 0; i < 30; i++) deep = path.join(deep, 'node_modules_like_folder_' + i); fs.mkdirSync(deep, { recursive: true }); } catch {} // past the 260 characters of a Windows path
  const r = C.removeCopy(c.path, { cwd: d });
  assert.ok(r.removed && !r.left && !fs.existsSync(c.path), 'gone');
  assert.ok(!gitT(d, 'worktree', 'list').stdout.includes(path.basename(c.path) + '\n') && !/\/tmp\/1\b/.test(gitT(d, 'worktree', 'list').stdout.replace(/\\/g, '/')), 'and no longer registered');
  const second = C.makeCopy(d, 'HEAD');
  assert.notEqual(second.path, c.path === second.path ? '' : c.path, 'the next one takes the next free number');
  C.removeCopy(second.path, { cwd: d });
});
test('5: CSS/HTML — a copy of a styles-only fixture leaves no folder once removed; a folder outside the root is never touched', () => {
  const d = repo({ 'src/app.css': 'a{}\n', 'src/index.html': '<p></p>\n' });
  const c = C.makeCopy(d, 'HEAD');
  assert.ok(fs.existsSync(path.join(c.path, 'src', 'app.css')));
  assert.ok(C.removeCopy(c.path, { cwd: d }).removed);
  assert.deepEqual(fs.readdirSync(C.copyRoot()).filter((n) => !n.startsWith('.')), [], 'the root is empty again');
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-keep-')); temps.push(other);
  fs.writeFileSync(path.join(other, 'precious.txt'), 'x');
  const refused = C.removeCopy(other, { cwd: d });
  assert.ok(refused.error && !refused.removed && fs.existsSync(path.join(other, 'precious.txt')), 'counter-example: only the root\'s own children are removed');
  assert.ok(!C.inRoot(path.join(C.copyRoot(), '..', 'x')) && C.inRoot(path.join(C.copyRoot(), '7')) && !C.inRoot(C.copyRoot()));
});

// ---- the close removes the copies its task made ----
for (const [kind, file] of [['logic', 'src/a.mjs'], ['CSS/HTML', 'src/app.css']]) {
  test(`5: ${kind} — the end-of-turn hook removes the clean copy its task made, and says so; a copy from before the task stays`, async () => {
    const d = repo({ [file]: 'a\n' });
    const older = C.makeCopy(d, 'HEAD');
    fs.utimesSync(older.path, new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));
    const before = Date.now();
    await new Promise((r) => setTimeout(r, 30));
    const mine = C.makeCopy(d, 'HEAD');
    const at = new Date(before).toISOString(); // the task's prompt came before the copy it made
    const lines = [{ type: 'user', uuid: 'p1', timestamp: at, message: { role: 'user', content: 'ajusta el archivo' } }, { type: 'assistant', timestamp: at, message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-backend' }] } },
      { type: 'assistant', timestamp: at, message: { content: [{ type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: path.join(d, file) } }] } }, { type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: 'e1', content: 'ok' }] } }];
    const transcript = path.join(d, 't.jsonl');
    fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const P = await import(`file://${SCRIPTS}/provenance.mjs`);
    const id = P.taskIds(d).next;
    const r = await hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: d, session_id: `s-copies-${kind}`, stop_hook_active: true, last_assistant_message: `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y` });
    assert.ok(!fs.existsSync(mine.path), 'the task\'s copy is gone at its close');
    assert.match(r.out, /copias limpias: 1 retirada/, 'and the user is told');
    assert.ok(fs.existsSync(older.path), 'counter-example: a copy made before the task is not this task\'s to remove');
    assert.ok(before > 0);
    C.removeCopy(older.path, { cwd: d });
  });
}

// ---- the close removes this repository's copies, and only those ----
test('5: a close removes the copies of its own repository made since the task began, not another repository\'s', () => {
  const a = repo(), b = repo();
  const since = Date.now() - 1000;
  const mine = C.makeCopy(a, 'HEAD'), theirs = C.makeCopy(b, 'HEAD');
  const r = C.closeCopies(since, a);
  assert.deepEqual(r.removed.map((p) => path.resolve(p)), [path.resolve(mine.path)]);
  assert.ok(!fs.existsSync(mine.path) && fs.existsSync(theirs.path), 'counter-example: another repository\'s copy, made after the start, is another session\'s to remove');
  C.removeCopy(theirs.path, { cwd: b });
  const one = C.makeCopy(a, 'HEAD'), two = C.makeCopy(a, 'HEAD');
  assert.notEqual(one.path, two.path, 'two copies in a row take two numbers');
  C.removeCopy(one.path, { cwd: a }); C.removeCopy(two.path, { cwd: a });
});

// ---- the folders nobody removed are listed, and removed with the user's yes ----
test('5: logic — improvised and test folders older than a task are orphans; a recent one, or any other name, is not; clean removes them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-places-')); temps.push(dir);
  const old = new Date(Date.now() - 24 * 3600000);
  for (const n of ['yawt-api', 'wm-old', 'waymark-x', 'tmp.abc', 'tmp.other']) { fs.mkdirSync(path.join(dir, n)); fs.utimesSync(path.join(dir, n), old, old); }
  fs.mkdirSync(path.join(dir, 'tmp.abc', '.git')); fs.utimesSync(path.join(dir, 'tmp.abc'), old, old); // a tmp.* that holds a repository copy is ours; another program's scratch is not
  fs.mkdirSync(path.join(dir, 'wm-fresh'));
  fs.mkdirSync(path.join(dir, 'projects'));
  fs.utimesSync(path.join(dir, 'projects'), old, old);
  const found = C.orphans({ places: [dir] });
  assert.deepEqual(found.map((o) => path.basename(o.path)).sort(), ['tmp.abc', 'waymark-x', 'wm-old', 'yawt-api']);
  assert.match(W.copiesLine(found), /copies: 4 folders left behind .*copy --clean shows them and --apply removes them/);
  const r = C.cleanOrphans(found);
  assert.equal(r.removed, 4);
  assert.ok(fs.existsSync(path.join(dir, 'wm-fresh')) && fs.existsSync(path.join(dir, 'projects')) && fs.existsSync(path.join(dir, 'tmp.other')), 'counter-example: a fresh folder, another name and another program\'s tmp.* stay');
  assert.equal(W.copiesLine([]), '');
});
test('5: CSS/HTML — the CLI: copy makes it, copy --remove removes it, copy --clean only plans until --apply', () => {
  const d = repo({ 'src/app.css': 'a{}\n' });
  const run = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), ...a], { cwd: d, encoding: 'utf8', env: process.env });
  const made = run('copy', 'HEAD');
  const p = made.stdout.split('\n')[0].trim();
  assert.ok(made.status === 0 && fs.existsSync(path.join(p, 'src', 'app.css')), made.stdout + made.stderr);
  assert.match(made.stdout, /copy --remove/);
  const old = new Date(Date.now() - 24 * 3600000); fs.utimesSync(p, old, old);
  assert.match(run('copy', '--clean').stdout, /plan, nothing removed/);
  assert.ok(fs.existsSync(p), 'counter-example: without --apply nothing is removed');
  assert.match(run('copy', '--remove', p).stdout, /removed/);
  assert.ok(!fs.existsSync(p));
  assert.notEqual(run('copy', '--remove', os.tmpdir()).status, 0, 'a folder that is not a copy is refused');
});

// ---- no link to a node_modules ----
test('5: logic — a junction or symlink to a node_modules is denied with the alternative; any other link, and a copy, are not', () => {
  for (const c of ['cmd /c mklink /J C:\\w\\node_modules C:\\repo\\node_modules', 'New-Item -ItemType Junction -Path .\\node_modules -Target ..\\repo\\node_modules', 'ln -s /repo/node_modules /tmp/w/node_modules', 'New-Item -ItemType SymbolicLink -Path node_modules -Value ..\\x\\node_modules'])
    assert.match(checkLink(c), /junction or link to a node_modules is denied.*waymark\.mjs copy HEAD.*copy --remove/, c);
  for (const c of ['ln -s ../shared/config.json config.json', 'mklink /J C:\\a C:\\b', 'git worktree add /tmp/w HEAD', 'pnpm install --offline', 'ls node_modules'])
    assert.equal(checkLink(c), null, c);
});
test('5: CSS/HTML — the same through the hook: a styles run that prepares its copy with a link is denied before it runs', async () => {
  const d = repo({ 'src/app.css': 'a{}\n' });
  const r = await hookRun('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cd /tmp/w && ln -s /repo/node_modules node_modules && npx stylelint src/app.css' }, cwd: d, session_id: 's-link' });
  assert.match(r.out, /junction or link to a node_modules is denied/);
  const ok = await hookRun('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npx stylelint src/app.css' }, cwd: d, session_id: 's-link' });
  assert.ok(!/junction or link/.test(ok.out), 'counter-example: an ordinary command passes');
});
test('5: a run in Waymark\'s copy root, and its own command, are read as a clean copy', () => {
  assert.equal(R.commandKind('node "C:/s/waymark/scripts/waymark.mjs" copy HEAD'), 'copy');
  assert.equal(R.commandKind(`cd "${C.copyRoot().replace(/\\/g, '/')}/1" && npm test`), 'copy');
  assert.notEqual(R.commandKind('npm test'), 'copy', 'counter-example: a run in the project is not');
});

// ---- the suite leaves nothing behind ----
test('5: every test process makes its one root in the sandbox: os.tmpdir() answers it here and in the processes the test spawns', () => {
  assert.ok(path.basename(SANDBOX).startsWith(`wm-test-${process.pid}-`), 'named after the process');
  assert.equal(path.resolve(os.tmpdir()), path.resolve(path.join(SANDBOX, 'tmp')));
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("os").tmpdir())'], { encoding: 'utf8', env: process.env });
  assert.equal(path.resolve(child.stdout), path.resolve(path.join(SANDBOX, 'tmp')));
});
test('5: gate-tests counts the wm-* and waymark-* folders of a temp folder, so a run that leaves one is a failed run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-count-')); temps.push(dir);
  assert.equal(G.tempFolders(dir), 0);
  for (const n of ['wm-a', 'waymark-b', 'other']) fs.mkdirSync(path.join(dir, n));
  assert.equal(G.tempFolders(dir), 2, 'counter-example: a folder with another name is none of ours');
  assert.equal(G.tempFolders(path.join(dir, 'missing')), 0);
});
