// Waymark 2.0.19 · point 6: legacy stacks. The runtime a stack needs (Angular 10 → Node 14) is read from the repo and written as a gate prefix; a temp config
// file made and removed in one command is no change; a slow legacy build and a broken baseline are declared, not punished; git does not assume `origin`.
// Synthetic copies of the patterns: a logic case, a CSS/HTML case and the counter-example for each. Run: node --test tests/legacy.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
process.env.WAYMARK_ENGRAM = '';
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const R = await import(`file://${SCRIPTS}/runtime.mjs`);
const T = await import(`file://${SCRIPTS}/testigos.mjs`);
const { gateCommand } = T;
const { digest } = await import(`file://${SCRIPTS}/session-hook.mjs`);

const MEMORY = '# P\n\n## Work in progress\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | | <date> |\n| build | | |\n<!-- a comment after the table -->\n\n## Design system\n';
const repo = (pkg, files = {}, memory = MEMORY) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-legacy-')); temps.push(d);
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pkg));
  fs.mkdirSync(path.join(d, '.waymark')); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), memory);
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  return d;
};
const ng = (major, extra = {}) => ({ name: 'legacy', scripts: { typecheck: 'tsc --noEmit -p tsconfig.app.json', build: 'ng build' }, dependencies: { '@angular/core': `^${major}.0.5`, rxjs: '^6.5.4' }, devDependencies: { typescript: '3.9.7' }, ...extra });
const volta = (bin) => bin === 'volta', fnm = (bin) => bin === 'fnm', none = () => false;

// ---- the Node a repo asks for ----
test('6: logic — the Node comes from the repo (volta, .nvmrc, engines) before the Angular table, and a machine inside it needs nothing', () => {
  assert.deepEqual(R.neededNode(repo(ng(10))), { use: 14, ok: [10, 12, 14], from: 'angular 10' });
  assert.equal(R.neededNode(repo(ng(10, { volta: { node: '12.22.12' } }))).use, 12, 'volta.node of the repo first');
  assert.equal(R.neededNode(repo(ng(10), { '.nvmrc': 'v16.20.0\n' })).use, 16, '.nvmrc next');
  assert.deepEqual(R.neededNode(repo(ng(15, { engines: { node: '>=14.20 <19' } }))).from, 'package.json engines');
  assert.equal(R.neededNode(repo({ name: 'plain', dependencies: { express: '^4' } })), null, 'counter-example: a repo that asks for nothing');
  for (const [range, major, ok] of [['>=14 <17', 14, true], ['>=14 <17', 18, false], ['^16 || >=18', 20, true], ['^16 || >=18', 17, false], ['14.x', 14, true], ['14.x', 16, false], ['', 24, true]]) assert.equal(R.satisfiesMajor(range, major), ok, `${range} / ${major}`);
});
// A Node of another major is a folder on this machine (nvm-windows, nvm, Volta, fnm, asdf, mise): the gate runs with it first on the PATH, never a
// prefix glued to a chained command and never a switch of the machine's Node.
const nodeHome = (layout) => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-nodes-')); temps.push(h);
  for (const [dir, bin] of layout) { fs.mkdirSync(path.join(h, dir), { recursive: true }); fs.writeFileSync(path.join(h, dir, bin), ''); }
  return h;
};
test('6: logic — the folder of the Node the repo needs is found in any manager, the newest of that major', () => {
  const win = nodeHome([['AppData/Roaming/nvm/v14.17.0', 'node.exe'], ['AppData/Roaming/nvm/v14.21.3', 'node.exe'], ['AppData/Roaming/nvm/v16.20.2', 'node.exe'], ['AppData/Roaming/nvm/v12.0.0', 'nothing.txt']]);
  const env = { APPDATA: path.join(win, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(win, 'AppData', 'Local') };
  assert.deepEqual(R.nodeDir(14, { env, home: win, platform: 'win32' }), { via: 'nvm-windows', dir: path.join(win, 'AppData', 'Roaming', 'nvm', 'v14.21.3') });
  assert.equal(R.nodeDir(12, { env, home: win, platform: 'win32' }), null, 'counter-example: a folder with no node binary');
  const nix = nodeHome([['.nvm/versions/node/v14.21.3/bin', 'node'], ['.volta/tools/image/node/12.22.12/bin', 'node'], ['.local/share/mise/installs/node/10.24.1/bin', 'node'], ['.asdf/installs/nodejs/8.17.0/bin', 'node']]);
  assert.deepEqual(R.nodeDir(14, { env: {}, home: nix, platform: 'linux' }), { via: 'nvm', dir: path.join(nix, '.nvm', 'versions', 'node', 'v14.21.3', 'bin') });
  assert.equal(R.nodeDir(12, { env: {}, home: nix, platform: 'linux' }).via, 'volta');
  assert.equal(R.nodeDir(10, { env: {}, home: nix, platform: 'linux' }).via, 'mise');
  assert.equal(R.nodeDir(8, { env: {}, home: nix, platform: 'linux' }).via, 'asdf');
  assert.equal(R.nodeDir(18, { env: {}, home: nix, platform: 'linux' }), null);
});
test('6: logic — a machine outside the range runs the gates with that folder; inside it, nothing; Angular 8 and 9 come from the official table', () => {
  const d = repo(ng(10)), dir = '/n/v14.21.3';
  const found = () => ({ via: 'nvm-windows', dir });
  assert.deepEqual(R.runtimeOf(d, { machine: 24, dirOf: found }), { use: 14, from: 'angular 10', machine: 24, via: 'nvm-windows', dir, prefix: `node ${dir}` });
  const lone = R.runtimeOf(d, { machine: 24, dirOf: () => null });
  assert.deepEqual([lone.via, lone.prefix, lone.use], [null, null, 14], 'no folder: the Node that is needed is still told');
  assert.equal(R.runtimeOf(d, { machine: 14, dirOf: found }), null, 'counter-example: the machine already runs Node 14');
  assert.equal(R.runtimeOf(repo(ng(21)), { machine: 24, dirOf: found }), null, 'counter-example: a modern Angular on the machine\'s Node');
  assert.deepEqual([R.neededNode(repo(ng(9))).use, R.neededNode(repo(ng(8))).use], [12, 10]);
});
test('6: CSS/HTML — the same for a styles-only legacy fixture: the runtime is the stack\'s, not the change\'s', () => {
  const d = repo(ng(11), { 'src/styles.css': 'a{}\n', 'src/app/app.component.html': '<p></p>\n' });
  assert.equal(R.runtimeOf(d, { machine: 22, dirOf: () => ({ via: 'fnm', dir: '/f/v14' }) }).prefix, 'node /f/v14');
  assert.equal(R.runtimeOf(repo(ng(12), { 'src/styles.css': 'a{}\n' }), { machine: 14, dirOf: () => ({ via: 'fnm', dir: '/f/v14' }) }), null, 'counter-example');
});

// ---- the row, and the hook's own re-run ----
test('6: logic — the row lands once, never over one somebody wrote, and the re-run puts the folder first on the PATH, chained commands untouched', () => {
  const bin = nodeHome([['v14', process.platform === 'win32' ? 'marker.cmd' : 'marker']]), dir = path.join(bin, 'v14');
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'marker.cmd'), '@exit /b 0\r\n'); else { fs.writeFileSync(path.join(dir, 'marker'), '#!/bin/sh\nexit 0\n'); fs.chmodSync(path.join(dir, 'marker'), 0o755); }
  const d = repo(ng(10, { scripts: { typecheck: 'cd . && marker' } })), mem = path.join(d, '.waymark', 'memory.md');
  const row = R.fillRuntime(mem, d, { machine: 24, dirOf: () => ({ via: 'nvm-windows', dir }) });
  assert.equal(row, `| runtime | \`node ${dir}\` | to confirm: node 14 (angular 10), this machine runs 24 · via nvm-windows |`);
  const text = fs.readFileSync(mem, 'utf8');
  assert.ok(text.indexOf('| runtime |') > text.indexOf('| build |') && text.indexOf('| runtime |') < text.indexOf('<!-- a comment'), 'at the end of the table');
  assert.equal(R.fillRuntime(mem, d, { machine: 24, dirOf: () => ({ via: 'nvm-windows', dir }) }), null, 'once');
  const gate = gateCommand(d, mem);
  assert.equal(gate.cmd, 'npm run typecheck', 'counter-example of the old prefix: the command itself is untouched');
  assert.ok(String(Object.entries(gate.env).find(([k]) => /^path$/i.test(k))?.[1]).startsWith(dir + path.delimiter), 'the folder first on the PATH');
  const { runGate } = T;
  const ran = runGate({ cmd: 'cd . && marker', from: 'test', env: gate.env }, d);
  assert.equal(ran.ok, true, `a chained command runs with the folder first: ${JSON.stringify(ran)}`);
  assert.equal(runGate({ cmd: 'cd . && marker', from: 'test' }, d).ok, false, 'counter-example: without it the program is not found');
  const mine = repo(ng(10), {}, MEMORY.replace('| build | | |', '| build | | |\n| runtime | `nvm exec 14` | mine |'));
  assert.equal(R.fillRuntime(path.join(mine, '.waymark', 'memory.md'), mine, { machine: 24, dirOf: () => ({ via: 'nvm', dir }) }), null, 'counter-example: a row somebody wrote stays');
  assert.match(gateCommand(mine, path.join(mine, '.waymark', 'memory.md')).cmd, /^nvm exec 14 /, 'a command the user wrote is still their prefix');
  const noNode = repo(ng(10));
  assert.match(R.fillRuntime(path.join(noNode, '.waymark', 'memory.md'), noNode, { machine: 24, dirOf: () => null }), /^\| runtime \| none \(needs node 14 from angular 10: no Node 14 folder in nvm-windows, nvm, Volta, fnm, asdf or mise\) \|/);
  assert.equal(R.runtimePrefix(fs.readFileSync(path.join(noNode, '.waymark', 'memory.md'), 'utf8')), null, 'a "none" row prefixes nothing');
});
test('6: CSS/HTML — the session card tells the agent how to put the folder first in each shell, for a styles fixture as for any other', () => {
  const d = repo(ng(10), { 'src/styles.css': 'a{}\n' }, MEMORY.replace('| build | | |', '| build | | |\n| runtime | `node C:\\nvm\\v14.21.3` | to confirm |'));
  const card = digest(d);
  assert.match(card, /Runtime: .*bash: PATH=".*v14\.21\.3:\$PATH" <gate> .*PowerShell: \$env:PATH="C:\\nvm\\v14\.21\.3;\$env:PATH"; <gate>/);
  const modern = repo(ng(21), { 'src/styles.css': 'a{}\n' });
  assert.ok(!/Runtime:/.test(digest(modern)), 'counter-example: a modern repo gets no runtime line');
});

// ---- a temp config file a command makes and removes is no change ----
const Runs = await import(`file://${SCRIPTS}/runs.mjs`);
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
test('6: logic — a tsconfig made for one Karma spec and removed in the same command changes nothing; a real change in it, or a removal of what it did not make, does', () => {
  const run = "echo '{}' > tsconfig.spec.tmp.json && npx ng test --watch=false --include=src/a.spec.ts && rm tsconfig.spec.tmp.json";
  assert.deepEqual([...Runs.ephemeral(run)], ['tsconfig.spec.tmp.json']);
  assert.equal(Runs.changesProject(run), false, 'the project is as it was');
  assert.equal(Runs.splitAtChange(run), null, 'no change in it: the test run counts as after the last real change');
  assert.equal(Runs.changesProject(`${run} && sed -i s/a/b/ src/a.ts`), true, 'counter-example: the same command that also edits a source file');
  assert.equal(Runs.changesProject('rm tsconfig.spec.tmp.json'), true, 'counter-example: removing a file the command did not make');
  assert.equal(Runs.changesProject('echo x > src/new.ts'), true, 'counter-example: a file it makes and keeps');
});
test('6: CSS/HTML — the same for a styles run: a temp stylesheet made and removed is no change', () => {
  const run = "printf 'a{}' > styles.tmp.css && npx stylelint styles.tmp.css; rm -f ./styles.tmp.css";
  assert.deepEqual([...Runs.ephemeral(run)], ['styles.tmp.css']);
  assert.equal(Runs.changesProject(run), false);
  assert.equal(Runs.changesProject(`${run}; cp base.css src/app.css`), true, 'counter-example: it also copies over a real stylesheet');
});

// ---- the judgment of a legacy task ----
let ids = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input, out = 'ok', error = false) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }]; };
const head = (file) => [prompt('ajusta el componente'), say('Waymark → L2 · dept-frontend'), ...call('Skill', { skill: 'dept-frontend' }), ...call('Edit', { file_path: file })];
const CIERRE = '## Cierre · 2026-10-25 · T1\nResultado: hecho\nEvidencia: observada la salida\nAprendido: x ← y';
const judge = (lines, ctx = {}, reply = CIERRE) => cierreGaps(currentTurn(lines), reply, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj', procDelivered: ['dept-frontend'], ...ctx });
const step = (g, id) => g.steps.find((s) => s.id === id);
const LAUNCH = 'Command running in background with ID: bg7. Output is being written to: /tmp/bg7.output';
test('6: logic — a build in the background counts when its output shows success before the close; a launch nobody saw finish, or one that failed, does not', () => {
  const bg = (...after) => judge([...head('/work/proj/src/a.ts'), ...call('Bash', { command: 'pnpm run build', run_in_background: true }, LAUNCH), ...after]);
  assert.equal(step(bg(), 'build').pass, false, 'launched and never seen finish');
  assert.equal(step(bg(...call('BashOutput', { bash_id: 'bg7' }, 'Build at: 2026-10-25 - Time: 91000ms\n<exit_code>0</exit_code>')), 'build').pass, true, 'its output shows success');
  assert.equal(step(bg(...call('Read', { file_path: '/tmp/bg7.output' }, 'Compiled successfully.')), 'build').pass, true, 'read from its output file');
  assert.equal(step(bg(...call('BashOutput', { bash_id: 'bg7' }, 'ERROR in src/a.ts(3,1): error TS2322')), 'build').pass, false, 'counter-example: its output shows a failure');
  assert.equal(step(bg(...call('BashOutput', { bash_id: 'other' }, 'Build at: now')), 'build').pass, false, 'counter-example: the output of another command');
});
test('6: a build launched before an edit does not vouch for it, whenever its output is read', () => {
  const lines = [...head('/work/proj/src/a.ts'), ...call('Bash', { command: 'pnpm run build', run_in_background: true }, LAUNCH), ...call('Edit', { file_path: '/work/proj/src/a.ts' }), ...call('BashOutput', { bash_id: 'bg7' }, 'Build at: 2026-10-25\n<exit_code>0</exit_code>')];
  assert.equal(step(judge(lines), 'build').pass, false, 'it built the code as it stood at the launch');
});
test('6: logic — a short made-and-removed name is no excuse for a real change that has its letter in it', () => {
  assert.equal(Runs.changesProject('touch a && rm a && sed -i s/x/y/ src/a.ts'), true);
  assert.equal(Runs.changesProject('touch a && npx ng test && rm a'), false, 'counter-example: it only makes and removes that one');
  assert.equal(Runs.changesProject("echo '{}' >tsconfig.tmp.json && npx ng test && rm ./tsconfig.tmp.json"), false, 'a redirect with no space, a removal with ./');
});
test('6: CSS/HTML — a styles-only change in a legacy stack owes no full build; a modern one, or one that touches logic, still does', () => {
  const css = (ctx) => judge(head('/work/proj/src/app.component.css'), ctx);
  const legacy = step(css({ legacy: true }), 'build');
  assert.equal(legacy.pass, true);
  assert.match(legacy.exception || '', /legacy stack: a styles-only change needs no full build/);
  assert.equal(step(css({ legacy: false }), 'build').pass, false, 'counter-example: a modern stack');
  assert.equal(step(judge(head('/work/proj/src/app.component.ts'), { legacy: true }), 'build').pass, false, 'counter-example: logic changed');
});
test('6: a slow build declared with its time reason, and tests declared broken at HEAD, are accepted; undeclared, they are not', () => {
  const slow = judge([...head('/work/proj/src/a.ts')], { blocked: true }, `${CIERRE}\nBuild: no (el build de Angular 10 tarda 12 minutos en esta máquina)`);
  assert.equal(step(slow, 'build').pass, true);
  assert.match(step(slow, 'build').exception, /Build: no \(el build de Angular 10/);
  const red = [...head('/work/proj/src/a.ts'), ...call('Bash', { command: 'npx vitest run src/a.spec.ts' }, ' FAIL  src/a.spec.ts\n      Tests  2 failed | 3 passed (5)', true)];
  assert.ok(judge(red).missing.some((m) => /a test after the last code change failed/.test(m)), 'undeclared: the failure is the task\'s to fix');
  const declared = judge(red, { testsBroken: 'karma no arranca en esta máquina' });
  assert.ok(!declared.missing.some((m) => /a test after the last code change failed|clean copy/.test(m)), 'declared in Quality gates: the baseline\'s failure, not the task\'s');
  assert.match(step(declared, 'gate').exception || step(declared, 'preexisting').exception || '', /baseline: tests broken at HEAD \(karma no arranca/);
});
test('6: the row that declares a broken baseline is read from Quality gates, and only a test row with a reason counts', () => {
  const { testsBroken } = awaitedTestigos;
  const mem = (row) => { const d = repo(ng(10), {}, MEMORY.replace('| build | | |', `| build | | |\n${row}`)); return path.join(d, '.waymark', 'memory.md'); };
  assert.equal(testsBroken(mem('| test (full) | broken at HEAD (karma no arranca en Windows) | 2026-10-25 |')), 'karma no arranca en Windows');
  assert.equal(testsBroken(mem('| tests | broken (la suite cuelga) | |')), 'la suite cuelga');
  assert.equal(testsBroken(mem('| test (full) | broken at HEAD | |')), null, 'counter-example: no reason');
  assert.equal(testsBroken(mem('| build | broken at HEAD (tarda mucho) | |')), null, 'counter-example: not a test row');
  assert.equal(testsBroken(mem('| test (full) | `pnpm run test` | |')), null, 'counter-example: a real command');
});
const awaitedTestigos = await import(`file://${SCRIPTS}/testigos.mjs`);

// ---- git does not assume `origin`, and Windows paths are long ----
const N = await import(`file://${SCRIPTS}/notes.mjs`);
const W = await import(`file://${SCRIPTS}/waymark.mjs`);
const g = (d, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
const committed = (files) => { const d = repo(ng(10), files); g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', 'base'); return d; };
const bare = () => { const b = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bare-')); temps.push(b); g(b, 'init', '-q', '--bare'); return b; };
for (const [kind, file] of [['logic', 'src/a.ts'], ['CSS/HTML', 'src/styles.css']]) {
  test(`6: ${kind} — a repo whose only remote is not called origin takes its notes to it`, () => {
    const d = committed({ [file]: 'x\n' }), up = bare();
    assert.equal(N.defaultRemote(d), 'origin', 'counter-example: no remote at all keeps the old name');
    g(d, 'remote', 'add', 'upstream', up);
    assert.equal(N.defaultRemote(d), 'upstream', 'the only remote there is');
    assert.equal(N.hasRemote(d), true);
    g(d, 'notes', '--ref=waymark', 'add', '-m', '{}', 'HEAD');
    const r = N.pushNotes(d);
    assert.equal(r.ok, true, r.output);
    assert.match(g(up, 'for-each-ref', 'refs/notes').stdout, /refs\/notes\/waymark/, 'the notes reached the remote that exists');
    const other = bare();
    g(d, 'remote', 'add', 'origin', other);
    assert.equal(N.defaultRemote(d), 'origin', 'counter-example: with an origin, origin as before');
    g(d, 'config', `branch.${g(d, 'symbolic-ref', '--short', 'HEAD').stdout.trim()}.remote`, 'upstream');
    assert.equal(N.defaultRemote(d), 'upstream', 'the remote the branch tracks comes first');
  });
}
test('6: logic — Windows is told once to turn core.longpaths on where paths go long; elsewhere, or once on, nothing', () => {
  const node = committed({ 'src/a.ts': 'x\n' });
  assert.match(W.longpathsLine(node, { platform: 'win32' }), /core\.longpaths is not on in this repo and this is Windows \(a Node repo's node_modules.*git config core\.longpaths true.*after the user's yes/);
  assert.equal(W.longpathsLine(node, { platform: 'linux' }), '', 'counter-example: not Windows');
  g(node, 'config', 'core.longpaths', 'true');
  assert.equal(W.longpathsLine(node, { platform: 'win32' }), '', 'counter-example: already on');
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-plain-')); temps.push(plain); g(plain, 'init', '-q');
  fs.mkdirSync(path.join(plain, '.waymark')); fs.writeFileSync(path.join(plain, '.waymark', 'memory.md'), '# P\n');
  fs.writeFileSync(path.join(plain, 'a.txt'), 'x'); g(plain, 'add', '-A'); g(plain, 'commit', '-q', '-m', 'base');
  assert.equal(W.longpathsLine(plain, { platform: 'win32' }), '', 'counter-example: short paths and no Node repo');
});
test('6: CSS/HTML — a tracked stylesheet buried under a long path asks for it on any stack', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-deep-')); temps.push(d); g(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark')); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n');
  const deep = path.join('src', 'a'.repeat(70), 'b'.repeat(70));
  fs.mkdirSync(path.join(d, deep), { recursive: true }); fs.writeFileSync(path.join(d, deep, 'theme.css'), 'a{}\n');
  g(d, 'add', '-A'); g(d, 'commit', '-q', '-m', 'base');
  assert.match(W.longpathsLine(d, { platform: 'win32' }), /a tracked path is over 200 characters/);
});

test('6: the stack profile keeps its legacy section: the runtime folder, one Karma spec with CHROME_BIN, the heap of a slow build, the repo\'s lockfile first', () => {
  const text = fs.readFileSync(path.join(SCRIPTS, '..', 'stacks', 'angular.md'), 'utf8');
  const legacy = text.slice(text.indexOf('## Legacy repos'), text.indexOf('\n## ', text.indexOf('## Legacy repos') + 5));
  assert.ok(legacy.length > 100, 'the section exists');
  for (const must of [/node <folder>/, /never `nvm use`/, /--watch=false --browsers=ChromeHeadless --include=<spec file>/, /CHROME_BIN/, /--max_old_space_size=4096/, /lockfile win/, /Angular 8 runs on Node 10, 9 on Node 12/]) assert.match(legacy, must);
  assert.doesNotMatch(legacy, /volta run --node|fnm exec/, 'counter-example: the old command prefix is gone');
});
