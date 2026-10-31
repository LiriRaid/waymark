// Every task record, from the log and from what only git holds (notes, waymark-log lines, trailer commits).
import { readNotes, readAnchors, readLogLines, noteTips, headSha, headLog, NOTES_REF } from '../notes.mjs';
import { ID } from './ids.mjs';
import { maskSecrets } from './secrets.mjs';
import { projectHome } from './project.mjs';
import { appendRecord, closeKey, gitNote, lineKey, readLog, readRecords, recordName } from './chain.mjs';

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
const forgotten = (root, tips) => {
  const keys = new Set(), names = new Set();
  for (const a of readAnchors(root, tips).filter((x) => x.kind === 'rewrite')) for (const k of a.keys || a.removed || []) (a.keys ? keys : names).add(k);
  return (r) => keys.has(lineKey(r)) || names.has(recordName(r));
};

// The task IDs of the commits' `Waymark-Task` trailers (the last 500 of HEAD) that no record holds: one record each from
// its commits (newest first) and the newest commit's message, `fromCommit` set. The log is read once per HEAD (the hooks
// read the records several times a turn). → records
const trailerCache = new Map();
function trailerRecords(root, known) {
  const head = headSha(root); // from .git's files: no process
  if (!head) return [];
  const key = `${root}|${head}`;
  if (!trailerCache.has(key)) {
    const byTask = new Map();
    for (const { commit, at, body, files = [] } of headLog(root) || []) { // one git log per HEAD, shared with repairNotes and noteLateCommits
      for (const m of body.matchAll(/^\s*Waymark-Task:\s*(.+?)\s*$/gim)) {
        const id = m[1];
        if (!ID.test(id)) continue;
        if (!byTask.has(id)) byTask.set(id, { id, at, fromCommit: commit, signing: true, prompt: maskSecrets(body.split('\n')[0].trim()).slice(0, 600), message: maskSecrets(body.replace(/^\s*Waymark-Task:.*$/gim, '').trim()).slice(0, 2000), commits: [] });
        byTask.get(id).commits.push(commit);
        if (!signingOnly(files)) byTask.get(id).signing = false;
      }
    }
    trailerCache.set(key, [...byTask.values()]);
  }
  return trailerCache.get(key).filter((r) => !known.has(r.id) && !r.signing).map(({ signing, ...r }) => ({ ...r, commits: [...r.commits] }));
}

// A commit that only signs the release manifest (the user's, with the ID of a task as its trailer) is not a task: its files are the manifest and its signature alone.
const SIGNING = /(^|\/)MANIFEST\.json(\.sig)?$/;
const signingOnly = (files) => files.length > 0 && files.every((f) => SIGNING.test(f));

// What git holds that the log lacks: records that are only notes, log lines kept in git (not those forget removed), and
// the trailer IDs no record holds. Not chained: git hashes them.
function gitOnly(root, records, notes, tips) {
  const only = noteOnly(notes, records);
  const seen = new Set([...records, ...only].map(lineKey)), gone = forgotten(root, tips);
  const logged = readLogLines(root, tips).filter((r) => !gone(r) && !seen.has(lineKey(r)) && seen.add(lineKey(r)));
  const known = new Set([...records, ...only, ...logged].flatMap((r) => [r.id, r.claimed]).filter(Boolean)); // claimed: an ID the hook replaced
  return [...only, ...logged, ...trailerRecords(root, known)];
}

// Every task record, from the log and from git (notes, waymark-log lines, trailer commits), in date order: a stub
// becomes the whole record (note fields, then the stub's); a whole log line that a later commit also carries as a note
// (same close) takes the note's fields; what only git holds joins.
// A task the hook closed in red with no Cierre (its turn ended before the agent wrote one) can be closed afterwards by an appended
// {kind: 'close-late'} record (docs/adr/0055): the git note and the chain are not touched. The read gives that task the Cierre the
// user wrote, marks it `closedLater`, and corrects only the Cierre step of its evaluation: every other step stays as the hook judged it.
export const LATE_CLOSE = 'close-late';
const withLateCloses = (list) => {
  const closes = list.filter((r) => r.kind === LATE_CLOSE && r.task);
  if (!closes.length) return list;
  return list.map((r) => {
    const c = r.id && !r.kind && !String(r.cierre || '').trim() && closes.filter((x) => x.task === r.id && (x.taskSession || '') === (r.session || '')).pop();
    if (!c) return r;
    const ev = r.evaluation?.steps && r.evaluation.steps.Cierre === false
      ? { ...r.evaluation, steps: { ...r.evaluation.steps, Cierre: true }, score: String(r.evaluation.score || '').replace(/^(\d+)\//, (_, n) => `${+n + 1}/`) }
      : r.evaluation;
    return { ...r, cierre: c.cierre, outcome: { ...r.outcome, result: c.result }, ...(ev ? { evaluation: ev } : {}), unresolved: (r.unresolved || []).filter((u) => !/^the "## Cierre/.test(u)), closedLater: { at: c.at, by: c.by || 'user', reason: c.reason } };
  });
};

export function readTaskRecords(home) {
  const tips = noteTips(home.root); // one read of the three refs: their tips asked once
  const records = readRecords(home.log), notes = readNotes(home.root, null, NOTES_REF, tips);
  const byClose = new Map();
  for (const [, text] of notes) { try { const r = JSON.parse(text); if (r?.id && !byClose.has(closeKey(r))) byClose.set(closeKey(r), r); } catch {} }
  const merged = records.map((r) => {
    const gn = gitNote(r);
    if (gn) { try { return { ...JSON.parse(notes.get(gn.commit)), ...r }; } catch { return { ...r, noteMissing: true }; } }
    const n = r.id && byClose.get(closeKey(r));
    return n ? { ...r, ...n, prev: r.prev, hash: r.hash } : r;
  });
  const only = gitOnly(home.root, records, notes, tips);
  return withLateCloses(only.length ? byDate([...merged, ...only]) : merged);
}

// `waymark.mjs close`: closes afterwards a task that has no Cierre, with the three fields the user gives (never made up here) and the reason.
// Appends one record; dryRun: the plan. → { id, cierre } or { error }.
export function closeLater(cwd, id, { result = 'hecho', evidencia = '', aprendido = '', reason = '', dryRun = false } = {}) {
  if (!String(reason).trim()) return { error: 'a reason is required (--reason "<why>")' };
  if (!/^(hecho|parcial|bloqueado)$/.test(result)) return { error: 'the result is hecho, parcial or bloqueado' };
  const rec = readTaskRecords(projectHome(cwd)).filter((r) => r.id === id && !r.kind).pop();
  if (!rec) return { error: `no record of ${id}` };
  if (String(rec.cierre || '').trim()) return { error: `${id} already has a Cierre` };
  if (!String(evidencia).trim() || !String(aprendido).trim()) return { error: 'Evidencia and Aprendido are written by the user (--evidencia, --aprendido): the Cierre is never made up' };
  const cierre = `## Cierre · ${id}
Resultado: ${result}
Evidencia: ${String(evidencia).trim()}
Aprendido: ${String(aprendido).trim()}`;
  if (dryRun) return { id, cierre, dryRun: true };
  appendRecord(cwd, { kind: LATE_CLOSE, task: id, taskSession: rec.session || '', agent: rec.agent || null, by: 'user', at: new Date().toISOString(), cierre, result, reason: String(reason).trim() });
  return { id, cierre };
}


// The log's records plus those only git holds (their IDs are taken too: a clone never reuses one).
export const knownRecords = (cwd) => {
  const records = readLog(cwd);
  try { const root = projectHome(cwd).root, tips = noteTips(root), only = gitOnly(root, records, readNotes(root, null, NOTES_REF, tips), tips); return only.length ? byDate([...records, ...only]) : records; } catch { return records; }
};
