// Waymark 2.0.20 · point 10(b), review: a file is "new at HEAD" only when HEAD never held it under any name; a renamed or moved file is not new, so a spec of refactored code
// is still asked to be shown red. Synthetic copy of the real pattern (ADR 0042). Run: node --test tests/added-paths.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const { addedPaths } = await import(`file://${SCRIPTS}/lib/git.mjs`);
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

const repo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-added-')); temps.push(d);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d });
  git('init', '-q');
  fs.mkdirSync(path.join(d, 'src'));
  fs.writeFileSync(path.join(d, 'src', 'orders.service.mjs'), 'export const total = (xs) => xs.length;\nexport const sum = 1;\n');
  fs.writeFileSync(path.join(d, 'src', 'users.service.mjs'), 'export const u = 1;\nexport const v = 2;\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  return { d, git };
};

test('10b: a brand-new file is new at HEAD; a file HEAD already held is not', () => {
  const { d } = repo();
  fs.writeFileSync(path.join(d, 'src', 'new.service.mjs'), 'export const n = 1;\n');
  fs.appendFileSync(path.join(d, 'src', 'orders.service.mjs'), 'export const more = 2;\n');
  const added = addedPaths(d);
  assert.ok(added.has('src/new.service.mjs'), 'untracked and unknown to HEAD');
  assert.ok(!added.has('src/orders.service.mjs'), 'counter-example: modified, it existed');
});

test('10b: a renamed or moved file is not new (git mv, and a move of the same name that git was never told about)', () => {
  const { d, git } = repo();
  git('mv', 'src/orders.service.mjs', 'src/orders-v2.service.mjs');
  fs.mkdirSync(path.join(d, 'src', 'core'));
  fs.renameSync(path.join(d, 'src', 'users.service.mjs'), path.join(d, 'src', 'core', 'users.service.mjs'));
  const added = addedPaths(d);
  assert.ok(!added.has('src/orders-v2.service.mjs'), 'a staged rename pairs with the old path');
  assert.ok(!added.has('src/core/users.service.mjs'), 'an unstaged move of the same name pairs with the deleted file');
});

test('10b: no commit yet, or no repository: nothing is said to be new (the proof is asked, the safe side)', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-added-')); temps.push(d);
  assert.equal(addedPaths(d).size, 0, 'not a repository');
});
