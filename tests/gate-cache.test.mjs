// Waymark 2.0.20 · point 17(a): the typecheck the Stop hook runs itself is not run twice on a tree it already checked (a block that changed no code, the second Stop
// of one close). A changed file, another command or an old entry runs it again. Synthetic copy of the real pattern (ADR 0042). Run: node --test tests/gate-cache.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-gatecache-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { rerunGate } = await import(`file://${SCRIPTS}/testigos.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

const counter = (d) => `${d}-runs.txt`;
const repo = (script = 'process.exit(0)') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-gc-')); temps.push(d, counter(d));
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d });
  git('init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'a.mjs'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(d, 'check.cjs'), `require('fs').appendFileSync(${JSON.stringify(counter(d))}, 'x'); ${script}\n`);
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'p', scripts: { typecheck: 'node check.cjs' } }));
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  return d;
};
const runs = (d) => { try { return fs.readFileSync(counter(d), 'utf8').length; } catch { return 0; } };
const gate = (d) => rerunGate([path.join(d, 'src', 'a.mjs')], P.projectHome(d));

test('17a: the hook\'s own typecheck runs once on a tree it already checked; a changed file runs it again', () => {
  const d = repo();
  const first = gate(d);
  assert.equal(first.ok, true);
  assert.equal(runs(d), 1);
  const again = gate(d);
  assert.equal(runs(d), 1, 'the same tree: not run twice');
  assert.deepEqual([again.ok, again.cached], [true, true], 'the answer is the first one, marked as kept');
  fs.writeFileSync(path.join(d, 'src', 'a.mjs'), 'export const a = 2;\n');
  gate(d);
  assert.equal(runs(d), 2, 'counter-example: the code changed since');
  fs.writeFileSync(path.join(d, 'src', 'new.mjs'), 'export const b = 1;\n');
  gate(d);
  assert.equal(runs(d), 3, 'counter-example: a new file is a changed tree');
});

test('17a: a failing typecheck is kept too (the same red tree is red), and a timed-out or old entry is not trusted', () => {
  const d = repo('process.exit(1)');
  assert.equal(gate(d).ok, false);
  const again = gate(d);
  assert.deepEqual([runs(d), again.ok, again.cached], [1, false, true], 'the same red tree');
  const file = path.join(home, '.gate-cache.json');
  const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of Object.keys(cache)) cache[k].at -= 21 * 60000;
  fs.writeFileSync(file, JSON.stringify(cache));
  gate(d);
  assert.equal(runs(d), 2, 'counter-example: an entry older than twenty minutes is run again');
});
