// Waymark 2.0.18 · point 11: `waymark.mjs adapter-new <agent>` drafts an adapter and runs the conformance suite on it (docs/adr/0039).
// A draft is judged by the same cases as the eight adapters, in a copy of the skills where it is registered; it installs only if it passes.
// Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-an-${name}-`)); temps.push(d); return d; };
const A = await import(`file://${ROOT}/skills/waymark/scripts/adapter-new.mjs`);
const FLAGS = ['--shell', 'bash', '--edit', 'edit|write|multiedit', '--read', 'view'];

// A repository of its own in a temp folder (the skills, the conformance suite, the adapters' docs): the command installs into it, never into this one.
function repoCopy() {
  const d = tmp('repo');
  fs.cpSync(path.join(ROOT, 'skills'), path.join(d, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
  for (const f of ['conformance', 'helpers', 'conformance.test.mjs']) fs.cpSync(path.join(ROOT, 'tests', f), path.join(d, 'tests', f), { recursive: true });
  fs.mkdirSync(path.join(d, 'adapters'));
  return d;
}
const cli = (repo, home, ...args) => spawnSync(process.execPath, [path.join(repo, 'skills', 'waymark', 'scripts', 'adapter-new.mjs'), ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home }, timeout: 15 * 60 * 1000 });

test('adapter-new: the draft is the template with this agent\'s tools, its folder and its instructions file, and it is valid JavaScript', () => {
  const a = A.facts('crush', { shell: 'bash', edit: 'edit|write|multiedit', read: 'view' });
  assert.deepEqual([a.name, a.dir, a.instructions, a.known], ['Crush', '$XDG/crush', 'CRUSH.md', true], 'what agents.json knows of it');
  const f = A.draftFiles(a);
  assert.match(f.adapter, /export const name = 'crush';/);
  assert.match(f.adapter, /if \(\/\^\(bash\)\$\/\.test\(tool\)\) return \{ command:/);
  assert.match(f.adapter, /\/\^\(edit\|write\|multiedit\)\$\/\.test\(tool\)\) return \{ files:/);
  assert.match(f.adapter, /\[\/\^\(bash\)\$\/, 'Bash'\]/, 'its tool names are read back as the core\'s');
  assert.match(f.adapter, /export const preContext = true;/);
  assert.match(f.adapter, /TODO\(docs\)/, 'what only its documentation can say is marked');
  assert.doesNotMatch(f.adapter, /<(key|Agent|shell tool|edit tools|\.agent|INSTRUCTIONS)>/, 'no placeholder of the template is left');
  assert.deepEqual([f.entry.key, f.entry.adapter, f.entry.hooks.matcher], ['crush', 'crush', 'bash|edit|write|multiedit|view']);
  const dir = tmp('check');
  fs.writeFileSync(path.join(dir, 'crush.mjs'), f.adapter);
  fs.writeFileSync(path.join(dir, 'driver.mjs'), f.driver.replace('__COMMON__', './common.mjs'));
  for (const file of ['crush.mjs', 'driver.mjs']) { const r = spawnSync(process.execPath, ['--check', path.join(dir, file)], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
});

test('adapter-new: an agent Waymark does not know is drafted with its own entry', () => {
  const a = A.facts('newagent', { name: 'New Agent', dir: '~/.newagent', instructions: 'RULES.md' });
  assert.equal(a.known, false);
  const f = A.draftFiles(a);
  assert.deepEqual([f.entry.key, f.entry.name, f.entry.dir, f.entry.instructions, f.entry.adapter], ['newagent', 'New Agent', '~/.newagent', 'RULES.md', 'newagent']);
});

test('adapter-new: registering puts the module in the agents folder, its import and its place in AGENTS, and its entry in agents.json', async () => {
  const copy = tmp('register');
  fs.cpSync(path.join(ROOT, 'skills'), copy, { recursive: true });
  const a = A.facts('crush', { shell: 'bash', edit: 'edit|write', read: 'view' });
  A.register(copy, a, A.draftFiles(a));
  const idx = fs.readFileSync(path.join(copy, 'waymark', 'scripts', 'agents', 'index.mjs'), 'utf8');
  assert.match(idx, /import \* as crush from '\.\/crush\.mjs';/);
  assert.match(idx, /export const AGENTS = \{ amp, antigravity, claude, codex, copilot, crush, cursor, droid, gemini, kiro, opencode, qwen \};/);
  const M = await import(`file://${copy}/waymark/scripts/agents/index.mjs`);
  assert.equal(M.AGENTS.crush.name, 'crush');
  assert.equal(M.agentFrom(['node', 'x', '--agent', 'crush']).name, 'crush');
  const entries = JSON.parse(fs.readFileSync(path.join(copy, 'waymark', 'scripts', 'agents', 'agents.json'), 'utf8')).agents;
  assert.equal(entries.filter((e) => e.key === 'crush').length, 1, 'its entry is replaced, not added twice');
  assert.equal(entries.find((e) => e.key === 'crush').adapter, 'crush');
  A.register(copy, a, A.draftFiles(a)); // twice: still one import
  assert.equal((fs.readFileSync(path.join(copy, 'waymark', 'scripts', 'agents', 'index.mjs'), 'utf8').match(/import \* as crush/g) || []).length, 1);
});

test('adapter-new: a draft that breaks the list is told which cases, and does not install; adapted until it passes, it does', () => {
  const repo = repoCopy(), home = tmp('home'), agentsDir = path.join(repo, 'skills', 'waymark', 'scripts', 'agents');
  const first = cli(repo, home, 'crush', ...FLAGS, '--no-run');
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const draft = path.join(home, 'drafts', 'adapters', 'crush');
  assert.deepEqual(fs.readdirSync(draft).sort(), ['agents.entry.json', 'crush.driver.mjs', 'crush.md', 'crush.mjs'], 'an untracked draft in the private layer');
  assert.equal(fs.existsSync(path.join(agentsDir, 'crush.mjs')), false, 'nothing installed');
  assert.match(first.stdout, /Not installed/);

  // the user's adaptation went wrong: a denial that is not one
  const file = path.join(draft, 'crush.mjs');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("permissionDecision: 'deny'", "permissionDecision: 'nope'"));
  const bad = cli(repo, home, 'crush', ...FLAGS, '--install'); // the yes is asked of a draft that does not pass
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /conformance: \d+ of \d+ checks pass · \d+ fail: .*gate\.edit-denied-before-the-choice-window/);
  assert.match(bad.stdout, /the draft in /, 'the draft already there is judged as it is');
  assert.match(bad.stdout, /not installed: a new adapter passes the conformance list or it does not install/);
  assert.equal(fs.existsSync(path.join(agentsDir, 'crush.mjs')), false, 'a draft that fails is never installed');

  // adapted: it passes, and the yes installs it
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("permissionDecision: 'nope'", "permissionDecision: 'deny'"));
  const ok = cli(repo, home, 'crush', ...FLAGS, '--install');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /conformance: (\d+) of \1 checks pass/);
  assert.match(ok.stdout, /installed: agents\/crush\.mjs/);
  assert.ok(fs.existsSync(path.join(agentsDir, 'crush.mjs')));
  assert.match(fs.readFileSync(path.join(agentsDir, 'index.mjs'), 'utf8'), /import \* as crush/);
  assert.ok(fs.existsSync(path.join(repo, 'adapters', 'crush.md')));
  const driver = fs.readFileSync(path.join(repo, 'tests', 'conformance', 'agents', 'crush.mjs'), 'utf8');
  assert.match(driver, /from '\.\/common\.mjs'/, 'the installed driver imports the shared helpers beside it, and joins the roster by being there');
  assert.equal(fs.existsSync(path.join(ROOT, 'skills', 'waymark', 'scripts', 'agents', 'crush.mjs')), false, 'this repository is untouched');
});

test('adapter-new: without the suite next to the install the draft is written and says so; an agent that already has an adapter is refused', () => {
  const repo = tmp('nosuite'), home = tmp('home2');
  fs.cpSync(path.join(ROOT, 'skills'), path.join(repo, 'skills'), { recursive: true });
  const r = cli(repo, home, 'crush', ...FLAGS);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /conformance: not run \(the conformance suite is in the repository/);
  assert.ok(fs.existsSync(path.join(home, 'drafts', 'adapters', 'crush', 'crush.mjs')));
  const installed = cli(repo, home, 'crush', ...FLAGS, '--install');
  assert.equal(installed.status, 1, 'with no suite there is nothing to prove the draft by: it does not install');
  assert.equal(cli(repo, home, 'claude').status, 1, 'an adapter that exists');
  assert.equal(cli(repo, home).status, 1, 'no agent: the usage');
});
