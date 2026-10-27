// Waymark 2.0.18 · point 3: the replay bench (bench/replay.mjs, docs/adr/0031). Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
process.env.WAYMARK_SIZE_PINNED = '1'; // the reminder is measured with a typical task and git line, not this working tree's (size.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = await import(`file://${ROOT}/bench/replay.mjs`);
const C = await import(`file://${ROOT}/skills/waymark/scripts/cost.mjs`);
const W = { ...C.WEIGHTS, unitsOf: C.units };
const link = (responses, cacheRead) => ({ responses, input: 0, cacheWrite: 0, cacheRead, output: 0 });
const task = (over = {}) => ({ id: 't', level: 2, session: 's', first: false, responses: 10, units: 10000, links: { routine: link(2, 20000), work: link(7, 70000), reply: link(1, 10000) }, ...over });
const sizes = (fixedChars, perPromptChars, ref = 'x') => ({ ref, fixedChars, perPromptChars });

test('injection: the fixed context and the reminder are re-read in every response; written once (the fixed one only for a session\'s first task)', () => {
  // 4000 chars = 1000 tokens of fixed context, 400 chars = 100 tokens of reminder, 10 responses
  const a = B.injection(task(), sizes(4000, 400), W);
  assert.equal(a.reads, 10 * 1100 * 0.1);
  assert.equal(a.writes, 100 * 1.25, 'the reminder is written once; the session\'s fixed context was written by an earlier task');
  const first = B.injection(task({ first: true }), sizes(4000, 400), W);
  assert.equal(first.writes, 1000 * 1.25 + 100 * 1.25);
  assert.equal(B.injection(task({ responses: 0 }), sizes(4000, 400), W).reads, 0);
});

test('replayTask: swapping the injection changes the cost by exactly the difference, and the routine link carries its share of the reads', () => {
  const recorded = sizes(4000, 400), target = sizes(2000, 400);   // 500 tokens less of fixed context
  const r = B.replayTask(task(), recorded, target, W);
  const saved = 10 * 500 * 0.1;                                    // 500 tokens x 10 responses x 0.1
  assert.equal(r.deltaUnits, -saved);
  assert.equal(r.units, 10000 - saved);
  assert.equal(r.routineUnits, 20000 * 0.1 + -saved * (2 / 10), 'the routine link: its recorded units (cache read x 0.1 = 2000) less 2 of 10 responses of the saving');
  assert.equal(B.replayTask(task(), recorded, recorded, W).deltaUnits, 0, 'the same sizes change nothing');
});

test('replay: the same tasks under each version; a smaller injection lowers the cost and the routine share, a larger one raises them', () => {
  const tasks = [task({ session: 'a' }), task({ session: 'a', level: 1 }), task({ session: 'b', level: 3, links: null })];
  const rec = sizes(4000, 400, 'rec');
  const res = B.replay(tasks, [sizes(2000, 400, 'lean'), rec, sizes(6000, 400, 'fat')], () => rec, W);
  assert.deepEqual(res.map((x) => x.ref), ['lean', 'rec', 'fat']);
  assert.equal(res[0].tasks, 2, 'a task with no links cannot be replayed');
  assert.ok(res[0].unitsMean < res[1].unitsMean && res[1].unitsMean < res[2].unitsMean);
  assert.ok(res[0].routineShare.L2 < res[1].routineShare.L2 && res[1].routineShare.L2 < res[2].routineShare.L2);
  assert.equal(res[1].routineShare.L3, null, 'no L3 task, no share');
  assert.ok(res[1].injectionShare > 0 && res[1].injectionShare < 1);
});

test('sizesAt: the tree as it is has sizes; a ref that does not exist has none, and no worktree is left behind', () => {
  const now = B.sizesAt('working');
  assert.ok(now.fixedChars > 5000 && now.perPromptChars > 100);
  assert.equal(B.sizesAt('no-such-tag-anywhere'), null);
});

test('render: names its assumptions, so nobody reads a replay as a measurement of the agent', () => {
  const text = B.render({ schema: B.SCHEMA, assumes: 'the agent behaviour is not replayed', results: [{ ref: 'v1', fixedChars: 100, perPromptChars: 10, tasks: 3, injectionShare: 0.01, routineShare: { L1: null, L2: 0.1, L3: null }, routineShareAll: 0.1, unitsMean: 5 }] });
  assert.match(text, /Assumes: the agent behaviour is not replayed/);
  assert.match(text, /v1 · 100 · 10 · 3 · 1 % · — \/ 10 % \/ — · 5/);
});
