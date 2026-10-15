// What the turn was built with, the commits of a task and the working-tree snapshot that gives the files a turn really changed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { waymarkHome as HOME } from '../lib/paths.mjs';
import { sha } from '../lib/hash.mjs';

const fileSha = (p) => { try { return sha(fs.readFileSync(p)).slice(0, 16); } catch { return null; } };

// What the task was built with, from the turn's transcript lines (from its prompt on) and the instruction files.
export function turnInputs(lines, cwd, userInstructions = path.join(os.homedir(), '.claude', 'CLAUDE.md')) { // the agent adapter names its file
  let model = null, agent = null;
  const mcp = new Set();
  for (const d of lines) {
    if (d.version) agent = d.version;
    if (d.type !== 'assistant' || d.isSidechain) continue;
    if (d.message?.model) model = d.message.model;
    for (const c of d.message?.content || []) if (c.type === 'tool_use' && /^mcp__/.test(c.name)) mcp.add(c.name.split('__')[1]);
  }
  let waymark = null;
  try { waymark = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'VERSION'), 'utf8').trim(); } catch {}
  const project = ['CLAUDE.md', 'AGENTS.md'].map((f) => path.join(cwd, f)).find((p) => fs.existsSync(p));
  return { waymark, agent, model, mcp: [...mcp], instructions: { user: fileSha(userInstructions), project: project ? fileSha(project) : null } };
}

// Commits that carry `Waymark-Task: <id>` among the last 30 of the repo at cwd (git missing or no repo → []). The line
// counts anywhere in the message, not only as a git trailer: one separated from Co-Authored-By by a blank line is not
// in the last paragraph, so git does not read it as a trailer.
export function commitsFor(cwd, id) {
  if (!id) return [];
  const r = spawnSync('git', ['log', '-30', '--format=%H%x1f%B%x1e'], { cwd, encoding: 'utf8', timeout: 1500 });
  if (r.status !== 0) return [];
  return r.stdout.split('\x1e').map((c) => c.replace(/^\s+/, '').split('\x1f'))
    .filter(([h, msg]) => h && String(msg || '').split(/\r?\n/).some((l) => l.match(/^\s*Waymark-Task:\s*(.+?)\s*$/i)?.[1] === id)).map(([h]) => h);
}

// Working-tree snapshot of the repo at cwd: { root, head, files: { <absolute path>: <content hash | "deleted"> } } for every
// path git reports as changed or untracked; null without git or a repo. Two snapshots (prompt → end of turn) give the
// files the turn really changed, whatever tool changed them (`git checkout`, a script, a formatter), not only the
// files written with Edit/Write.
export function gitSnapshot(cwd) {
  const git = (...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 1500, maxBuffer: 8 * 1024 * 1024 });
  const top = git('rev-parse', '--show-toplevel');
  if (top.status !== 0) return null;
  const root = top.stdout.trim(), head = git('rev-parse', 'HEAD').stdout.trim() || null;
  const st = git('status', '--porcelain=v1', '-z', '--untracked-files=all');
  if (st.status !== 0) return null;
  const files = {};
  const parts = st.stdout.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    if (/^[RC]/.test(e)) i++; // rename/copy: the next entry is the source path
    const abs = path.join(root, e.slice(3));
    files[abs] = fs.existsSync(abs) && fs.statSync(abs).isFile() ? fileSha(abs) : 'deleted';
  }
  return { root, head, files };
}

// Paths whose state differs between two snapshots: newly changed, changed again, or back to clean (e.g. `git checkout --`).
export function snapshotDiff(before, after) {
  if (!before || !after || before.root !== after.root) return [];
  const out = new Set();
  for (const [p, h] of Object.entries(after.files)) if (before.files[p] !== h) out.add(p);
  // Back to clean: a change only when the content differs from before (git checkout --); a commit keeps the content.
  for (const [p, h] of Object.entries(before.files)) if (!(p in after.files) && (h === 'deleted' ? fs.existsSync(p) : fileSha(p) !== h)) out.add(p);
  return [...out];
}

// Snapshot taken by the per-prompt hook, per session (~/.waymark/.turn-snapshot.json), read by the end-of-turn hook.
// `others`: the snapshots of other repos, each taken by the pre-tool hook before the first shell command that changes
// files there. `paused`: the turn ended asking the user (a task in progress), so the next prompt keeps this snapshot and
// the turn that resumes the task still sees what the paused one changed.
const snapFile = () => path.join(HOME(), '.turn-snapshot.json');
const readSnaps = () => { try { return JSON.parse(fs.readFileSync(snapFile(), 'utf8')) || {}; } catch { return {}; } };
const writeSnaps = (all) => {
  for (const [k, v] of Object.entries(all)) if (Date.now() - (v.at || 0) > 7 * 86400000) delete all[k];
  fs.mkdirSync(HOME(), { recursive: true });
  fs.writeFileSync(snapFile(), JSON.stringify(all));
};
export function saveSnapshot(session, cwd) {
  const all = readSnaps(), id = session || 'unknown';
  if (all[id]?.paused) { all[id].paused = false; writeSnaps(all); return all[id].snap; }
  const snap = gitSnapshot(cwd);
  all[id] = { at: Date.now(), cwd, snap };
  writeSnaps(all);
  return snap;
}
export function loadSnapshot(session) {
  return readSnaps()[session || 'unknown']?.snap || null;
}
// Before a shell command changes files in another repo: that repo's snapshot, once per turn. → true when taken.
export function addRepoSnapshot(session, dir) {
  const all = readSnaps(), entry = all[session || 'unknown'];
  if (!entry) return false;
  const snap = gitSnapshot(dir);
  if (!snap || snap.root === entry.snap?.root || entry.others?.[snap.root]) return false;
  entry.others = { ...(entry.others || {}), [snap.root]: snap };
  writeSnaps(all);
  return true;
}
// The turn ended asking the user: the next prompt keeps the snapshot (saveSnapshot).
export function markPaused(session) {
  const all = readSnaps(), entry = all[session || 'unknown'];
  if (!entry) return false;
  entry.paused = true;
  writeSnaps(all);
  return true;
}
// Files the turn changed, by any tool: the session's repo and every other repo snapshotted during the turn.
export function turnChanged(session, cwd) {
  const entry = readSnaps()[session || 'unknown'];
  const out = snapshotDiff(entry?.snap || null, gitSnapshot(cwd));
  for (const snap of Object.values(entry?.others || {})) out.push(...snapshotDiff(snap, gitSnapshot(snap.root)));
  return [...new Set(out)];
}
