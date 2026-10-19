// Waymark 2.0.15 · point 5: one definition of the path, file and git helpers (scripts/lib). Run: node --test tests/lib.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const L = {
  paths: await import(`file://${SCRIPTS}/lib/paths.mjs`),
  fs: await import(`file://${SCRIPTS}/lib/fs.mjs`),
  git: await import(`file://${SCRIPTS}/lib/git.mjs`),
};
const packed = await import(`file://${SCRIPTS}/lib/packed.mjs`);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wm-lib-'));

// A folder reached through a junction (Windows) or a symlink (POSIX) is spelled two ways, as an 8.3 short name
// (C:\Users\RUNNER~1) and its long name are: git reports one, the agent types the other.
const linked = () => {
  const base = tmp(), target = path.join(base, 'Target');
  fs.mkdirSync(path.join(target, 'src'), { recursive: true });
  const link = path.join(base, 'link');
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  return { target, link };
};

test('real: a path as the filesystem spells it, links resolved, the missing tail kept on its nearest existing folder', () => {
  const { target, link } = linked();
  assert.equal(L.paths.norm(L.paths.real(path.join(link, 'src'))), L.paths.norm(fs.realpathSync.native(path.join(target, 'src'))));
  assert.equal(L.paths.norm(L.paths.real(path.join(link, 'src', 'new', 'a.ts'))), L.paths.norm(path.join(fs.realpathSync.native(target), 'src', 'new', 'a.ts')), 'a file not written yet');
});

test('exemptPath: a project file spelled through another name of its folder is still the project\'s', () => {
  const { target, link } = linked();
  assert.equal(L.paths.exemptPath(path.join(link, 'src', 'a.ts'), target), false, 'the file through the link, the root as git reports it');
  assert.equal(L.paths.exemptPath(path.join(target, 'src', 'a.ts'), link), false, 'and the other way round');
});

test('norm: forward slashes, lower case, no trailing slash — one answer for every caller', () => {
  const { norm } = L.paths;
  assert.equal(norm('C:\\Users\\Dev\\Proj\\'), 'c:/users/dev/proj');
  assert.equal(norm('/Home/Me/Proj//'), '/home/me/proj');
  assert.equal(norm(null), '');
  assert.equal(norm(undefined), '');
  assert.equal(norm('a/b.TXT'), 'a/b.txt');
});

test('norm keeps a filesystem root addressable: a prefix test with "/" after it still works', () => {
  const { norm } = L.paths;
  assert.equal(norm('C:\\'), 'c:/');
  assert.equal(norm('/'), '/');
  assert.ok(norm('C:\\Users\\x').startsWith(norm('C:\\')));
});

test('slash only swaps separators (case and trailing slash stay)', () => {
  assert.equal(L.paths.slash('C:\\A\\B\\'), 'C:/A/B/');
});

test('waymarkHome reads WAYMARK_HOME at call time, else ~/.waymark', () => {
  const old = process.env.WAYMARK_HOME;
  try {
    process.env.WAYMARK_HOME = '/x/y';
    assert.equal(L.paths.waymarkHome(), '/x/y');
    delete process.env.WAYMARK_HOME;
    assert.equal(L.paths.waymarkHome(), path.join(os.homedir(), '.waymark'));
  } finally { if (old === undefined) delete process.env.WAYMARK_HOME; else process.env.WAYMARK_HOME = old; }
});

test('read / readJson: a missing or broken file gives the fallback, never throws', () => {
  const d = tmp(), f = path.join(d, 'a.json');
  assert.equal(L.fs.read(f), '');
  assert.equal(L.fs.read(f, null), null);
  assert.equal(L.fs.readJson(f), null);
  assert.deepEqual(L.fs.readJson(f, {}), {});
  fs.writeFileSync(f, '{nope');
  assert.equal(L.fs.readJson(f), null);
  fs.writeFileSync(f, '{"a":1}');
  assert.deepEqual(L.fs.readJson(f), { a: 1 });
  assert.equal(L.fs.read(f), '{"a":1}');
});

test('writeJson creates the folder and writes readable JSON', () => {
  const d = tmp(), f = path.join(d, 'deep', 'er', 'x.json');
  L.fs.writeJson(f, { ok: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { ok: true });
});

test('git runs in the given folder and returns the spawn result', () => {
  const d = tmp();
  const init = L.git.git(d, ['init', '-q']);
  assert.equal(init.status, 0);
  const top = L.git.git(d, ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  assert.equal(top.status, 0);
  assert.equal(L.paths.norm(top.stdout.trim()), L.paths.norm(fs.realpathSync.native(d)), 'git reports the long name of an 8.3 short one');
});

test('no script defines its own copy of these helpers any more', () => {
  const files = [];
  const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'lib') walk(p); } else if (/\.mjs$/.test(e.name)) files.push(p); } };
  walk(SCRIPTS);
  const OWN = [
    [/^const read = \(p\) => \{ try \{ return fs\.readFileSync/m, 'read'],
    [/^const readJson = \(\w+\) => \{ try \{ return JSON\.parse\(fs\.readFileSync/m, 'readJson'],
    [/^const HOME = \(\) => process\.env\.WAYMARK_HOME/m, 'HOME()'],
    [/^const HOME = process\.env\.WAYMARK_HOME/m, 'HOME'],
    [/^const norm = \(p\) => String\(p \|\| ''\)\.replace\(/m, 'norm'],
    [/^const slash = \(\w+\) => (String\(\w+\)|\w+)\.replace\(\/\\\\\/g, '\/'\);/m, 'slash'],
  ];
  const found = [];
  for (const f of files) { const src = fs.readFileSync(f, 'utf8'); for (const [re, name] of OWN) if (re.test(src)) found.push(`${path.relative(SCRIPTS, f)}: ${name}`); }
  assert.deepEqual(found, []);
});

test('packedFiles lives in lib/packed.mjs: the files whose pack this task already got', () => {
  const { packedFiles } = packed;
  const d = tmp(), f = path.join(d, '.packed.json');
  assert.equal(packedFiles('s1', 0, f).size, 0);
  fs.writeFileSync(f, JSON.stringify({ s1: { since: 5, files: ['a', 'b'] } }));
  assert.deepEqual([...packedFiles('s1', 5, f)], ['a', 'b']);
  assert.equal(packedFiles('s1', 6, f).size, 0, 'another task: nothing handed over yet');
  assert.equal(packedFiles('other', 5, f).size, 0);
});

test('no hook imports from another hook', () => {
  for (const [file, other] of [['stop-hook.mjs', 'tool-hook.mjs'], ['tool-hook.mjs', 'stop-hook.mjs']]) {
    assert.ok(!new RegExp(`from '\\./${other.replace('.', '\\.')}'`).test(fs.readFileSync(path.join(SCRIPTS, file), 'utf8')), `${file} imports ${other}`);
  }
});
