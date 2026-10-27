// Waymark 2.0.18 · point 1: a suite with nothing skipped, todo or failing, and a CI that runs it. Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = await import(`file://${ROOT}/scripts/gate-tests.mjs`);
// The pattern the scorecard's check 4.2 uses, read from its definition so the two cannot drift.
const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'scorecard.json'), 'utf8'));
const hygiene = card.criteria.flatMap((k) => k.checks).find((c) => c.id === '4.2');
const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.mjs'));

test('hygiene: no test file skips, marks todo or restricts a test (a skipped test is not a pass)', () => {
  const re = new RegExp(hygiene.pattern, hygiene.flags);
  assert.deepEqual(files.filter((f) => re.test(fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8'))), []);
  const [skip, todo, only] = ['sk', 'to', 'on'].map((p, i) => p + ['ip', 'do', 'ly'][i]); // built from parts: this file must not contain what it forbids
  assert.ok(re.test(`test('x', { ${skip}: true }, f)`) && re.test(`test.${todo}('x')`) && re.test(`it.${only}('x', f)`) && !re.test(`assert.equal(plan.${skip}, undefined)`), 'the pattern finds the three forms and leaves a property named skip alone');
});

test('hygiene: no corpus case is expected to be red; every case must be green', () => {
  for (const f of fs.readdirSync(path.join(ROOT, 'tests', 'corpus')).filter((x) => x.endsWith('.json'))) {
    assert.equal('redUntil' in JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'corpus', f), 'utf8')), false, f);
  }
});

test('gate-tests: the summary of the runner is read, and anything but skipped 0, todo 0, fail 0 is a problem', () => {
  const out = (o) => [['tests', 10], ['suites', 0], ['pass', 10], ['fail', 0], ['cancelled', 0], ['skipped', 0], ['todo', 0]].map(([k, v]) => `ℹ ${k} ${o[k] ?? v}`).join('\n');
  const clean = Object.fromEntries([['tests', 10], ['pass', 10], ['fail', 0], ['cancelled', 0], ['skipped', 0], ['todo', 0]]);
  assert.deepEqual(G.summarize(out({})), clean);
  assert.equal(G.problems(G.summarize(out({}))), '');
  assert.equal(G.problems(G.summarize(out({ pass: 9, skipped: 1 }))), '1 skipped');
  assert.equal(G.problems(G.summarize(out({ pass: 9, ['to' + 'do']: 1 }))), '1 todo');
  assert.equal(G.problems(G.summarize(out({ pass: 8, fail: 1, cancelled: 1 }))), '1 failed, 1 cancelled');
  assert.equal(G.problems(G.summarize(out({ tests: 0, pass: 0 }))), 'no test ran');
  assert.match(G.problems(G.summarize('ℹ tests 3')), /no summary/, 'a cut or crashed run has no summary and is not clean');
});

test('gate-tests: a run that is not clean prints why each test failed, not only its name, without the stack frames', () => {
  const out = ['✔ fine (1ms)', '✖ uninstall: restores mcp-fit (2ms)', 'ℹ fail 1', '✖ failing tests:', '', 'test at tests/agents.test.mjs:238:1', '✖ uninstall: restores mcp-fit (2ms)',
    '  AssertionError [ERR_ASSERTION]: only the rules mcp-fit added', '  + actual - expected', '      at TestContext.<anonymous> (file:///x/tests/agents.test.mjs:265:10)', '      at Test.run (node:internal/test_runner/test:1201:25)'].join('\n');
  const f = G.failures(out);
  assert.match(f, /uninstall: restores mcp-fit/);
  assert.match(f, /AssertionError \[ERR_ASSERTION\]: only the rules mcp-fit added/);
  assert.match(f, /tests\/agents\.test\.mjs:238/);
  assert.doesNotMatch(f, /node:internal/, 'no stack frames');
  assert.equal(G.failures('✔ fine\nℹ fail 0'), '', 'a clean run prints nothing');
});

test('ci: verify.yml runs the gate and verify on push, pull request and tag, in two systems, with every third-party action pinned to a commit', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
  assert.match(y, /^on:\s*\n(\s+.*\n)*?\s+push:/m);
  assert.match(y, /pull_request:/);
  assert.match(y, /tags:\s*\[\s*'v\*'\s*\]/);
  assert.match(y, /node scripts\/gate-tests\.mjs/);
  assert.match(y, /waymark\.mjs verify\s*$/m);
  assert.match(y, /waymark\.mjs verify --install\s*$/m, 'the files against the manifest on every push and pull request');
  assert.match(y, /verify --install --require-signature/, 'the signature, required on a release tag');
  assert.match(y, /ubuntu-latest/);
  assert.match(y, /windows-latest/);
  const uses = [...y.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 2);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${u} is pinned to a commit`);
  assert.match(y, /permissions:\s*\n\s+contents: read/, 'a read-only token');
});

// 2.0.19 point 9a: the faster CI. A branch is checked by its pull request; Windows runs one pass there, the release tag keeps three on both systems.
test('ci: push runs only on main and on tags; exactly one gate step runs per system and event, and the release tag runs the three passes everywhere', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'verify.yml'), 'utf8');
  assert.match(y, /push:\s*\n\s+branches: \[main\]\s*\n\s+tags: \['v\*'\]/, 'a branch is checked by its pull request, not twice');
  assert.match(y, /^\s+pull_request:/m);
  const steps = y.split(/\n\s+- name: /).slice(1).filter((s) => /node scripts\/gate-tests\.mjs/.test(s));
  const once = steps.find((s) => /gate-tests\.mjs --once/.test(s)), full = steps.find((s) => !/--once/.test(s));
  assert.ok(once && full && steps.length === 2, 'one step with --once and one without');
  const cond = (s) => s.match(/\n\s+if: (.+)/)?.[1];
  const runs = (step, os, tag) => new Function('os', 'tag', `return ${cond(step).replace(/runner\.os/g, 'os').replace(/startsWith\(github\.ref, 'refs\/tags\/v'\)/g, 'tag').replace(/==/g, '===').replace(/!=/g, '!==')};`)(os, tag);
  for (const [os, tag, expected] of [['Linux', false, 'full'], ['Linux', true, 'full'], ['Windows', false, 'once'], ['Windows', true, 'full']]) {
    const ran = [['full', full], ['once', once]].filter(([, s]) => runs(s, os, tag)).map(([n]) => n);
    assert.deepEqual(ran, [expected], `${os} ${tag ? 'tag' : 'branch or pull request'}`);
  }
});

test('gate-tests: the runs are bounded to a few files at once, so a busy machine does not time out', () => {
  assert.equal(G.CONCURRENCY, 4);
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'gate-tests.mjs'), 'utf8');
  assert.equal([...src.matchAll(/--test-concurrency=\$\{CONCURRENCY\}/g)].length, 2, 'the default run and the copy are bounded');
  assert.match(src, /'--test-concurrency=1'/, 'the one-at-a-time run is unchanged');
});

test('gate-tests: the third run copies what git holds — a tracked file as it is now, never an untracked one (notes or plans of the author)', async () => {
  const os = await import('node:os'), { spawnSync } = await import('node:child_process');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-gatecopy-'));
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.mjs'), 'export const a = 1;\n'); fs.writeFileSync(path.join(repo, 'app.css'), '.a{}\n');
  git('add', '.'); git('commit', '-q', '-m', 'one');
  fs.writeFileSync(path.join(repo, 'a.mjs'), 'export const a = 2;\n'); // logic: an uncommitted change of a tracked file
  fs.writeFileSync(path.join(repo, 'app.css'), '.b{}\n'); // CSS/HTML: the same for a stylesheet
  fs.mkdirSync(path.join(repo, 'docs', 'plans'), { recursive: true }); fs.writeFileSync(path.join(repo, 'docs', 'plans', 'next.md'), 'draft\n');
  const copy = G.copyOfTree(repo);
  try {
    assert.equal(fs.readFileSync(path.join(copy, 'a.mjs'), 'utf8'), 'export const a = 2;\n');
    assert.equal(fs.readFileSync(path.join(copy, 'app.css'), 'utf8'), '.b{}\n');
    assert.equal(fs.existsSync(path.join(copy, 'docs', 'plans', 'next.md')), false, 'counter-example: an untracked file stays out of the copy');
  } finally { fs.rmSync(copy, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); }
});
