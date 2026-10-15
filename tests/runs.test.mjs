// Waymark 2.0.15 · point 2: one classifier for what a shell command runs (runs.mjs). Run: node --test tests/runs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const R = await import(`file://${SCRIPTS}/runs.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

test('provenance.mjs re-exports the shell parsing that moved to runs.mjs', () => {
  for (const name of ['shellSkeleton', 'shellRuns', 'mutatesFiles', 'changesProject']) assert.equal(P[name], R[name], name);
});

test('commandKind: the strongest part of the chain decides; the rest is aux', () => {
  assert.equal(R.commandKind('npx tsc --noEmit'), 'gate');
  assert.equal(R.commandKind('pnpm exec vitest run src/a.spec.ts'), 'test');
  assert.equal(R.commandKind('npm run build 2>&1 | tail -5'), 'build');
  assert.equal(R.commandKind('cd ../api && npm test && npm run build'), 'build');
  assert.equal(R.commandKind('git commit -m "fix build"'), 'aux', 'a word in an argument is no build');
  assert.equal(R.commandKind('ls build'), 'aux');
  assert.equal(R.commandKind('node scripts/tmp-inspect.mjs'), 'aux');
  assert.equal(R.commandKind('bash -c "npm test"'), 'test', 'judged inside bash -c');
});

test('commandKind: a clean copy is never a gate, however it runs', () => {
  assert.equal(R.commandKind('T=/tmp/wt-clean && git worktree add -q --detach "$T" HEAD && cd "$T" && npm test'), 'copy');
  const copies = R.copyPaths(['T=/tmp/wt-clean && git worktree add -q --detach "$T" HEAD']);
  assert.deepEqual(copies, ['/tmp/wt-clean']);
  assert.equal(R.commandKind('cd /tmp/wt-clean && pnpm exec eslint src/a.ts', copies), 'copy', 'a later call naming the copy');
  assert.equal(R.commandKind('pnpm exec eslint src/a.ts', copies), 'gate', 'the same run outside it');
});

test('copyPath: the target of git worktree add, direct or through its variable, windows paths too', () => {
  assert.equal(R.copyPath('git worktree add -q --detach C:\\Users\\u\\Temp\\wt-clean HEAD'), 'c:/users/u/temp/wt-clean');
  assert.equal(R.copyPath('git worktree add -b x /tmp/wt-b HEAD'), '/tmp/wt-b');
  assert.equal(R.copyPath('git worktree add ../relative HEAD'), null, 'a relative path names no copy to match later');
  assert.equal(R.slash('/c/Users/u/x/'), 'c:/users/u/x');
});
