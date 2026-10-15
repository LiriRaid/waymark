// Every task record, from the log and from what only git holds (notes, waymark-log lines, trailer commits).
import { spawnSync } from 'node:child_process';
import { readNotes, readAnchors, readLogLines } from '../notes.mjs';
import { ID } from './ids.mjs';
import { maskSecrets } from './secrets.mjs';
import { projectHome } from './project.mjs';
import { closeKey, gitNote, lineKey, readLog, readRecords, recordName } from './chain.mjs';

// In date order; records without a date, and ties, keep their order.
const byDate = (list) => list.map((r, i) => [r, i]).sort(([a, i], [b, j]) => (Date.parse(a.at || '') || 0) - (Date.parse(b.at || '') || 0) || i - j).map(([r]) => r);

// The task records that live only as notes (a clone, another machine, a log started over): every note whose close
// (ID + session) has no line in `records`, one per close (a rebase copies a note), each with `fromNote: <commit>`.
// Not chained: git hashes them.
function noteOnly(notes, records) {
  const inLog = new Set(records.filter((r) => r.id).map(closeKey)), out = new Map();
  for (const [commit, text] of notes) {
    let r = null;
    try { r = JSON.parse(text); } catch { continue; }
    if (r?.id && ID.test(String(r.id)) && !inLog.has(closeKey(r)) && !out.has(closeKey(r))) out.set(closeKey(r), { ...r, fromNote: commit });
  }
  return [...out.values()];
}


// The lines rewrite anchors removed: by their key (with the session, so another machine's task with the same ID stays),
// or by name for an anchor that has no keys.
const forgotten = (root) => {
  const keys = new Set(), names = new Set();
  for (const a of readAnchors(root).filter((x) => x.kind === 'rewrite')) for (const k of a.keys || a.removed || []) (a.keys ? keys : names).add(k);
  return (r) => keys.has(lineKey(r)) || names.has(recordName(r));
};

// The task IDs of the commits' `Waymark-Task` trailers (the last 500 of HEAD) that no record holds: one record each from
// its commits (newest first) and the newest commit's message, `fromCommit` set. The log is read once per HEAD (the hooks
// read the records several times a turn). → records
const trailerCache = new Map();
function trailerRecords(root, known) {
  const head = spawnSync('git', ['rev-parse', '-q', '--verify', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 1500 });
  if (head.status !== 0) return [];
  const key = `${root}|${head.stdout.trim()}`;
  if (!trailerCache.has(key)) {
    const log = spawnSync('git', ['log', '-n', '500', '--format=%H%x00%cI%x00%B%x1e', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000, maxBuffer: 16 * 1024 * 1024 });
    const byTask = new Map();
    for (const entry of log.status === 0 ? log.stdout.split('\x1e') : []) {
      const [commit, at, body = ''] = entry.trim().split('\x00');
      if (!commit) continue;
      for (const m of body.matchAll(/^\s*Waymark-Task:\s*(.+?)\s*$/gim)) {
        const id = m[1];
        if (!ID.test(id)) continue;
        if (!byTask.has(id)) byTask.set(id, { id, at, fromCommit: commit, prompt: maskSecrets(body.split('\n')[0].trim()).slice(0, 600), message: maskSecrets(body.replace(/^\s*Waymark-Task:.*$/gim, '').trim()).slice(0, 2000), commits: [] });
        byTask.get(id).commits.push(commit);
      }
    }
    trailerCache.set(key, [...byTask.values()]);
  }
  return trailerCache.get(key).filter((r) => !known.has(r.id)).map((r) => ({ ...r, commits: [...r.commits] }));
}

// What git holds that the log lacks: records that are only notes, log lines kept in git (not those forget removed), and
// the trailer IDs no record holds. Not chained: git hashes them.
function gitOnly(root, records, notes) {
  const only = noteOnly(notes, records);
  const seen = new Set([...records, ...only].map(lineKey)), gone = forgotten(root);
  const logged = readLogLines(root).filter((r) => !gone(r) && !seen.has(lineKey(r)) && seen.add(lineKey(r)));
  const known = new Set([...records, ...only, ...logged].flatMap((r) => [r.id, r.claimed]).filter(Boolean)); // claimed: an ID the hook replaced
  return [...only, ...logged, ...trailerRecords(root, known)];
}

// Every task record, from the log and from git (notes, waymark-log lines, trailer commits), in date order: a stub
// becomes the whole record (note fields, then the stub's); a whole log line that a later commit also carries as a note
// (same close) takes the note's fields; what only git holds joins.
export function readTaskRecords(home) {
  const records = readRecords(home.log), notes = readNotes(home.root);
  const byClose = new Map();
  for (const [, text] of notes) { try { const r = JSON.parse(text); if (r?.id && !byClose.has(closeKey(r))) byClose.set(closeKey(r), r); } catch {} }
  const merged = records.map((r) => {
    const gn = gitNote(r);
    if (gn) { try { return { ...JSON.parse(notes.get(gn.commit)), ...r }; } catch { return { ...r, noteMissing: true }; } }
    const n = r.id && byClose.get(closeKey(r));
    return n ? { ...r, ...n, prev: r.prev, hash: r.hash } : r;
  });
  const only = gitOnly(home.root, records, notes);
  return only.length ? byDate([...merged, ...only]) : merged;
}


// The log's records plus those only git holds (their IDs are taken too: a clone never reuses one).
export const knownRecords = (cwd) => {
  const records = readLog(cwd);
  try { const root = projectHome(cwd).root, only = gitOnly(root, records, readNotes(root)); return only.length ? byDate([...records, ...only]) : records; } catch { return records; }
};
