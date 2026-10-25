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
const { gateCommand } = await import(`file://${SCRIPTS}/testigos.mjs`);
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
test('6: logic — a machine outside the range runs the gates through the manager it has; inside it, nothing', () => {
  const d = repo(ng(10));
  assert.deepEqual(R.runtimeOf(d, { machine: 24, has: volta }), { use: 14, from: 'angular 10', machine: 24, via: 'volta', prefix: 'volta run --node 14' });
  assert.equal(R.runtimeOf(d, { machine: 24, has: fnm }).prefix, 'fnm exec --using=14');
  const lone = R.runtimeOf(d, { machine: 24, has: none });
  assert.deepEqual([lone.via, lone.prefix, lone.use], [null, null, 14], 'no manager: the Node that is needed is still told');
  assert.equal(R.runtimeOf(d, { machine: 14, has: volta }), null, 'counter-example: the machine already runs Node 14');
  assert.equal(R.runtimeOf(repo(ng(21)), { machine: 24, has: volta }), null, 'counter-example: a modern Angular on the machine\'s Node');
});
test('6: CSS/HTML — the same for a styles-only legacy fixture: the runtime is the stack\'s, not the change\'s', () => {
  const d = repo(ng(11), { 'src/styles.css': 'a{}\n', 'src/app/app.component.html': '<p></p>\n' });
  assert.equal(R.runtimeOf(d, { machine: 22, has: volta }).prefix, 'volta run --node 14');
  assert.equal(R.runtimeOf(repo(ng(12), { 'src/styles.css': 'a{}\n' }), { machine: 14, has: volta }), null, 'counter-example');
});

// ---- the row, and the hook's own re-run ----
test('6: logic — the row lands once in Quality gates, never over one somebody wrote, and the re-run starts with its prefix', () => {
  const d = repo(ng(10)), mem = path.join(d, '.waymark', 'memory.md');
  const row = R.fillRuntime(mem, d, { machine: 24, has: volta });
  assert.match(row, /^\| runtime \| `volta run --node 14` \| to confirm: node 14 \(angular 10\), this machine runs 24 · via volta \|$/);
  const text = fs.readFileSync(mem, 'utf8');
  assert.ok(text.indexOf('| runtime |') > text.indexOf('| build |') && text.indexOf('| runtime |') < text.indexOf('<!-- a comment'), 'at the end of the table');
  assert.equal(R.fillRuntime(mem, d, { machine: 24, has: volta }), null, 'once');
  assert.equal(R.runtimePrefix(text), 'volta run --node 14');
  const gate = gateCommand(d, mem);
  assert.match(gate.cmd, /^volta run --node 14 /, 'the hook\'s own re-run runs on the repo\'s Node');
  assert.equal(gate.runtime, 'volta run --node 14');
  const mine = repo(ng(10), {}, MEMORY.replace('| build | | |', '| build | | |\n| runtime | `nvm exec 14` | mine |'));
  assert.equal(R.fillRuntime(path.join(mine, '.waymark', 'memory.md'), mine, { machine: 24, has: volta }), null, 'counter-example: a row somebody wrote stays');
  assert.equal(R.fillRuntime(path.join(repo(ng(21)), '.waymark', 'memory.md'), repo(ng(21)), { machine: 24, has: volta }), null, 'counter-example: nothing needed, nothing written');
  const noManager = repo(ng(10));
  assert.match(R.fillRuntime(path.join(noManager, '.waymark', 'memory.md'), noManager, { machine: 24, has: none }), /^\| runtime \| none \(needs node 14 from angular 10: no volta or fnm on this machine\) \|/);
  assert.equal(R.runtimePrefix(fs.readFileSync(path.join(noManager, '.waymark', 'memory.md'), 'utf8')), null, 'a "none" row prefixes nothing');
});
test('6: CSS/HTML — the session card carries the row for a styles fixture as for any other, and says when no manager can run the Node', () => {
  const d = repo(ng(10), { 'src/styles.css': 'a{}\n' });
  const card = digest(d);
  assert.match(card, /Runtime: (none \(needs node 14 from angular 10|this machine's Node is not the one this repo needs .*"volta run --node 14"|this machine's Node is not the one this repo needs .*"fnm exec --using=14")/);
  assert.match(fs.readFileSync(path.join(d, '.waymark', 'memory.md'), 'utf8'), /\| runtime \|/);
  const modern = repo(ng(21), { 'src/styles.css': 'a{}\n' });
  assert.ok(!/Runtime:/.test(digest(modern)), 'counter-example: a modern repo gets no runtime line');
});
