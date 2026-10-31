// Waymark 2.0.20 · speed without losing a verdict: what a hook asks git for is asked once. The last 500 commits of HEAD are kept on disk by HEAD
// (the next hook reads them, no `git log`), and the snapshot a prompt takes asks git for the state only (no rev-parse for the root or HEAD).
// Every repo here is synthetic. Run: node --test tests/speed.test.mjs
import './helpers/isolate.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); temps.push(d); return d; };
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const repo = (commits = 3) => {
  const d = tmp('wm-speed-');
  sh(d, 'init', '-q');
  sh(d, 'config', 'user.email', 'a@b.c'); sh(d, 'config', 'user.name', 'a'); sh(d, 'config', 'commit.gpgsign', 'false');
  for (let i = 0; i < commits; i++) { fs.writeFileSync(path.join(d, `f${i}.txt`), String(i)); sh(d, 'add', '.'); sh(d, 'commit', '-q', '-m', `c${i}\n\nWaymark-Task: T${i}`); }
  return d;
};
// A child process (a hook is one): it counts the git processes it starts, by their first argument, and prints them with the result.
const probe = tmp('wm-probe-');
fs.writeFileSync(path.join(probe, 'probe.mjs'), `
import m from 'node:module';
import cp from 'node:child_process';
const o = cp.spawnSync, calls = [];
cp.spawnSync = function (c, a) { if (c === 'git') calls.push((a || [])[0]); return o.apply(this, arguments); };
m.syncBuiltinESMExports();
const [, , what, cwd] = process.argv;
let result;
if (what === 'log') { const { headLog } = await import(${JSON.stringify('file://' + SCRIPTS.replace(/\\/g, '/') + '/notes.mjs')}); const l = headLog(cwd); result = l && { n: l.length, first: l[0]?.body, files: l[0]?.files }; }
else { const { gitSnapshot } = await import(${JSON.stringify('file://' + SCRIPTS.replace(/\\/g, '/') + '/provenance/snapshot.mjs')}); const s = gitSnapshot(cwd); result = s && { root: s.root, head: s.head, files: Object.keys(s.files).map((f) => f.replace(/\\\\/g, '/').split('/').pop()).sort() }; }
console.log(JSON.stringify({ calls, result }));
`);
const run = (home, what, cwd) => {
  const r = spawnSync(process.execPath, [path.join(probe, 'probe.mjs'), what, cwd], { encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home, WAYMARK_ENGRAM: '' } });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

test('speed: the last 500 commits of HEAD are asked of git once, then read from disk by HEAD in the next process', () => {
  const home = tmp('wm-speed-home-'), d = repo(3);
  const a = run(home, 'log', d), b = run(home, 'log', d);
  assert.equal(a.calls.filter((c) => c === 'log').length, 1, 'the first process asks git');
  assert.equal(b.calls.filter((c) => c === 'log').length, 0, 'the second reads the disk');
  assert.deepEqual(b.result, a.result, 'the same commits, bodies and files');
  assert.equal(a.result.n, 3);
});

test('speed: counter-example — a new commit moves HEAD, so the log is asked again and holds it', () => {
  const home = tmp('wm-speed-home-'), d = repo(2);
  run(home, 'log', d);
  fs.writeFileSync(path.join(d, 'new.txt'), 'x'); sh(d, 'add', '.'); sh(d, 'commit', '-q', '-m', 'newest\n\nWaymark-Task: T9');
  const c = run(home, 'log', d);
  assert.equal(c.calls.filter((x) => x === 'log').length, 1, 'a moved HEAD is a miss');
  assert.equal(c.result.n, 3);
  assert.match(c.result.first, /newest/);
  assert.ok(c.result.files.includes('new.txt'));
});

test('speed: a damaged cache file is a miss, never an error or a wrong log', () => {
  const home = tmp('wm-speed-home-'), d = repo(2);
  run(home, 'log', d);
  const dir = path.join(home, 'cache', 'headlog');
  for (const f of fs.readdirSync(dir)) fs.writeFileSync(path.join(dir, f), '{ not json');
  const again = run(home, 'log', d);
  assert.equal(again.calls.filter((x) => x === 'log').length, 1);
  assert.equal(again.result.n, 2);
});

test('speed: the snapshot asks git for the state only, and reports the same root, HEAD and changed files', () => {
  const home = tmp('wm-speed-home-'), d = repo(2);
  fs.writeFileSync(path.join(d, 'f0.txt'), 'changed'); fs.writeFileSync(path.join(d, 'untracked.txt'), 'u');
  const s = run(home, 'snap', d);
  assert.deepEqual(s.calls, ['rev-parse', 'status'], 'the root (once per folder in a run, shared with the other checks) and the state; HEAD is read from the repository\'s files, it was three processes');
  assert.equal(s.result.head, sh(d, 'rev-parse', 'HEAD').stdout.trim());
  assert.equal(path.resolve(s.result.root).toLowerCase(), path.resolve(sh(d, 'rev-parse', '--show-toplevel').stdout.trim()).toLowerCase());
  assert.deepEqual(s.result.files, ['f0.txt', 'untracked.txt']);
});

test('speed: counter-example — a repository with no commit has a snapshot with no HEAD, and a folder that is no repository has none', () => {
  const home = tmp('wm-speed-home-'), d = tmp('wm-speed-empty-');
  sh(d, 'init', '-q');
  fs.writeFileSync(path.join(d, 'a.txt'), 'a');
  const s = run(home, 'snap', d);
  assert.equal(s.result.head, null);
  assert.deepEqual(s.result.files, ['a.txt']);
  assert.equal(run(home, 'snap', tmp('wm-speed-plain-')).result, null);
});
