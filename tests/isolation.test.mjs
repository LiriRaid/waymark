// Test isolation and the scratch rule: a test never reads the real home or the running session's environment; a project
// that lives under a scratch folder is still a project; Waymark's own .gitignore lines never read as the turn's change.
// Run: node --test tests/*.test.mjs
import { REAL_HOME, SANDBOX } from './helpers/isolate.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const { exemptPath } = await import(`file://${SCRIPTS}/lib/paths.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

test('isolation: the home is a sandbox and nothing of the session\'s environment is inherited', () => {
  assert.notEqual(path.resolve(os.homedir()), path.resolve(REAL_HOME), 'os.homedir() is not the real home');
  assert.equal(path.resolve(os.homedir()), path.resolve(SANDBOX));
  assert.ok(path.resolve(process.env.WAYMARK_HOME).startsWith(path.resolve(SANDBOX)), 'WAYMARK_HOME lives in the sandbox');
  const left = Object.keys(process.env).filter((k) => /^(CLAUDE|CODEX_|GEMINI_|CURSOR_|COPILOT_|XDG_)/i.test(k) || (/^WAYMARK_/.test(k) && !/^WAYMARK_(HOME|TEST_)/.test(k)));
  assert.deepEqual(left, [], 'no variable of the session that runs the tests');
});

test('isolation: a poisoned environment is scrubbed when the helper loads', () => {
  const env = { ...process.env, WAYMARK_TEST_SANDBOX: '', CLAUDE_CONFIG_DIR: '/poison/claude', CODEX_HOME: '/poison/codex', WAYMARK_REVIEW_MODE: 'never', WAYMARK_HOME: '/poison/waymark' };
  delete env.WAYMARK_TEST_SANDBOX;
  const code = `const h = await import(${JSON.stringify(`file://${path.join(ROOT, 'tests', 'helpers', 'isolate.mjs')}`)}); console.log(JSON.stringify({ c: process.env.CLAUDE_CONFIG_DIR, x: process.env.CODEX_HOME, r: process.env.WAYMARK_REVIEW_MODE, w: process.env.WAYMARK_HOME, s: h.SANDBOX }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.deepEqual([out.c, out.x, out.r], [undefined, undefined, undefined]);
  assert.ok(out.w.startsWith(out.s), 'WAYMARK_HOME was repointed into the new sandbox');
});

test('scratch rule: a project under a scratch folder is a project; the routine\'s own files and other scratch stay exempt', () => {
  const tmp = os.tmpdir();
  const root = path.join(tmp, 'checkout');
  assert.equal(exemptPath(path.join(root, 'src', 'a.ts')), true, 'with no project root, temp is scratch');
  assert.equal(exemptPath(path.join(root, 'src', 'a.ts'), root), false, 'a checkout under temp: its files count');
  assert.equal(exemptPath(path.join(tmp, 'other', 'b.ts'), root), true, 'temp outside the project root stays scratch');
  assert.equal(exemptPath(path.join(root, '.waymark', 'memory.md'), root), true, 'Waymark\'s memory in the project is never the project\'s change');
  assert.equal(exemptPath(path.join(root, '.waymark'), root), true, 'a directory entry, as git lists an untracked folder');
  assert.equal(exemptPath(path.join(tmp, 'a.ts'), tmp), true, 'the temp folder itself is never a project root');
  assert.equal(exemptPath(path.join(os.homedir(), 'proyecto', 'a.ts'), path.join(os.homedir(), 'proyecto')), false);
});

test('first prompt: Waymark\'s own ignore lines are written before the snapshot, so the turn sees no change', () => {
  const repo = fs.mkdtempSync(path.join(os.homedir(), 'first-prompt-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  const session = `s-first-${Math.random()}`;
  spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { input: JSON.stringify({ cwd: repo, session_id: session, prompt: 'hola' }), env: process.env, encoding: 'utf8' });
  assert.ok(/\.waymark/.test(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')), 'the ignore lines are there');
  assert.equal(fs.existsSync(path.join(repo, '.gitignore')), false, 'and no .gitignore was written into the repo');
  assert.deepEqual(P.turnChanged(session, repo), [], 'and are not the turn\'s change');
});
