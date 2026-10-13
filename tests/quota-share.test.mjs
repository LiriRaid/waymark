// Point 8 of 2.0.3 — the quota shared by session: the 5-hour window is the account's, so each rise of its % is split
// among the Claude Code sessions by what each one spent (cost.total_cost_usd) since the last reading; each terminal
// shows its share and the close of a task shared with another session says its own part (docs/adr/0019, amended).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-share-t-'));
after(() => fs.rmSync(home, { recursive: true, force: true }));
process.env.WAYMARK_HOME = home;
const Q = await import(`file://${SCRIPTS}/statusline.mjs`);
const { evaluate, summaryLine } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { planStatusLine } = await import(`file://${SCRIPTS}/install-hooks.mjs`);

const RESET = 1800000000;
// A status update of one session: its cumulative cost and the 5-hour reading of its last response.
const st = (session, five, cost, resetsAt = RESET) => ({ session_id: session, cost: { total_cost_usd: cost }, context_window: { used_percentage: 10, total_input_tokens: cost * 1000, total_output_tokens: 0 },
  ...(five === null ? {} : { rate_limits: { five_hour: { used_percentage: five, resets_at: resetsAt } } }) });
const own = (id) => Math.round(Q.readQuota().sessions[id].own * 10) / 10;

test('each rise of the window is split among the sessions by the cost each spent since the last reading', () => {
  const t0 = 1799990000000;
  Q.recordStatus(st('a', 10, 1), t0); // first sight: its past cost is the baseline, nothing attributed
  Q.recordStatus(st('b', 10, 5), t0 + 1000);
  assert.deepEqual([own('a'), own('b')], [0, 0]);
  Q.recordStatus(st('a', 13, 4), t0 + 2000); // +3%, only a spent (3 USD)
  assert.deepEqual([own('a'), own('b')], [3, 0]);
  Q.recordStatus(st('b', 13, 6), t0 + 3000); // b spent 1 USD, but the reading did not rise: kept for the next rise
  Q.recordStatus(st('a', 17, 7), t0 + 4000); // +4%: a spent 3, b 1 → 3 and 1
  assert.deepEqual([own('a'), own('b')], [6, 1]);
  assert.equal(Q.statusText(st('b', 13, 6), Q.readQuota()), '5h 17% · esta sesión ≈1% · contexto 10%', 'b shows the account\'s newest reading and its share');
  assert.equal(Q.statusText(st('a', 17, 7), Q.readQuota()), '5h 17% · esta sesión ≈6% · contexto 10%');
});

test('a re-read with the same reading counts nothing twice; a rise no session paid for stays outside Claude Code', () => {
  const t0 = 1799991000000;
  const before = Q.readQuota();
  Q.recordStatus(st('b', 13, 6), t0); // refreshInterval: b's last response, unchanged
  assert.deepEqual([own('a'), own('b'), Q.readQuota().latest.five.pct], [6, 1, 17], 'the newest reading is not replaced by an old one');
  Q.recordStatus(st('a', 20, 7), t0 + 1000); // +3%, nobody spent (claude.ai, Codex)
  assert.deepEqual([own('a'), own('b')], [6, 1]);
  assert.equal(Math.round(Q.readQuota().outside.pct), 3 + Math.round(before.outside?.pct || 0));
});

test('a task shared with another session: the close says its own part, prorated by cost; never a calibration pair', () => {
  const t0 = 1799992000000;
  Q.recordStatus(st('c', 30, 1, RESET + 18000), t0); // a new window: the shares start again
  Q.recordStatus(st('d', 30, 1, RESET + 18000), t0 + 500);
  Q.markStart('c', t0 + 1000);
  Q.recordStatus(st('c', 34, 4, RESET + 18000), t0 + 2000); // c spent 3
  Q.recordStatus(st('d', 36, 4, RESET + 18000), t0 + 3000); // +2%, d spent 3 (c's 3 already paid)
  Q.recordStatus(st('c', 38, 5, RESET + 18000), t0 + 4000); // +2%, c spent 1
  assert.deepEqual(Q.measure('c', t0 + 5000), { pct: 8, shared: true, own: 6 });
  const gaps = { steps: [{ label: 'Decision', applies: true, pass: true }] };
  const ev = evaluate(gaps, { total: 1000000 }, 'claude-share-1', Q.measure('c', t0 + 5000));
  assert.deepEqual([ev.quotaPct, ev.quotaBy, ev.quotaOwn], [8, 'measured:shared', 6]);
  assert.match(summaryLine('x', ev), /≈ 8% de la cuota \(medido, con otra sesión activa; esta sesión ≈ 6%, prorrateado por costo\)/);
  assert.equal(evaluate(gaps, { total: 1 }, 'm', { pct: 3, shared: false }).quotaOwn, undefined, 'alone: the measure is its own');
});

test('install-hooks gives Waymark\'s status line refreshInterval 30, so a quiet terminal shows the other sessions\' use', () => {
  const cmd = 'node "/s/waymark/scripts/statusline.mjs"';
  const add = planStatusLine({}, { scripts: '/s/waymark/scripts' });
  assert.deepEqual(add.settings.statusLine, { type: 'command', command: cmd, refreshInterval: 30 });
  const old = planStatusLine({ statusLine: { type: 'command', command: cmd } }, { scripts: '/s/waymark/scripts' });
  assert.deepEqual([old.settings.statusLine.refreshInterval, old.steps.length], [30, 1], 'an install without it gets it');
  assert.deepEqual(planStatusLine(add.settings, { scripts: '/s/waymark/scripts' }).steps, [], 'idempotent');
});

test('a session first seen with a reading from an older window (idle across the reset) changes nothing', () => {
  const t0 = 1799993000000, before = Q.readQuota();
  Q.recordStatus(st('old', 80, 2, RESET), t0); // its last response was in the window that already reset
  const now = Q.readQuota();
  assert.deepEqual([now.latest.five, own('c'), own('d')], [before.latest.five, own('c'), own('d')]);
  assert.equal(own('c'), 6, 'the shares of the current window stay');
});

test('the first reading with none before it (a new install, a wiped file) is a baseline: no session takes the window\'s past', () => {
  const prev = process.env.WAYMARK_HOME, fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-share-base-'));
  process.env.WAYMARK_HOME = fresh;
  try {
    const t0 = 1799995000000;
    Q.recordStatus(st('e', null, 0.5), t0); // before its first response: no reading yet
    Q.recordStatus(st('e', null, 2), t0 + 1000); // it spends
    Q.recordStatus(st('e', 70, 3), t0 + 2000); // the first reading: 70% of a window Waymark did not see begin
    assert.equal(own('e'), 0, 'the 70% was spent before Waymark watched: not this session\'s');
    assert.equal(Q.readQuota().outside.pct, 70);
    assert.equal(Q.statusText(st('e', 70, 3), Q.readQuota()), '5h 70% · contexto 10%');
    Q.recordStatus(st('e', 74, 5), t0 + 3000); // +4%, e spent 2
    assert.equal(own('e'), 4, 'only the rises after the baseline are its own');
    assert.equal(Q.statusText(st('e', 74, 5), Q.readQuota()), '5h 74% · esta sesión ≈4% · contexto 10%');
    // the next day: the window reset hours ago, unseen (claude.ai, the desktop app), and a new terminal reads 40%
    const next = RESET + 9 * 3600, day = (RESET + 8 * 3600) * 1000; // the next window opened 4 h after the reset
    Q.recordStatus(st('f', null, 0.2), day);
    Q.recordStatus(st('f', null, 1), day + 1000);
    Q.recordStatus(st('f', 40, 2, next), day + 2000);
    assert.deepEqual([own('f'), Q.readQuota().outside.pct], [0, 40], 'a new window first read long after its reset is a baseline too');
    // a reset seen happen: the first reading of the new window comes minutes after it, and is split as before
    const soon = (next + 60) * 1000;
    Q.recordStatus(st('f', 3, 4, next + 18000), soon);
    assert.equal(own('f'), 3, 'read within 10 minutes of the reset: the new window starts at 0 and its % is this session\'s');
  } finally { process.env.WAYMARK_HOME = prev; fs.rmSync(fresh, { recursive: true, force: true }); }
});

// 2.0.6 — a session with no status line (the desktop app) is not invisible: the hooks record what it spends, from its
// transcript at list price, so a rise is split with it and a terminal's share is only its own.
const said = (id, at, out, model = 'claude-opus-5-5') => JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, model, usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: out } } }) + '\n';

test('list price per response: the model\'s family, cache writes by their duration, cache reads apart', () => {
  const m = 1e6;
  assert.equal(Q.usageCost('claude-opus-5-5', { output_tokens: m }), 20);
  assert.equal(Q.usageCost('claude-opus-5-5', { input_tokens: m, cache_read_input_tokens: m }), 4.2);
  assert.equal(Q.usageCost('claude-opus-5-5', { cache_creation_input_tokens: 2 * m, cache_creation: { ephemeral_1h_input_tokens: m, ephemeral_5m_input_tokens: m } }), 8 + 5);
  assert.equal(Q.usageCost('claude-opus-5-5', { cache_creation_input_tokens: m }), 5, 'no split: a 5-minute write');
  assert.equal(Q.usageCost('claude-sonnet-4-6', { input_tokens: m, output_tokens: m }), 18);
  assert.equal(Q.usageCost('claude-haiku-5-5', { output_tokens: m }), 0.5);
  assert.equal(Q.usageCost('claude-fable-5-1[1m]', { output_tokens: m }), 50);
  assert.equal(Q.usageCost('some-new-model', { output_tokens: m }), 20, 'an unknown model takes the default (only the ratio between sessions matters)');
});

test('a session without the status line records its spend: the terminal shows only its own share', () => {
  const prev = process.env.WAYMARK_HOME, fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-share-desk-'));
  process.env.WAYMARK_HOME = fresh;
  try {
    const t0 = 1799996000000, file = path.join(fresh, 'w.jsonl');
    Q.recordStatus(st('t', 80, 1), t0); // a terminal reads 80%: the baseline
    fs.writeFileSync(file, said('m0', t0 - 5000, 500000)); // spent before that reading: the baseline too
    Q.recordSpend('w', file, t0 + 1000); // the desktop app's first hook
    assert.deepEqual([Q.readQuota().sessions.w.cost, Q.readQuota().sessions.w.paid], [10, 10]);
    // the desktop session works: 5.5 USD, one response streamed as two lines (counted once)
    fs.appendFileSync(file, said('m1', t0 + 2000, 200000) + said('m1', t0 + 2001, 200000) + said('m2', t0 + 3000, 75000));
    Q.recordSpend('w', file, t0 + 4000);
    Q.recordSpend('w', file, t0 + 4500); // nothing new: nothing counted twice
    assert.equal(Q.readQuota().sessions.w.cost, 15.5);
    Q.recordStatus(st('t', 92, 1.5), t0 + 5000); // the terminal's question (0.5 USD) reads 92%: +12
    assert.deepEqual([own('w'), own('t')], [11, 1]);
    assert.equal(Q.statusText(st('t', 92, 1.5), Q.readQuota()), '5h 92% · esta sesión ≈1% · contexto 10%');
    // a line still being written is read when it is whole
    fs.appendFileSync(file, said('m3', t0 + 6000, 50000).slice(0, 40));
    Q.recordSpend('w', file, t0 + 6500);
    assert.equal(Q.readQuota().sessions.w.cost, 15.5);
    fs.appendFileSync(file, said('m3', t0 + 6000, 50000).slice(40));
    Q.recordSpend('w', file, t0 + 7000);
    assert.equal(Q.readQuota().sessions.w.cost, 16.5);
  } finally { process.env.WAYMARK_HOME = prev; fs.rmSync(fresh, { recursive: true, force: true }); }
});

test('the hooks leave a status-line session to Claude Code\'s own cost; a subagent\'s responses count as the session\'s', () => {
  const prev = process.env.WAYMARK_HOME, fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-share-sub-'));
  process.env.WAYMARK_HOME = fresh;
  try {
    const t0 = 1799997000000, file = path.join(fresh, 'x.jsonl');
    Q.recordStatus(st('t', 10, 1), t0);
    fs.writeFileSync(file, said('a1', t0 + 1000, 100000));
    assert.equal(Q.recordSpend('t', file, t0 + 2000), null, 'the status line measures it');
    assert.equal(Q.readQuota().sessions.t.cost, 1);
    fs.mkdirSync(path.join(fresh, 'x', 'subagents'), { recursive: true });
    fs.writeFileSync(path.join(fresh, 'x', 'subagents', 'agent-1.jsonl'), said('s1', t0 + 1500, 1000000, 'claude-haiku-5-5'));
    Q.recordSpend('x', file, t0 + 3000);
    assert.equal(Q.readQuota().sessions.x.cost, 2.5, '2 USD of its own, 0.5 of its subagent');
    // the same session seen later by a status line (a terminal opened on it): Claude Code's cost takes over
    Q.recordStatus(st('x', 10, 3), t0 + 4000);
    const x = Q.readQuota().sessions.x;
    assert.deepEqual([x.cost, x.paid, x.by], [3, 3, undefined]);
  } finally { process.env.WAYMARK_HOME = prev; fs.rmSync(fresh, { recursive: true, force: true }); }
});

test('the end-of-turn and tool hooks record a desktop session\'s spend', () => {
  const prev = process.env.WAYMARK_HOME, fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-share-hook-'));
  try {
    const file = path.join(fresh, 'd.jsonl');
    fs.writeFileSync(file, said('h1', Date.now() - 1000, 100000));
    const run = (script, extra) => spawnSync(process.execPath, [path.join(SCRIPTS, script)], { input: JSON.stringify({ session_id: 'desk', transcript_path: file, cwd: fresh, ...extra }), env: { ...process.env, WAYMARK_HOME: fresh }, encoding: 'utf8' });
    run('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: file } });
    process.env.WAYMARK_HOME = fresh;
    assert.equal(Q.readQuota().sessions.desk.cost, 2);
    fs.appendFileSync(file, said('h2', Date.now(), 50000));
    run('stop-hook.mjs', { hook_event_name: 'Stop', last_assistant_message: 'ok' });
    assert.equal(Q.readQuota().sessions.desk.cost, 3);
  } finally { process.env.WAYMARK_HOME = prev; fs.rmSync(fresh, { recursive: true, force: true }); }
});
