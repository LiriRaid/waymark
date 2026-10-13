// Waymark · task records as git notes (docs/adr/0012). A committed task's whole record is a note on its last commit under
// refs/notes/waymark; provenance.jsonl keeps a chained stub with the note's sha256, so an edited or lost note shows up in
// verifyChain. Notes travel when the agent pushes (the end-of-turn hook pushes the notes ref to the same remote while it
// has note commits the remote lacks) or with `waymark.mjs notes push`, and follow a rebased or amended commit
// (repairNotes); a task committed later by another task gets its record as a note too (noteLateCommits). A clone
// brings branches only: the session hook (ensureFetchSpec, in a repo with .waymark/) or `waymark.mjs notes setup` adds a
// fetch refspec into a tracking ref, refs/notes/remotes/<remote>/waymark, so a fetch never overwrites notes not pushed
// yet. The refspec is a glob (waymark*): a remote with no notes yet matches nothing, where an exact refspec would fail
// every `git fetch` with "couldn't find remote ref";
// the session hook merges that ref into the local one (mergeNotes, a conflict keeps the local note).
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

// A task recorded with no commit (its record whole in the log) whose work a later task committed with its trailer
// "Waymark-Task: <id>": the record, with that commit, becomes the commit's note, so it travels with the repo. The chained
// line stays as it is (verifyChain only checks stubs). One git log (the last 500 commits of HEAD) and one notes list,
// only when such a record exists. → the task IDs whose record became a note.
export function noteLateCommits(cwd, records) {
  const loose = (records || []).filter((r) => r.id && !r.kind && !r.note && !(r.commits || []).length);
  if (!loose.length) return [];
  const log = git(cwd, ['log', '-n', '500', '--format=%H%x00%B%x1e', 'HEAD'], { encoding: 'utf8' });
  if (log.status !== 0) return [];
  const byTask = new Map();
  for (const entry of log.stdout.split('\x1e')) {
    const [commit, body = ''] = entry.trim().split('\x00');
    if (commit) for (const m of body.matchAll(/^\s*Waymark-Task:\s*(.+?)\s*$/gim)) if (!byTask.has(m[1])) byTask.set(m[1], commit); // newest first
  }
  const notes = readNotes(cwd), added = [];
  for (const r of loose) {
    const commit = byTask.get(r.id);
    if (!commit || notes.has(commit)) continue;
    const { prev, hash, ...record } = r;
    if (addNote(cwd, commit, JSON.stringify({ ...record, commits: [commit] }))) { notes.set(commit, ''); added.push(r.id); }
  }
  return added;
}

// Pushes the notes ref to a remote (default origin). With the fetch refspec, git moves the tracking ref too. → { ok, output }
export function pushNotes(cwd, remote = 'origin') {
  const r = git(cwd, ['push', remote, `${NOTES_REF}:${NOTES_REF}`], { encoding: 'utf8', timeout: 60000 });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

// The remote's notes as last fetched or pushed: a ref of their own, never the local one.
export const trackRef = (remote = 'origin') => `refs/notes/remotes/${remote}/waymark`;
const fetchSpec = (remote) => `+${NOTES_REF}*:${trackRef(remote)}*`;
const exactSpec = (remote) => `+${NOTES_REF}:${trackRef(remote)}`; // 2.0.3's: it breaks fetch while the remote has no notes
const refSha = (cwd, ref) => { const r = git(cwd, ['rev-parse', '-q', '--verify', ref], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
export const hasRemote = (cwd, remote = 'origin') => git(cwd, ['remote', 'get-url', remote], { encoding: 'utf8' }).status === 0;
export const hasFetchSpec = (cwd, remote = 'origin') => git(cwd, ['config', '--get-all', `remote.${remote}.fetch`], { encoding: 'utf8' }).stdout?.split('\n').some((l) => l.trim() === fetchSpec(remote)) || false;

// Joins the remote's notes (the tracking ref) into the local ref when the remote has note commits the local lacks.
// A note both sides wrote on the same commit keeps the local one (strategy ours: its stub in the log hashes it).
// → true when merged.
export function mergeNotes(cwd, remote = 'origin') {
  const theirs = refSha(cwd, trackRef(remote));
  if (!theirs) return false;
  const ours = refSha(cwd, NOTES_REF);
  if (ours && (ours === theirs || git(cwd, ['merge-base', '--is-ancestor', theirs, ours]).status === 0)) return false;
  const merge = (ident = []) => git(cwd, [...ident, 'notes', `--ref=${NOTES_REF}`, 'merge', '-q', '-s', 'ours', trackRef(remote)], { encoding: 'utf8' });
  let r = merge();
  if (r.status !== 0 && /identity|who you are|empty ident/i.test(r.stderr || '')) r = merge(['-c', 'user.name=waymark', '-c', 'user.email=waymark@localhost']);
  return r.status === 0;
}

// Note commits of the local ref the remote lacks (against the tracking ref, no network). → a count, 0 with no local
// notes, or null when it cannot be known (no tracking ref yet).
export function unpushedNotes(cwd, remote = 'origin') {
  const ours = refSha(cwd, NOTES_REF);
  if (!ours) return 0;
  if (!refSha(cwd, trackRef(remote))) return null;
  const r = git(cwd, ['rev-list', '--count', `${trackRef(remote)}..${NOTES_REF}`], { encoding: 'utf8' });
  return r.status === 0 ? Number(r.stdout.trim()) : null;
}
// The hook pushes the notes after a push it saw when the remote may lack some (unknown counts as lacking).
export const shouldPushNotes = (cwd, remote = 'origin') => { const n = unpushedNotes(cwd, remote); return n === null || n > 0; };

// The fetch refspec, added once to .git/config (no network); an exact one from 2.0.3 is replaced. → true when added.
export function ensureFetchSpec(cwd, remote = 'origin') {
  if (!hasRemote(cwd, remote) || hasFetchSpec(cwd, remote)) return false;
  git(cwd, ['config', '--fixed-value', '--unset-all', `remote.${remote}.fetch`, exactSpec(remote)]);
  return git(cwd, ['config', '--add', `remote.${remote}.fetch`, fetchSpec(remote)]).status === 0;
}

// `waymark.mjs notes setup`: the fetch refspec (ensureFetchSpec), a fetch of the notes and the merge. → { ok, added, merged, output }
export function notesSetup(cwd, remote = 'origin') {
  if (!hasRemote(cwd, remote)) return { ok: false, added: false, merged: false, output: `no remote ${remote}` };
  const added = ensureFetchSpec(cwd, remote);
  if (!hasFetchSpec(cwd, remote)) return { ok: false, added: false, merged: false, output: 'git config failed' };
  const f = git(cwd, ['fetch', remote, fetchSpec(remote)], { encoding: 'utf8', timeout: 60000 });
  const output = `${f.stdout || ''}${f.stderr || ''}`.trim();
  // a remote with no notes yet answers "couldn't find remote ref": the refspec stays for when it has them
  if (f.status !== 0 && !/couldn't find remote ref/i.test(output)) return { ok: false, added, merged: false, output };
  return { ok: true, added, merged: mergeNotes(cwd, remote), output };
}
