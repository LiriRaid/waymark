// Waymark 2.0.18 · point 4: the levers kept, each with a regression check on the replay (docs/adr/0032). Run: node --test tests/*.test.mjs
//   (a) the frozen character caps: what Waymark injects stays under them, and the replay shows the same tasks cheaper than under 2.0.17's sizes
//   (b) lazy loading: a turn that changes nothing pays only the fixed context and the reminder; procedures and pack arrive at a task's first change
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-lever-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const B = await import(`file://${ROOT}/bench/replay.mjs`);
const C = await import(`file://${ROOT}/skills/waymark/scripts/cost.mjs`);
const { packContext } = await import(`file://${ROOT}/skills/waymark/scripts/tool-hook.mjs`);
const claude = await import(`file://${ROOT}/skills/waymark/scripts/agents/claude.mjs`);
const W = { ...C.WEIGHTS, unitsOf: C.units };
const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'scorecard.json'), 'utf8'));
const frozen = (id) => card.criteria.flatMap((k) => k.checks).find((c) => c.id === id).threshold;

// What 2.0.17 injected (docs/adr/0031 baseline): the sizes the levers of this point are measured against.
const BEFORE = { ref: 'v2.0.17', fixedChars: 11815, perPromptChars: 245 };

test('(a) the injection stays under the frozen caps (checks 8.2 and 8.3), and the replay shows the same tasks cheaper than under 2.0.17', () => {
  const now = B.sizesAt('working');
  assert.ok(now.fixedChars <= frozen('8.2'), `fixed context ${now.fixedChars} > ${frozen('8.2')}`);
  assert.ok(now.perPromptChars <= frozen('8.3'), `per-prompt reminder ${now.perPromptChars} > ${frozen('8.3')}`);
  // the same recorded task replayed under each: 30 responses, the second of its session
  const task = { id: 't', level: 2, session: 's', first: false, responses: 30, units: 1_000_000, links: { routine: { responses: 3, input: 0, cacheWrite: 0, cacheRead: 3_000_000, output: 0 }, work: { responses: 25, input: 0, cacheWrite: 0, cacheRead: 25_000_000, output: 0 }, reply: { responses: 2, input: 0, cacheWrite: 0, cacheRead: 2_000_000, output: 0 } } };
  const r = B.replayTask(task, BEFORE, { ref: 'now', ...now }, W);
  assert.ok(r.deltaUnits < 0, 'less injected, less re-read');
  assert.ok(r.units < task.units && r.routineUnits < 300_000, 'the saving shows in the task and in its routine');
  assert.ok(B.injection(task, { ref: 'now', ...now }, W).units / r.units < 0.01, 'and what Waymark injects stays under 1 % of the task');
});

test('(b) lazy loading: a turn that changes nothing is handed no procedures and no pack, at any level', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-lever-proj-'));
  temps.push(repo);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.mjs'), 'x');
  fs.writeFileSync(path.join(repo, 'src', 'b.mjs'), 'y');
  const transcript = path.join(home, 'lever-session.jsonl');
  fs.writeFileSync(transcript, [{ type: 'user', uuid: 'p1', timestamp: '2026-10-17T10:00:00Z', message: { role: 'user', content: 'agrega reintentos' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c1', name: 'Skill', input: { skill: 'dept-backend', args: 'L1' } }] } }].map((l) => JSON.stringify(l)).join('\n'));
  const file = path.join(home, 'packed-lever.json');
  const call = (tool, input) => ({ tool_name: tool, tool_input: input, cwd: repo, session_id: 's-lever', transcript_path: transcript });
  for (const [tool, input] of [['Read', { file_path: path.join(repo, 'src', 'a.mjs') }], ['Grep', { pattern: 'x' }], ['Bash', { command: 'ls src' }], ['Skill', { skill: 'dept-backend' }], ['AskUserQuestion', { questions: [] }]]) {
    assert.equal(await packContext(call(tool, input), claude, file), null, `${tool}: nothing handed over`);
  }
  // the first change brings the procedures once, then each file its own pack
  const first = await packContext(call('Edit', { file_path: path.join(repo, 'src', 'a.mjs') }), claude, file);
  assert.match(first, /Waymark procedures of dept-backend/);
  const second = await packContext(call('Edit', { file_path: path.join(repo, 'src', 'b.mjs') }), claude, file);
  assert.doesNotMatch(second, /Waymark procedures/);
  assert.ok(second.length < first.length / 2, 'the second file costs a pack, not the procedures again');
  assert.equal(await packContext(call('Edit', { file_path: path.join(repo, 'src', 'b.mjs') }), claude, file), null, 'once per file and task');
});

test('(b) what is handed once stays small: every department procedures file fits in 10 KB, so the one delivery of a task costs about 1 % of a task', () => {
  const dir = path.join(ROOT, 'skills');
  const sizes = fs.readdirSync(dir).filter((d) => d.startsWith('dept-')).map((d) => [d, fs.statSync(path.join(dir, d, 'procedures.md')).size]);
  assert.equal(sizes.length, 10);
  for (const [d, n] of sizes) assert.ok(n <= 10000, `${d}/procedures.md is ${n} bytes`);
  // the worst delivery, written once and re-read in each of 30 later responses, against the mean task of the baseline (docs/adr/0031: 1.19 M units)
  const worst = Math.max(...sizes.map(([, n]) => n)) / 4;
  assert.ok(worst * W.cacheWrite + 30 * worst * W.cacheRead < 0.01 * 1_190_000, 'under 1 % of a task');
});
