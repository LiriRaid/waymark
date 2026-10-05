// Waymark · task records as git notes (docs/adr/0012). A committed task's whole record is a note on its last commit under
// refs/notes/waymark; provenance.jsonl keeps a chained stub with the note's sha256, so an edited or lost note shows up in
// verifyChain. Notes travel when the agent pushes the task (the end-of-turn hook pushes the notes ref to the same remote)
// or with `waymark.mjs notes push`, and follow a rebased or amended commit (repairNotes); git's config is never changed.
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const NOTES_REF = 'refs/notes/waymark';
export const noteSha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, timeout: 3000, maxBuffer: 32 * 1024 * 1024, ...opts });

// Adds the note as the user (git's own identity); only a repo with no identity at all gets waymark's. Never overwrites
// a note already on the commit (`notes add` without -f refuses). → true when written.
export function addNote(cwd, commit, text) {
  if (!commit) return false;
  const add = (ident = []) => git(cwd, [...ident, 'notes', `--ref=${NOTES_REF}`, 'add', '-F', '-', commit], { input: text, encoding: 'utf8' });
  const r = add();
  if (r.status === 0) return true;
  return /identity|who you are|empty ident/i.test(r.stderr || '') && add(['-c', 'user.name=waymark', '-c', 'user.email=waymark@localhost']).status === 0;
}

// The notes of the ref → Map(commit sha → note text), in two git calls (list + one cat-file batch); with `commits`,
// only theirs.
export function readNotes(cwd, commits = null) {
  const out = new Map();
  const list = git(cwd, ['notes', `--ref=${NOTES_REF}`, 'list'], { encoding: 'utf8' });
  if (list.status !== 0 || !list.stdout.trim()) return out;
  const want = commits && new Set(commits);
  const pairs = list.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/)).filter(([, c]) => !want || want.has(c)); // "<note blob> <commit>"
  if (!pairs.length) return out;
  const batch = git(cwd, ['cat-file', '--batch'], { input: pairs.map(([blob]) => blob).join('\n') + '\n' });
  if (batch.status !== 0) return out;
  const buf = batch.stdout;
  let at = 0;
  for (const [, commit] of pairs) {
    const nl = buf.indexOf(10, at);
    if (nl < 0) break;
    const size = Number(buf.subarray(at, nl).toString('utf8').split(' ')[2]); // "<sha> blob <bytes>"
    if (!(size >= 0)) break;
    out.set(commit, buf.subarray(nl + 1, nl + 1 + size).toString('utf8').replace(/\n$/, ''));
    at = nl + 1 + size + 1;
  }
  return out;
}

// A note left on a commit the branch no longer has (a rebase or amend rewrote it) is copied to the commit of the branch
// that carries the same "Waymark-Task: <id>" and has no note yet; the old note stays, so the chained stub still matches.
// One git log (the last 500 commits of HEAD) and one notes list. → the task IDs whose note was copied.
export function repairNotes(cwd, records) {
  const stubs = (records || []).filter((r) => r.id && r.note?.commit);
  if (!stubs.length) return [];
  const log = git(cwd, ['log', '-n', '500', '--format=%H%x00%B%x1e', 'HEAD'], { encoding: 'utf8' });
  if (log.status !== 0) return [];
  const inHead = new Set(), byTask = new Map();
  for (const entry of log.stdout.split('\x1e')) {
    const [commit, body = ''] = entry.trim().split('\x00');
    if (!commit) continue;
    inHead.add(commit);
    for (const m of body.matchAll(/^Waymark-Task:\s*(.+?)\s*$/gm)) if (!byTask.has(m[1])) byTask.set(m[1], commit); // newest first
  }
  const notes = readNotes(cwd), copied = [];
  for (const r of stubs) {
    const now = byTask.get(r.id);
    if (inHead.has(r.note.commit) || !now || now === r.note.commit || notes.has(now) || !notes.has(r.note.commit)) continue;
    const copy = (ident = []) => git(cwd, [...ident, 'notes', `--ref=${NOTES_REF}`, 'copy', r.note.commit, now], { encoding: 'utf8' });
    let c = copy();
    if (c.status !== 0 && /identity|who you are|empty ident/i.test(c.stderr || '')) c = copy(['-c', 'user.name=waymark', '-c', 'user.email=waymark@localhost']);
    if (c.status === 0) copied.push(r.id);
  }
  return copied;
}

// Pushes the notes ref to a remote (default origin). → { ok, output }
export function pushNotes(cwd, remote = 'origin') {
  const r = git(cwd, ['push', remote, `${NOTES_REF}:${NOTES_REF}`], { encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
