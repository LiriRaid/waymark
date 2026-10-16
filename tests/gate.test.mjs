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
