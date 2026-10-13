// Point 8 of 2.0.3 — the quota shared by session: the 5-hour window is the account's, so each rise of its % is split
// among the Claude Code sessions by what each one spent (cost.total_cost_usd) since the last reading; each terminal
// shows its share and the close of a task shared with another session says its own part (docs/adr/0019, amended).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
