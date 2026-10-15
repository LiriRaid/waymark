// Task IDs for a new task and a follow-up, the start of the current task, and the lines that belong to it.
import fs from 'node:fs';
import path from 'node:path';
import { isPrompt } from '../transcript.mjs';
import { waymarkHome as HOME } from '../lib/paths.mjs';
import { ID, base, localDay } from './ids.mjs';
import { readLog } from './chain.mjs';
import { knownRecords } from './records.mjs';

// The ID for a new task and for a follow-up of the last one; `known` holds every ID already recorded, `committed` the IDs
// only a commit's trailer holds (taken for a new task, yet still free to close: a task commits before its Cierre).
export function taskIds(cwd, now = new Date(), records = knownRecords(cwd)) {
  const day = localDay(now);
  const n = Math.max(0, ...records.map((r) => String(r.id || '').match(ID)).filter((m) => m && m[1] === day).map((m) => Number(m[2])));
  const known = new Set(records.filter((r) => !r.fromCommit).map((r) => r.id).filter(Boolean));
  const committed = new Set(records.filter((r) => r.fromCommit).map((r) => r.id));
  const follow = (id) => {
    const b = base(id);
    for (let c = 98; c <= 122; c++) if (!known.has(`${b}${String.fromCharCode(c)}`)) return `${b}${String.fromCharCode(c)}`; // b … z
    return null;
  };
  const tasks = records.filter((r) => ID.test(String(r.id || ''))); // question records (kind "Q") carry no ID
  const last = tasks.length ? base(tasks[tasks.length - 1].id) : null;
  return { next: `${day} · T${n + 1}`, last, followUp: last ? follow(last) : null, known, committed, follow };
}

// An ID is valid for this turn when it is the next new one, one only a commit's trailer holds (its task closing now), or
// an unused follow-up letter of a recorded task.
export function validId(id, ids) {
  const m = String(id || '').match(ID);
  if (!m || ids.known.has(m[0])) return false;
  if (m[0] === ids.next || ids.committed?.has(m[0])) return true;
  return !!m[3] && [...ids.known, ...(ids.committed || [])].some((k) => base(k) === base(m[0]));
}

// Lines of the current task. With `since` (ms, taskStart): every line after it, so a new task never carries the
// previous one's answers or first change. Without it: from the `prompts`-th last prompt.
export function taskLines(lines, { prompts = 3, since } = {}) {
  if (typeof since === 'number' && since > 0) {
    const i = lines.findIndex((d) => (Date.parse(d.timestamp || '') || 0) > since);
    return i < 0 ? [] : lines.slice(i);
  }
  let seen = 0;
  for (let i = lines.length - 1; i >= 0; i--) if (isPrompt(lines[i]) && ++seen === prompts) return lines.slice(i);
  return lines;
}

// Every file a task changed, from its records and those of its follow-ups: what a follow-up must share.
export function taskFiles(records, id) {
  const b = base(id);
  return b ? records.filter((r) => base(String(r.id || '')) === b).flatMap((r) => r.files || []) : [];
}

// When the current task started (ms), read from the chained log, never from prose: this session's last task record.
// With a follow-up's ID (a letter): after the last record of another task, so the stretch covers its whole task. 0
// when the session has no task record (every line read belongs to the task).
export function taskStart(records, session, id) {
  const own = /[a-z]$/.test(String(id || '').match(ID)?.[0] || '') ? base(id) : null;
  const closes = records.filter((r) => r.session === session && ID.test(String(r.id || '')) && (!own || base(r.id) !== own));
  const closed = Date.parse(closes.pop()?.at || '') || 0;
  if (own) return closed; // a follow-up reaches back to its task's start
  const mark = taskStartMark(session);
  return Math.max(closed, mark ? mark - 1000 : 0); // a second of slack: the prompt's line may be written before the hook runs
}

// The task's start, per session (~/.waymark/.task-starts.json): marked by the per-prompt hook at the task's first prompt
// (a later prompt of the same task keeps it), cleared by the end-of-turn hook when a task closes and when a turn ends
// with no task (a question, L0). Without it a session's first task was read from its last 3 prompts only.
export const startsFile = () => path.join(HOME(), '.task-starts.json');
export const readStarts = () => { try { return JSON.parse(fs.readFileSync(startsFile(), 'utf8')) || {}; } catch { return {}; } };
export const writeStarts = (all) => {
  for (const [k, at] of Object.entries(all)) if (Date.now() - at > 7 * 86400000) delete all[k];
  fs.mkdirSync(HOME(), { recursive: true });
  fs.writeFileSync(startsFile(), JSON.stringify(all));
};
export const taskStartMark = (session) => readStarts()[session || 'unknown'] || 0;
export function markTaskStart(session, now = Date.now()) {
  const all = readStarts(), id = session || 'unknown';
  if (all[id]) return all[id];
  all[id] = now;
  writeStarts(all);
  return now;
}
export function clearTaskStart(session) {
  const all = readStarts(), id = session || 'unknown';
  if (!all[id]) return;
  delete all[id];
  writeStarts(all);
}

// A task of this session is not done: it started and has no Cierre yet (a turn the quota cut, a reply waiting on the
// user), or its last Cierre says Resultado parcial or bloqueado. The context brakes wait for it (docs/adr/0016).
export function taskInProgress(cwd, session) {
  if (taskStartMark(session)) return true;
  const last = readLog(cwd).filter((r) => r.session === (session || 'unknown') && r.cierre).pop();
  return !!last && /^[ \t]*Resultado:\s*\**\s*(parcial|bloqueado)/im.test(last.cierre);
}
