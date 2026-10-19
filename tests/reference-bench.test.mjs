// Waymark 2.0.18 · point 11: the reference bench (bench/reference.mjs, docs/adr/0039). It measures read-only clones of the repositories in a list that
// lives outside this repository, with no opinion and no agent; here it runs offline over the committed fixtures (the minimal trees of eight pinned
// repositories) and over trees built in a temp folder. Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'tests', 'external', 'fixtures');
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-rb-${name}-`)); temps.push(d); return d; };
const B = await import(`file://${ROOT}/bench/reference.mjs`);
const tree = (files) => { const d = tmp('tree'); for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); } return d; };
const home = tmp('home');
const bench = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'bench', 'reference.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home }, timeout: 300000 });

test('reference bench: a repository is measured by what Waymark detects, proposes and injects there, and the hooks run clean', async () => {
  const m = await B.measureRepo(path.join(FIXTURES, 'rust-cli'), { home });
  assert.deepEqual([m.stack, m.profile.slug, m.profile.exists, m.ecosystems], ['rust (cargo)', 'rust', true, ['rust']]);
  assert.deepEqual(m.draft.gates.test, 'cargo test');
  assert.deepEqual(Object.keys(m.gates), ['typecheck', 'lint', 'test', 'build'], 'a format tool is not a gate');
  for (const [g, v] of Object.entries(m.gates)) assert.equal(v.recognised, true, `${g}: ${v.command} is a gate, a test or a build to the hooks`);
  assert.deepEqual(m.hookErrors, []);
  assert.ok(m.layout.includes('src'));
  assert.ok(m.injected.card > 100 && m.injected.reminder > 50 && m.injected.fixed > 5000, JSON.stringify(m.injected));
  assert.equal(m.injected.total, m.injected.card + m.injected.reminder + m.injected.fixed);
  assert.deepEqual(B.failuresOf(m), []);
});

test('reference bench: every fixture is measured without a failure, so a regression of detection or generation shows', async () => {
  for (const f of fs.readdirSync(FIXTURES, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
    const m = await B.measureRepo(path.join(FIXTURES, f), { home });
    assert.deepEqual(B.failuresOf(m), [], `${f}: ${JSON.stringify(B.failuresOf(m))}`);
  }
});

test('reference bench: what a failure is, by kind', () => {
  const base = { stack: 'x', profile: { slug: 'x', exists: true }, ecosystems: ['x'], layout: [], assets: { files: 0 }, gates: {}, hookErrors: [] };
  assert.deepEqual(B.failuresOf({ ...base, stack: null }).map((f) => f.kind), ['no-stack'], 'an ecosystem stack-new reads and the stack module does not');
  assert.deepEqual(B.failuresOf({ ...base, profile: { slug: 'generic', exists: true } }).map((f) => f.kind), ['no-profile'], 'the generic profile for a known ecosystem');
  assert.deepEqual(B.failuresOf({ ...base, gates: { lint: { command: 'frobnicate', recognised: false }, test: { command: 'none', recognised: null } } }).map((f) => f.kind), ['gate-unknown']);
  assert.deepEqual(B.failuresOf({ ...base, hookErrors: ['session-hook.mjs: exit 1 boom'] }).map((f) => f.kind), ['hook-error']);
  assert.deepEqual(B.failuresOf({ ...base, ecosystems: [], stack: null }), [], 'a repository with nothing to detect is not a failure');
  assert.deepEqual(B.failuresOf({ ...base, ecosystems: [], stack: null, layout: ['src', 'docs', 'tools'], assets: { files: 0 } }).map((f) => f.kind), ['no-draft'], 'source folders and no manifest anyone reads');
});

test('reference bench: the agent assets a repository carries, and the orchestrator blocks in them (guest mode reads those, never edits them)', async () => {
  const d = tree({ 'CLAUDE.md': '# P\n<!-- acme-orch:persona -->\nrules\n<!-- /acme-orch:persona -->\n<!-- other-fw:memory -->\n', 'AGENTS.md': 'plain\n', '.claude/skills/x/SKILL.md': 'skill\n', '.cursor/rules/a.mdc': 'rule\n', 'src/a.txt': 'not an asset' });
  const a = B.agentAssets(d);
  assert.equal(a.files, 4);
  assert.equal(a.chars, '# P\n<!-- acme-orch:persona -->\nrules\n<!-- /acme-orch:persona -->\n<!-- other-fw:memory -->\n'.length + 'plain\n'.length + 'skill\n'.length + 'rule\n'.length);
  assert.equal(a.top[0].file, 'CLAUDE.md');
  assert.deepEqual(await B.orchestratorBlocks(d), ['acme-orch', 'other-fw'], 'every namespace that is not Waymark\'s');
  assert.deepEqual(await B.orchestratorBlocks(tree({ 'CLAUDE.md': '<!-- waymark:begin -->\nx\n<!-- waymark:end -->\n' })), [], 'Waymark\'s own block is no orchestrator');
  const m = await B.measureRepo(d, { home });
  assert.equal(m.assets.files, 4);
  assert.deepEqual(m.orchestrators, ['acme-orch', 'other-fw']);
  assert.equal(m.injected.againstAssets, Math.round((m.injected.total / m.assets.chars) * 100) / 100, 'what Waymark injects there against what the repository carries');
});

test('reference bench: the command measures the folders it is given, writes the result where it is told, and names a missing list', () => {
  const dir = tmp('dir'), out = path.join(tmp('out'), 'result.json');
  fs.cpSync(path.join(FIXTURES, 'rust-cli'), path.join(dir, 'one'), { recursive: true });
  fs.cpSync(path.join(FIXTURES, 'terraform'), path.join(dir, 'two'), { recursive: true });
  const r = bench('--dir', dir, '--out', out);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(doc.schema, 'waymark.reference-bench/v1');
  assert.deepEqual(doc.results.map((x) => [x.id, x.profile.slug, x.failures.length]), [['one', 'rust', 0], ['two', 'terraform', 0]]);
  assert.match(r.stdout, /one: rust \(cargo\) · profile rust · injected \d+ chars vs 0 of its own assets · 0 failures/);
  const none = bench('--list', path.join(home, 'nothing.json'));
  assert.equal(none.status, 1);
  assert.match(none.stdout, /no list at .*nothing\.json\. It lives outside the repository/);
});

test('reference bench: the list of repositories is outside the repository, and no tracked file names another project', () => {
  const tracked = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  assert.ok(!tracked.some((f) => /reference-repos\.json$/.test(f)), 'the list is never tracked');
  assert.match(B.LIST(), /\.waymark[\\/]reference-repos\.json$/);
  const src = fs.readFileSync(path.join(ROOT, 'bench', 'reference.mjs'), 'utf8');
  assert.doesNotMatch(src, /https?:\/\/(?!github\.com\/[^"'\s]*<)\S*github\.com\/[\w-]+\/[\w-]+/, 'no repository url in the bench itself');
});
