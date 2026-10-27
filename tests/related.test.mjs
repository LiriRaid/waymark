// Waymark 2.0.19 · speed: the tests of the files a task touched, not the whole suite. An empty `test (related)` row of memory.md's Quality gates
// is filled at session start from the repo's own runner (Vitest `related`, Jest `--findRelatedTests`), marked to confirm; the card shows it and
// the end-of-turn message that asks for a spec run names it with the spec. A row somebody wrote is never touched. Run: node --test tests/related.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const S = await import(`file://${SCRIPTS}/stack.mjs`);
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

const GATES = (related = '') => `# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | | |\n| test (related) | ${related} | |\n| test (full) | | |\n\n## Design system\n`;
const repo = (name, dev, lock, gates = GATES()) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-rel-${name}-`)); temps.push(d);
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, devDependencies: dev }));
  if (lock) fs.writeFileSync(path.join(d, lock), '');
  fs.mkdirSync(path.join(d, '.waymark')); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), gates);
  return { d, mem: path.join(d, '.waymark', 'memory.md') };
};
const row = (mem) => fs.readFileSync(mem, 'utf8').match(/^\| test \(related\) \|[^\n]*$/m)[0];

test('related: logic — a pnpm repo with Vitest gets `vitest related <files> --run`, to confirm; the run for a .ts and its spec names them', () => {
  const { d, mem } = repo('vit', { vitest: '^4.0.0', typescript: '^5.9.0' }, 'pnpm-lock.yaml');
  assert.equal(S.fillRelated(mem, d), 'pnpm exec vitest related <files> --run');
  assert.equal(row(mem), '| test (related) | `pnpm exec vitest related <files> --run` | to confirm |');
  assert.equal(S.rowProblem('pnpm exec vitest related <files> --run', d), '', 'the card shows it: a placeholder is never judged');
  assert.equal(S.relatedRun(mem, d, ['src/orders.service.ts', 'src/orders.service.spec.ts']), 'pnpm exec vitest related src/orders.service.ts src/orders.service.spec.ts --run');
  assert.equal(S.fillRelated(mem, d), null, 'written once');
});

test('related: CSS/HTML — an npm repo with Jest gets `--findRelatedTests`, and the run for a stylesheet and its spec names them', () => {
  const { d, mem } = repo('jst', { jest: '^30.0.0' }, 'package-lock.json');
  assert.equal(S.fillRelated(mem, d), 'npx jest --findRelatedTests <files>');
  assert.equal(S.relatedRun(mem, d, ['src/app.component.css', 'src/app.component.spec.ts']), 'npx jest --findRelatedTests src/app.component.css src/app.component.spec.ts');
});

test('related: counter-example — a row somebody wrote stays, a repo with no Vitest or Jest gets nothing, and no row means no run', () => {
  const own = repo('own', { vitest: '^4.0.0' }, 'pnpm-lock.yaml', GATES('`pnpm test:unit -- <files>`'));
  assert.equal(S.fillRelated(own.mem, own.d), null);
  assert.equal(row(own.mem), '| test (related) | `pnpm test:unit -- <files>` | |');
  assert.equal(S.relatedRun(own.mem, own.d, ['src/a.ts']), 'pnpm test:unit -- src/a.ts', 'the row the user wrote is the one named');
  const karma = repo('karma', { karma: '^6.4.0', '@angular/core': '^10.0.0' }, 'package-lock.json');
  assert.equal(S.fillRelated(karma.mem, karma.d), null, 'Karma has no related mode: nothing is invented');
  assert.equal(S.relatedRun(karma.mem, karma.d, ['src/a.ts']), null);
});

test('related: end to end — the session start fills the empty row and the card shows the command', async () => {
  const { spawnSync } = await import('node:child_process');
  const { d, mem } = repo('card', { vitest: '^4.0.0' }, 'pnpm-lock.yaml');
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-rel-home-')); temps.push(home);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: d }), encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /test \(related\): pnpm exec vitest related <files> --run/);
  assert.match(row(mem), /to confirm/);
});
