// Waymark 2.0.18 · point 0: the scorecard (docs/adr/0028). Run: node --test tests/*.test.mjs
// The definition is locked by the ADR's hash; the engine is checked on a small fixture repository, never on the author's records.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = await import(`file://${REPO}/skills/waymark/scripts/scorecard.mjs`);
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

// A fixture root: docs/scorecard.json plus the files its checks look at.
function fixture(criteria, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-scorecard-'));
  temps.push(root);
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  write('docs/scorecard.json', JSON.stringify({ schema: 'waymark.scorecard/v1', adr: '9999', criteria }));
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  return root;
}
const one = (checks, weight = 100) => [{ id: 1, name: 'x', weight, target: 95, checks }];

test('0: the real scorecard has weights adding to 100, unique check ids and every measure it names', () => {
  const card = S.readScorecard(REPO);
  assert.equal(card.criteria.reduce((a, k) => a + k.weight, 0), 100);
  assert.deepEqual(card.criteria.map((k) => k.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  const checks = card.criteria.flatMap((k) => k.checks);
  assert.equal(new Set(checks.map((c) => c.id)).size, checks.length, 'a check id is used once');
  for (const c of checks) {
    assert.ok(Number.isInteger(c.point) && c.point >= 0 && c.point <= 12, `${c.id}: the plan point that makes it pass`);
    assert.ok(['exists', 'contains', 'absent', 'run', 'measure'].includes(c.kind), `${c.id}: kind`);
    if (c.kind === 'measure') {
      assert.ok(S.MEASURE_NAMES.includes(c.measure), `${c.id}: measure ${c.measure} exists`);
      if (c.threshold === null) assert.ok(Number.isInteger(c.frozenIn), `${c.id}: a pending threshold says in which point it is frozen`);
    }
  }
});

test('0: the lock in the ADR is the hash of scorecard.json; a changed weight, check or threshold breaks it, a changed about does not', () => {
  const card = S.readScorecard(REPO);
  assert.equal(S.adrLock(REPO, card), S.lockOf(card), 'docs/scorecard.json changed without a new lock in the ADR it names');
  const edit = (f) => { const c = JSON.parse(JSON.stringify(card)); f(c); return S.lockOf(c); };
  assert.notEqual(edit((c) => { c.criteria[7].weight = 14; }), S.lockOf(card), 'a weight');
  assert.notEqual(edit((c) => { c.criteria[0].checks.pop(); }), S.lockOf(card), 'a check removed');
  assert.notEqual(edit((c) => { c.criteria[0].checks[1].threshold = 0.5; }), S.lockOf(card), 'a threshold');
  assert.equal(edit((c) => { c.about = 'other words'; c.adr = '0099'; }), S.lockOf(card), 'prose and the ADR name are not locked');
});

test('0: exists, contains, absent and run score 1 or 0 and say why; the criterion is the mean and the total is never rounded up', async () => {
  const root = fixture(one([
    { id: '1', what: 'a', point: 0, kind: 'exists', files: ['a.txt', 'dir/'] },
    { id: '2', what: 'b', point: 0, kind: 'exists', files: ['missing.txt'] },
    { id: '3', what: 'c', point: 0, kind: 'contains', files: ['src/'], pattern: ['alpha', 'beta'] },
    { id: '4', what: 'd', point: 0, kind: 'contains', files: ['src/'], pattern: ['alpha', 'gamma'] },
    { id: '5', what: 'e', point: 0, kind: 'absent', files: ['src/**'], pattern: '^\\s*import .* from \'(?!node:)', flags: 'm' },
    { id: '6', what: 'f', point: 0, kind: 'absent', files: ['src/*.mjs'], pattern: 'alpha' },
    { id: '7', what: 'g', point: 0, kind: 'run', command: ['node', '-e', 'process.exit(0)'] },
    { id: '8', what: 'h', point: 0, kind: 'run', command: ['node', '-e', 'process.exit(3)'] },
  ]), { 'a.txt': 'x', 'dir/b.txt': 'y', 'src/one.mjs': 'alpha beta', 'src/two.mjs': "import x from 'node:fs'\n" });
  const r = await S.scorecard(root);
  const by = Object.fromEntries(r.criteria[0].checks.map((c) => [c.id, c]));
  assert.deepEqual(Object.values(by).map((c) => c.score), [1, 0, 1, 0, 1, 0, 1, 0]);
  assert.match(by['2'].detail, /missing: missing\.txt/);
  assert.match(by['4'].detail, /not found: gamma/);
  assert.match(by['6'].detail, /found in 1 file/);
  assert.match(by['8'].detail, /exit 3/);
  assert.equal(r.criteria[0].percent, 50);
  assert.equal(r.total, 50);
  assert.equal(r.lock, 'no lock in the ADR', 'a fixture with no ADR is not locked');
});

test('0: a ratio check scores value/threshold capped at 1, "le" inverts it, a null threshold is pending and a missing number is unmeasured', async () => {
  const root = fixture(one([
    { id: '1', what: 'ge below', point: 0, kind: 'measure', measure: 'agents.adapterShare', op: 'ge', threshold: 2 },
    { id: '2', what: 'ge above', point: 0, kind: 'measure', measure: 'agents.adapterShare', op: 'ge', threshold: 0.1 },
    { id: '3', what: 'le within', point: 0, kind: 'measure', measure: 'agents.adapterShare', op: 'le', threshold: 5 },
    { id: '4', what: 'le over', point: 0, kind: 'measure', measure: 'agents.adapterShare', op: 'le', threshold: 0.25 },
    { id: '5', what: 'pending', point: 4, kind: 'measure', measure: 'agents.adapterShare', op: 'le', threshold: null, frozenIn: 3 },
    { id: '6', what: 'not built', point: 5, kind: 'measure', measure: 'precedent.maxChars', op: 'le', threshold: 400 },
  ]));
  const r = (await S.scorecard(root)).criteria[0].checks;
  const share = r[0].value;
  assert.ok(share > 0 && share <= 1);
  assert.equal(r[0].score, share / 2);
  assert.equal(r[1].score, 1);
  assert.equal(r[2].score, 1);
  assert.equal(r[3].score, 0.25 / share);
  assert.deepEqual([r[4].status, r[4].score, r[5].status, r[5].score], ['pending', 0, 'unmeasured', 0]);
  assert.match(r[4].detail, /frozen in point 3/);
});

test('0: the total is a weighted sum and the rendered figure is cut, never rounded up', async () => {
  const root = fixture([
    { id: 1, name: 'half', weight: 60, target: 95, checks: [{ id: '1', what: 'a', point: 0, kind: 'exists', files: ['a.txt'] }, { id: '2', what: 'b', point: 0, kind: 'exists', files: ['no'] }] },
    { id: 2, name: 'all', weight: 40, target: 95, checks: [{ id: '3', what: 'c', point: 0, kind: 'exists', files: ['a.txt'] }] },
  ], { 'a.txt': 'x' });
  const r = await S.scorecard(root);
  assert.equal(r.total, 0.6 * 50 + 0.4 * 100);
  const text = S.render({ ...r, total: 94.99 });
  assert.match(text, /TOTAL 94\.9 %/, '94.99 reads 94.9, not 95');
  assert.match(S.render({ ...r, weights: 99 }), /WEIGHTS ADD TO 99/);
});

test('0: on this repository the scorecard runs, its lock holds and the plan points still to do are the failing checks', async () => {
  const r = await S.scorecard(REPO);
  assert.equal(r.lock, 'ok');
  assert.equal(r.weights, 100);
  assert.ok(r.total > 0 && r.total < 100);
  const failing = r.criteria.flatMap((k) => k.checks).filter((c) => c.status !== 'pass');
  assert.ok(failing.every((c) => c.point >= 0), 'every failing check names its point');
  // a check that holds today (point 0) is allowed to fail only by a real finding the ADR lists, never by a wrong pattern
  const known = new Set(['1.10', '9.1', '7.1']); // ADR 0028: records that lost their note; agents with hooks and no adapter; 7.1 is whether this machine has pushed its notes
  for (const c of failing.filter((x) => x.point === 0 && x.status === 'fail')) assert.ok(known.has(c.id), `${c.id} fails today and is not a recorded finding: ${c.detail}`);
});
