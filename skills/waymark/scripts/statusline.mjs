#!/usr/bin/env node
// Waymark · Claude Code status line and the measured quota. Claude Code runs it after each response with the session's
// JSON on stdin (code.claude.com/docs/en/statusline): `rate_limits.five_hour.used_percentage` is the real % of the
// 5-hour window (claude.ai Pro and Max only, after the session's first response). It prints "5h 23% · 7d 41% · contexto
// 18%" and keeps in ~/.waymark/.quota.json:
// - latest: the last reading of the window (the quota is the account's: one value for every session);
// - sessions: per session, the last time its tokens moved (another session answering while a task runs = shared).
// ~/.waymark/.quota-starts.json holds, per session, the reading when its task started: set by the per-prompt hook and
// cleared when the task closes. A file of its own, so a status update never overwrites a start written meanwhile.
// The end-of-turn hook subtracts start from latest: the task's real %, with no question to the user (measure()).
// The reading lags the turn's last response by one status update; a window reset during the task gives no measure.
// A status line the user had before is chained: install-hooks.mjs keeps its command in ~/.waymark/statusline.json
// ({ "next": "<command>" }) and it runs after this one, with the same stdin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOME = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
export const quotaFile = () => path.join(HOME(), '.quota.json');
const startsFile = () => path.join(HOME(), '.quota-starts.json');
const KEEP = 7 * 86400000; // sessions and starts older than a week are dropped
const RESET_SLACK = 120; // seconds: the same window's resets_at may move a little between readings
const round = (x) => Math.round(x * 10) / 10;

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { return {}; } };
export function readQuota() {
  const st = readJson(quotaFile());
  return { latest: st.latest || null, sessions: st.sessions || {}, starts: readJson(startsFile()) };
}
const prune = (map, now) => { for (const [id, v] of Object.entries(map)) if (now - (v.at || 0) > KEEP) delete map[id]; return map; };
// Several sessions write them: a whole file renamed into place, never a half-written one.
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data));
  try { fs.renameSync(tmp, file); } catch { fs.rmSync(tmp, { force: true }); }
}
const writeQuota = (st, now) => writeJson(quotaFile(), { latest: st.latest, sessions: prune(st.sessions, now) });
const writeStarts = (starts, now) => writeJson(startsFile(), prune(starts, now));

const windowOf = (w) => (w && Number.isFinite(w.used_percentage) ? { pct: w.used_percentage, resetsAt: w.resets_at || null } : null);

// One status update: the window's reading (when the input has one) and whether this session's tokens moved.
export function recordStatus(input, now = Date.now()) {
  const st = readQuota(), five = windowOf(input?.rate_limits?.five_hour), seven = windowOf(input?.rate_limits?.seven_day);
  let changed = false;
  if (five) { st.latest = { at: now, five, ...(seven ? { seven } : {}) }; changed = true; }
  const id = input?.session_id, cw = input?.context_window || {};
  if (id) {
    const sig = `${input.cost?.total_cost_usd ?? ''}|${cw.total_input_tokens ?? ''}|${cw.total_output_tokens ?? ''}`, prev = st.sessions[id];
    if (!prev) { st.sessions[id] = { at: now, sig, activeAt: null }; changed = true; } // first sight: not activity yet
    else if (prev.sig !== sig) { st.sessions[id] = { at: now, sig, activeAt: now }; changed = true; }
  }
  if (changed) writeQuota(st, now);
  return st;
}

export function statusText(input) {
  const five = windowOf(input?.rate_limits?.five_hour), seven = windowOf(input?.rate_limits?.seven_day), ctx = input?.context_window?.used_percentage;
  return [five && `5h ${Math.round(five.pct)}%`, seven && `7d ${Math.round(seven.pct)}%`, Number.isFinite(ctx) && `contexto ${Math.round(ctx)}%`].filter(Boolean).join(' · ');
}

// The task's start: the reading at its first prompt (a later prompt of the same task keeps it). The end-of-turn hook clears
// it when a task closes and when a turn ends with no task (a question, L0), so it never measures the next task. A reading
// whose window ended before this prompt means a new window, which starts at 0.
export function markStart(session, now = Date.now()) {
  const st = readQuota(), five = st.latest?.five, id = session || 'unknown';
  if (st.starts[id] || !five) return null;
  const reset = five.resetsAt && five.resetsAt * 1000 <= now;
  st.starts[id] = { at: now, pct: reset ? 0 : five.pct, resetsAt: reset ? null : five.resetsAt };
  writeStarts(st.starts, now);
  return st.starts[id];
}

export function clearStart(session) {
  const starts = readJson(startsFile()), id = session || 'unknown';
  if (!starts[id]) return;
  delete starts[id];
  writeStarts(starts, Date.now());
}

// → { pct, shared } from the task's start to the latest reading, or null: no start, no reading since the start, or the
// window reset during the task. shared: another session's tokens moved in between (its use is in the difference).
export function measure(session, now = Date.now()) {
  const st = readQuota(), id = session || 'unknown', s = st.starts[id], e = st.latest;
  if (!s || !e?.five || e.at <= s.at) return null;
  if (s.resetsAt !== null && Math.abs((e.five.resetsAt || 0) - s.resetsAt) > RESET_SLACK) return null;
  const pct = round(e.five.pct - s.pct);
  if (pct < 0) return null;
  const shared = Object.entries(st.sessions).some(([k, v]) => k !== id && v.activeAt && v.activeAt > s.at && v.activeAt <= now);
  return { pct, shared };
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  let input = '', done = false;
  const run = () => {
    if (done) return;
    done = true;
    let data = {};
    try { data = JSON.parse(input); } catch {}
    try { recordStatus(data); } catch {}
    const lines = [];
    try { lines.push(statusText(data)); } catch {}
    try { // the user's own status line, after this one
      const next = JSON.parse(fs.readFileSync(path.join(HOME(), 'statusline.json'), 'utf8')).next;
      if (next) { const r = spawnSync(next, { shell: true, input, encoding: 'utf8', timeout: 3000 }); if (r.stdout?.trim()) lines.push(r.stdout.trimEnd()); }
    } catch {}
    process.stdout.write(lines.filter(Boolean).join('\n'));
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', run);
  process.stdin.resume();
  setTimeout(run, 1000).unref();
}
