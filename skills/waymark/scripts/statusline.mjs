#!/usr/bin/env node
// Waymark · Claude Code status line and the measured quota. Claude Code runs it after each response with the session's
// JSON on stdin (code.claude.com/docs/en/statusline), also every 30 s (refreshInterval, set by install-hooks.mjs):
// `rate_limits.five_hour.used_percentage` is the real % of the 5-hour window (claude.ai Pro and Max only, after the
// session's first response). It prints "5h 23% · esta sesión ≈8% · 7d 41% · contexto 18%" and keeps in
// ~/.waymark/.quota.json:
// - latest: the newest reading of the window (the quota is the account's: one value for every session, so a quiet
//   terminal shows what another one read). A re-run that brings the session's same reading again is not a new one;
// - sessions: per session, the last time its tokens moved (another session answering while a task runs = shared), its
//   cumulative cost (`cost.total_cost_usd`, list price; a session with no status line, such as the desktop app's, gets
//   it from the hooks: recordSpend), the cost already paid for and its share (own) of the window;
// - outside: the share of the window no Claude Code session paid for (claude.ai, Codex, another machine).
// Each rise of the reading is split among the sessions by the cost each spent since it was last paid for (docs/adr/0019,
// shares per session): a prorated estimate, never a calibration pair. The first reading with none before it, or of a new
// window read more than 10 minutes after the last reset, is a baseline: what the window held then goes to outside, and no
// session takes it.
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
import { subagentDir } from './transcript.mjs';
import { waymarkHome as HOME } from './lib/paths.mjs';
import { readJson as readJsonFile } from './lib/fs.mjs';

export const quotaFile = () => path.join(HOME(), '.quota.json');
const startsFile = () => path.join(HOME(), '.quota-starts.json');
const KEEP = 7 * 86400000; // sessions and starts older than a week are dropped
const RESET_SLACK = 120; // seconds: the same window's resets_at may move a little between readings
const SEEN_RESET = 600; // seconds: a new window's first reading within this of the last reset saw the reset happen
const round = (x) => Math.round(x * 10) / 10;

const readJson = (file) => readJsonFile(file) || {};
export function readQuota() {
  const st = readJson(quotaFile());
  return { latest: st.latest || null, sessions: st.sessions || {}, outside: st.outside || null, starts: readJson(startsFile()) };
}
const prune = (map, now) => { for (const [id, v] of Object.entries(map)) if (now - (v.at || 0) > KEEP) delete map[id]; return map; };
// Several sessions write them: a whole file renamed into place, never a half-written one.
function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data));
  try { fs.renameSync(tmp, file); } catch { fs.rmSync(tmp, { force: true }); }
}
const writeQuota = (st, now) => writeJson(quotaFile(), { latest: st.latest, sessions: prune(st.sessions, now), outside: st.outside });
const writeStarts = (starts, now) => writeJson(startsFile(), prune(starts, now));

const windowOf = (w) => (w && Number.isFinite(w.used_percentage) ? { pct: w.used_percentage, resetsAt: w.resets_at || null } : null);

const sameWindow = (a, b) => !!a && !!b && Math.abs((a.resetsAt || 0) - (b.resetsAt || 0)) <= RESET_SLACK;
const readingKey = (five) => (five ? `${five.pct}|${five.resetsAt}` : '');

// A rise of the window (dp, in %) split among the sessions by the cost each spent since it was last paid for; a rise
// no session paid for goes to outside.
function attribute(st, dp) {
  const spent = Object.values(st.sessions).filter((s) => Number.isFinite(s.cost)).map((s) => [s, Math.max(0, s.cost - (s.paid ?? s.cost))]);
  const total = spent.reduce((n, [, d]) => n + d, 0);
  if (total > 0) for (const [s, d] of spent) { s.own = (s.own || 0) + (dp * d) / total; s.paid = s.cost; }
  else st.outside = { pct: (st.outside?.pct || 0) + dp };
}

// List price in USD per million tokens (input, output, cache read) by model, first match; a cache write costs 1.25×
// input (5 minutes) or 2× (1 hour). Only the ratio between sessions matters (each rise is prorated by cost, and a
// status-line session's cost is Claude Code's own), so an unknown model takes the default.
const PRICES = [
  [/fable-5-1|mythos-5-1/, [10, 50, 0.25]], [/fable|mythos/, [10, 50, 1]],
  [/opus-5-5/, [4, 20, 0.2]], [/opus/, [5, 25, 0.5]],
  [/sonnet-5/, [2, 10, 0.2]], [/sonnet/, [3, 15, 0.3]],
  [/haiku-5/, [0.1, 0.5, 0.01]], [/haiku/, [1, 5, 0.1]],
];
const DEFAULT_PRICE = [4, 20, 0.2];
export function usageCost(model, u = {}) {
  const [inp, out, read] = PRICES.find(([re]) => re.test(model || ''))?.[1] || DEFAULT_PRICE;
  const c = u.cache_creation, hour = c?.ephemeral_1h_input_tokens || 0;
  const minutes = c ? c.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0;
  return ((u.input_tokens || 0) * inp + minutes * inp * 1.25 + hour * inp * 2 + (u.cache_read_input_tokens || 0) * read + (u.output_tokens || 0) * out) / 1e6;
}

// The responses a transcript gained after `offset` (bytes): their cost, the part answered at or before `paidUntil`
// (ms), and their tokens (input, cache writes and reads, output). Whole lines only (a line still being written is read
// next time); each message once (a streamed response is written as several lines that share message.id and usage, so
// the last ids read are kept across calls).
export function transcriptCost(file, offset = 0, seen = [], paidUntil = 0) {
  const size = fs.statSync(file).size;
  if (size < offset) { offset = 0; seen = []; } // rewritten
  const r = { cost: 0, paid: 0, tokens: 0, offset, seen };
  if (size === offset) return r;
  const buf = Buffer.alloc(size - offset), fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, offset); } finally { fs.closeSync(fd); }
  const end = buf.lastIndexOf(10) + 1;
  const ids = new Set(seen);
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const u = d?.type === 'assistant' ? d.message?.usage : null;
    if (!u || ids.has(d.message.id)) continue;
    ids.add(d.message.id);
    const c = usageCost(d.message.model, u);
    r.cost += c;
    r.tokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0);
    if ((Date.parse(d.timestamp || '') || 0) <= paidUntil) r.paid += c;
  }
  return { ...r, offset: offset + end, seen: [...ids].slice(-50) };
}

// A session's files: its transcript and its subagents'.
function sessionFiles(transcript) {
  let subs = [];
  try { const dir = subagentDir(transcript); subs = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => [n, path.join(dir, n)]); } catch {}
  return [['main', transcript], ...subs];
}

// The session's tokens for the line: what `s` counted so far plus what its files gained since (cache included, the
// number each task's evaluation gives, so the session's is the sum of its tasks'). Null when nothing new was read. A
// file shorter than where the count stopped was rewritten: the session is counted again from the start.
function sessionTokens(s, transcript) {
  const list = sessionFiles(transcript);
  const rewritten = list.some(([key, file]) => { try { return fs.statSync(file).size < (s?.tokenFiles?.[key]?.offset || 0); } catch { return false; } });
  if (rewritten) s = null;
  let tokens = s?.tokens || 0, read = false;
  const files = { ...(s?.tokenFiles || {}) };
  for (const [key, file] of list) {
    const p = files[key] || {};
    let r;
    try { r = transcriptCost(file, p.offset, p.seen); } catch { continue; }
    if (r.offset === (p.offset || 0)) continue;
    tokens += r.tokens; files[key] = { offset: r.offset, seen: r.seen }; read = true;
  }
  return read ? { tokens, tokenFiles: files } : null;
}

// What a session with no status line (Claude's desktop app) spent, recorded by the hooks so each rise of the window is
// split with it too: its transcript and its subagents' at list price, read from where the last call stopped. First
// sight: what it spent up to the newest reading is the baseline. A session the status line measures is left to it.
export function recordSpend(session, transcript, now = Date.now()) {
  if (!session || !transcript || !fs.existsSync(transcript)) return null;
  const known = readQuota().sessions[session];
  if (known && known.by !== 'hook') return null; // without the lock: a status-line session stays one (checked again below)
  return withLock(() => {
    const st = readQuota(), prev = st.sessions[session];
    if (prev && prev.by !== 'hook') return null;
    const s = prev ? { ...prev, files: { ...prev.files } } : { at: now, by: 'hook', activeAt: null, own: 0, cost: 0, paid: 0, files: {} };
    const paidUntil = prev ? 0 : st.latest?.at ?? Infinity;
    let spent = 0, read = !prev;
    for (const [key, file] of sessionFiles(transcript)) {
      const p = s.files[key] || {};
      const r = transcriptCost(file, p.offset, p.seen, paidUntil);
      s.cost += r.cost; s.paid += r.paid; spent += r.cost - r.paid;
      if (r.offset !== (p.offset || 0)) read = true;
      s.files[key] = { offset: r.offset, seen: r.seen };
    }
    if (!read) return prev; // nothing new: the file is not rewritten
    if (spent > 0) { s.at = now; s.activeAt = now; }
    st.sessions[session] = s;
    writeQuota(st, now);
    return s;
  });
}

// Two terminals updating at once would both split the same rise: the read-split-write runs under a lock folder (taken
// within ~300 ms, or the update goes ahead without it; one older than 5 s is a crashed run's and is removed).
function withLock(fn) {
  const lock = `${quotaFile()}.lock`;
  let held = false;
  for (let i = 0; i < 30 && !held; i++) {
    try { fs.mkdirSync(path.dirname(lock), { recursive: true }); fs.mkdirSync(lock); held = true; } catch {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.rmSync(lock, { recursive: true, force: true }); } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try { return fn(); } finally { if (held) fs.rmSync(lock, { recursive: true, force: true }); }
}

// One status update: the window's reading (when the input has one and it is new for this session), whether this
// session's tokens moved, its cost, and the share of each rise of the window.
// The session's tokens are read before the lock (the first read of a long transcript takes a while) and kept only when
// the entry's count did not move meanwhile (another update of the same session counted them first).
export function recordStatus(input, now = Date.now()) {
  const id = input?.session_id, transcript = input?.transcript_path;
  let tk = null, from;
  if (id && transcript) {
    const prev = readQuota().sessions[id];
    from = prev && prev.by !== 'hook' ? prev.tokenFiles : undefined;
    try { tk = sessionTokens(from ? prev : null, transcript); } catch {}
  }
  return withLock(() => record(input, now, tk && { tk, from: JSON.stringify(from ?? null) }));
}
function record(input, now, tokens = null) {
  const st = readQuota(), five = windowOf(input?.rate_limits?.five_hour), seven = windowOf(input?.rate_limits?.seven_day);
  let changed = false;
  const id = input?.session_id, cw = input?.context_window || {}, cost = input?.cost?.total_cost_usd;
  if (id) {
    const sig = `${cost ?? ''}|${cw.total_input_tokens ?? ''}|${cw.total_output_tokens ?? ''}`, prev = st.sessions[id];
    // first sight: not activity yet, and the cost spent before is the baseline (nothing attributed to it). A session the
    // hooks recorded (recordSpend) is first seen here too: Claude Code's own cost replaces their estimate, its share stays
    const first = !prev || prev.by === 'hook';
    let s = first ? { at: now, sig, activeAt: null, own: prev?.own || 0 } : prev.sig !== sig ? { ...prev, at: now, sig, activeAt: now } : prev;
    if (Number.isFinite(cost)) {
      // a lower cost is a cleared session (`/clear` restarts it at $0): what it spent since then is still unpaid
      s.paid = first || !Number.isFinite(prev.cost) ? cost : cost < prev.cost ? 0 : prev.paid ?? cost;
      s.cost = cost;
    }
    // its tokens for the line, read before the lock from where the last update stopped (the hooks' estimate of a desktop
    // session counts none)
    if (tokens && tokens.from === JSON.stringify((first ? null : prev.tokenFiles) ?? null)) { if (s === prev) s = { ...prev }; Object.assign(s, tokens.tk); }
    if (s !== prev) { st.sessions[id] = s; changed = true; }
  }
  const fresh = five && (!id || readingKey(five) !== st.sessions[id]?.seen); // a re-run brings the session's same reading
  // a reading from a window older than the newest one (a session idle across the reset, first seen by the timer)
  const older = fresh && st.latest?.five && !sameWindow(st.latest.five, five) && (five.resetsAt || 0) < (st.latest.five.resetsAt || 0);
  if (older) { st.sessions[id].seen = readingKey(five); changed = true; }
  else if (fresh) {
    const prev = st.latest?.five, same = sameWindow(prev, five);
    if (!same) { for (const s of Object.values(st.sessions)) s.own = 0; st.outside = null; }
    // no reading before (a new install, a wiped file), or a new window first read long after the last one reset: the
    // window's % so far was spent while Waymark did not watch (claude.ai, the desktop app, another agent)
    const unseen = !prev || (!same && now / 1000 - (prev.resetsAt || 0) > SEEN_RESET);
    if (unseen) {
      st.outside = { pct: five.pct };
      for (const s of Object.values(st.sessions)) if (Number.isFinite(s.cost)) s.paid = s.cost;
    } else {
      const dp = same ? five.pct - prev.pct : five.pct; // a reset seen happen: the new window starts at 0
      if (dp > 0) attribute(st, dp);
    }
    st.latest = { at: now, five, ...(seven ? { seven } : {}) };
    if (id) st.sessions[id].seen = readingKey(five);
    changed = true;
  }
  if (changed) writeQuota(st, now);
  return st;
}

// 1500999 → "1.5M", 250000 → "250k" (a point, as the task's evaluation line writes "5.89M tokens").
const tokenText = (n) => (n >= 999500 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

// The line: the newest reading of the account (this session's, or a newer one another session wrote in `st`), this
// session's share of the window when it has a cost, its tokens, the 7-day window and the context.
export function statusText(input, st = null) {
  let five = windowOf(input?.rate_limits?.five_hour);
  const newest = st?.latest?.five, seven = windowOf(input?.rate_limits?.seven_day), ctx = input?.context_window?.used_percentage;
  if (newest && (!five || (sameWindow(newest, five) ? newest.pct > five.pct : (newest.resetsAt || 0) > (five.resetsAt || 0)))) five = newest;
  const s = st?.sessions?.[input?.session_id], own = five && s?.own > 0 && Number.isFinite(s.cost) ? s.own : 0;
  const share = own ? `esta sesión ${own < 0.5 ? '<1' : `≈${Math.round(own)}`}%` : '';
  const tokens = s?.tokens > 0 ? `tokens ${tokenText(s.tokens)}` : '';
  return [five && `5h ${Math.round(five.pct)}%`, share, tokens, seven && `7d ${Math.round(seven.pct)}%`, Number.isFinite(ctx) && `contexto ${Math.round(ctx)}%`].filter(Boolean).join(' · ');
}

// The task's start: the reading at its first prompt (a later prompt of the same task keeps it). The end-of-turn hook clears
// it when a task closes and when a turn ends with no task (a question, L0), so it never measures the next task. A reading
// whose window ended before this prompt means a new window, which starts at 0.
export function markStart(session, now = Date.now()) {
  const st = readQuota(), five = st.latest?.five, id = session || 'unknown';
  if (st.starts[id] || !five) return null;
  const reset = five.resetsAt && five.resetsAt * 1000 <= now;
  st.starts[id] = { at: now, pct: reset ? 0 : five.pct, resetsAt: reset ? null : five.resetsAt, own: reset ? 0 : st.sessions[id]?.own || 0 };
  writeStarts(st.starts, now);
  return st.starts[id];
}

export function clearStart(session) {
  const starts = readJson(startsFile()), id = session || 'unknown';
  if (!starts[id]) return;
  delete starts[id];
  writeStarts(starts, Date.now());
}

// → { pct, shared[, own] } from the task's start to the latest reading, or null: no start, no reading since the start, or
// the window reset during the task. shared: another session's tokens moved in between (its use is in the difference);
// then own is this session's share of the rise, prorated by cost, when the session has a cost. The status line updating
// this session after the start with the same reading is a reading too: the task stayed below its resolution (pct 0).
export function measure(session, now = Date.now()) {
  const st = readQuota(), id = session || 'unknown', s = st.starts[id], e = st.latest, mine = st.sessions[id];
  const seenSince = e?.five && mine && mine.by !== 'hook' && mine.at > s?.at && mine.seen === readingKey(e.five);
  if (!s || !e?.five || (e.at <= s.at && !seenSince)) return null;
  if (s.resetsAt !== null && Math.abs((e.five.resetsAt || 0) - s.resetsAt) > RESET_SLACK) return null;
  const pct = round(e.five.pct - s.pct);
  if (pct < 0) return null;
  const shared = Object.entries(st.sessions).some(([k, v]) => k !== id && v.activeAt && v.activeAt > s.at && v.activeAt <= now);
  if (!shared || !Number.isFinite(mine?.cost)) return { pct, shared };
  return { pct, shared, own: Math.min(pct, Math.max(0, round((mine.own || 0) - (s.own || 0)))) };
}

// Whether Claude Code's status line watches this session (the hooks' estimate of a desktop session does not count): its
// task's % is measured, so the close never asks for it.
export const watched = (session) => { const s = readQuota().sessions[session || 'unknown']; return !!s && s.by !== 'hook'; };

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  let input = '', done = false;
  const run = () => {
    if (done) return;
    done = true;
    let data = {};
    try { data = JSON.parse(input); } catch {}
    let st = null;
    try { st = recordStatus(data); } catch {}
    const lines = [];
    try { lines.push(statusText(data, st)); } catch {}
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
