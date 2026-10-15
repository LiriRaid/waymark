// The chained log (docs/adr/0001, 0025): appending a record, its git anchor, `forget`, and verifying the chain.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addNote, readNotes, noteSha, addAnchor, readAnchors, addLogLine, dropLogLines } from '../notes.mjs';
import { norm } from '../lib/paths.mjs';
import { sha } from '../lib/hash.mjs';
import { ID } from './ids.mjs';
import { maskSecrets } from './secrets.mjs';
import { logFile, logHookError } from './project.mjs';

// The git note a log line points to ({ commit, sha }), or null: only an object with a commit counts.
export const gitNote = (r) => (r?.note && typeof r.note === 'object' && typeof r.note.commit === 'string' ? r.note : null);

// One task close: its ID and the session that closed it (two machines can give the same ID the same day).
export const closeKey = (r) => `${r.id}|${r.session || ''}`;

// The last line of git's output, short, with a URL's credentials (https://user:token@) and secret-like values masked.
export const gitError = (output) => maskSecrets((String(output || '').split('\n').filter(Boolean).pop() || 'no answer').replace(/\/\/[^/@\s]+@/g, '//***@')).slice(0, 120);

// How `forget` names a record (a task ID, else the session and time).
export const recordName = (r) => r.id || `Q ${String(r.session || '').slice(0, 8)} ${r.at || ''}`.trim();
// One close or one question, wherever its line lives (a log chained again by forget has new hashes).
export const lineKey = (r) => (r.id ? closeKey(r) : `${r.kind || ''}|${r.session || ''}|${r.at || ''}`);

export const readLog = (cwd) => readRecords(logFile(cwd));
export function readRecords(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

// Appends the record with `prev` (hash of the last line) and `hash` (of this line without it). A task with commits
// (newest first, as commitsFor returns them) is written whole as a git note on its newest commit and the line is a stub
// that holds the note's sha256; a commit that already has a note, or a failed write, keeps the whole record here. The
// same note goes on the newest commit of each other repo in `repos` ([{ root, commits }], newest first). A line with no
// note, as chained, is appended to refs/notes/waymark-log on HEAD as well, so it is in git.
export function appendRecord(cwd, record) {
  const file = logFile(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev = null, count = 0;
  try { const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); count = lines.length; if (lines.length) prev = JSON.parse(lines[lines.length - 1]).hash || sha(lines[lines.length - 1]); } catch {}
  let line = record;
  const commit = record.id && record.commits?.[0];
  const text = JSON.stringify(record);
  if (commit && addNote(cwd, commit, text)) {
    const { id, kind, agent, at, session, cwd: where, files, commits, repos, department } = record; // department: what the session loaded (docs/adr/0015)
    line = Object.fromEntries(Object.entries({ id, kind, agent, at, session, cwd: where, files, commits, repos, department }).filter(([, v]) => v !== undefined));
    line.note = { commit, sha: noteSha(text) };
  }
  if (record.id) for (const r of record.repos || []) { try { if (r.commits?.[0]) addNote(r.root, r.commits[0], text); } catch (e) { logHookError('note in another repo', e); } }
  const body = { ...line, prev };
  const hash = sha(JSON.stringify(body));
  fs.appendFileSync(file, JSON.stringify({ ...body, hash }) + '\n');
  if (!line.note) { try { addLogLine(cwd, { ...body, hash }); } catch (e) { logHookError('log line in git', e); } }
  anchor(cwd, file, { n: count + 1, hash }); // n from the read that gave prev: another session appending meanwhile cannot shift it
  return file;
}

// The log's anchor in git (notes.mjs, docs/adr/0025): its length and last hash on HEAD, named by `m`, the log's own id
// (this machine and this log's path), so the anchors of another clone or machine are not checked against this log.
export const logId = (file) => sha(`${os.hostname()}|${norm(fs.existsSync(file) ? fs.realpathSync(file) : file)}`).slice(0, 16);
export function anchor(cwd, file, entry) {
  try { addAnchor(cwd, { m: logId(file), at: Date.now(), ...entry }); } catch (e) { logHookError('anchor', e); }
}
// This log's anchors, oldest first.
export const anchorsFor = (cwd) => { const id = logId(logFile(cwd)); return readAnchors(cwd).filter((a) => a.m === id).sort((a, b) => (a.at || 0) - (b.at || 0)); };

// `waymark.mjs forget`: removes the records of one task ID (exactly that ID: a follow-up is named on its own) or of a session,
// chains the rest again from prev = null and leaves a rewrite anchor with the reason, what was removed and the head before
// and after, so the removal shows in git instead of hiding. A committed task's record is its git note: refused (the
// commit holds it). dryRun: the plan, nothing written. → { removed, from, to } or { error }.
export function forget(cwd, id, { session = null, reason = '', dryRun = false } = {}) {
  if (!String(reason).trim()) return { error: 'a reason is required (--reason "<why>"): it stays in the rewrite anchor' };
  if (!id && !session) return { error: 'name a task ID or --session <id>' };
  const file = logFile(cwd);
  const lines = (() => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } })();
  const hit = (r) => (id ? r.id === id : String(r.session || '').startsWith(session));
  const drop = lines.filter(hit);
  if (!drop.length) return { error: `no record of ${id || `session ${session}`} in ${file}` };
  const noted = drop.filter((r) => r.note?.commit);
  if (noted.length) return { error: `${noted.map((r) => r.id).join(', ')}: the record is a git note on commit ${noted[0].note.commit.slice(0, 8)}; forget removes only records without a commit` };
  const from = { n: lines.length, hash: lines[lines.length - 1]?.hash || null };
  const removed = [...new Set(drop.map(recordName))];
  if (dryRun) return { removed, from, to: { n: lines.length - drop.length, hash: null }, dryRun: true };
  let prev = null;
  const keep = lines.filter((r) => !hit(r)).map((r) => { const { hash, prev: _, ...rest } = r; const body = { ...rest, prev }; prev = sha(JSON.stringify(body)); return { ...body, hash: prev }; });
  fs.writeFileSync(file, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
  try { dropLogLines(cwd, hit); } catch (e) { logHookError('forget log lines', e); } // their copy in git; a merged copy elsewhere is skipped by the anchor's `removed`
  anchor(cwd, file, { kind: 'rewrite', n: keep.length, hash: prev, reason: String(reason).trim(), removed, keys: [...new Set(drop.map(lineKey))], from });
  return { removed, from, to: { n: keep.length, hash: prev } };
}

// → { ok: true } or { ok: false, at: <index of the first line whose hash or link does not match> }. With the notes
// (readNotes): a stub whose note is missing or does not match its sha256 breaks the chain too ({ note: true }). With
// the log's anchors (anchorsFor, oldest first): each one since the last rewrite anchor must still name the line it
// anchored, or the log was rewritten or cut ({ anchor: true }); the anchors before a rewrite describe the log it replaced.
export function verifyChain(records, notes = null, anchors = null) {
  let prev = null;
  for (let i = 0; i < records.length; i++) {
    const { hash, ...body } = records[i];
    if (body.prev !== prev || sha(JSON.stringify(body)) !== hash) return { ok: false, at: i };
    const gn = gitNote(body);
    if (notes && gn && (!notes.has(gn.commit) || noteSha(notes.get(gn.commit)) !== gn.sha)) return { ok: false, at: i, note: true };
    prev = hash;
  }
  const list = anchors || [];
  const since = list.map((a) => a.kind).lastIndexOf('rewrite');
  for (const a of list.slice(Math.max(0, since))) {
    if (a.n === 0 && !a.hash) continue; // a rewrite that removed every record: nothing left to anchor
    if (!(a.n > 0) || records[a.n - 1]?.hash !== a.hash) return { ok: false, at: Math.max(0, Math.min(a.n, records.length) - 1), anchor: true };
  }
  return { ok: true };
}
export { readNotes };
