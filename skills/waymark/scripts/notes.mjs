// Waymark · task records as git notes (docs/adr/0012). A committed task's whole record is a note on its last commit under
// refs/notes/waymark; provenance.jsonl keeps a chained stub with the note's sha256, so an edited or lost note shows up in
// verifyChain. Notes travel only with an explicit push (`waymark.mjs notes push`); git's config is never changed.
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

// Pushes the notes ref to a remote (default origin). → { ok, output }
export function pushNotes(cwd, remote = 'origin') {
  const r = git(cwd, ['push', remote, `${NOTES_REF}:${NOTES_REF}`], { encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
