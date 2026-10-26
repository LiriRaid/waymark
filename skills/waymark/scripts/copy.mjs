// Waymark · clean copies of the repository (docs/adr/0046). A task that must show a failure at HEAD, or a spec red before its code, runs in a
// copy of the repo: Waymark owns the folder (a short path under ~/.waymark/tmp, never one the agent invents under the disk root or a long temp
// path), makes it with `git worktree add`, removes it with a delete that retries and checks that it is gone, and lists the ones nobody removed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { waymarkHome } from './lib/paths.mjs';

export const copyRoot = () => path.join(waymarkHome(), 'tmp');
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8', timeout: 60000 });
const gitRoot = (dir) => { const r = git(dir, 'rev-parse', '--show-toplevel'); return r.status === 0 ? r.stdout.trim() : null; };

// A path is the root's own child: a delete never reaches anything else.
export const inRoot = (p, root = copyRoot()) => {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
};

// A copy of `ref` (default HEAD) of the repository at `cwd`, in the next free numbered folder of the root. → { path, install } or { error }.
// `install` is the stack's own command for a Node repo (from the package store, never a link to the repo's node_modules), or null.
export function makeCopy(cwd, ref = 'HEAD', { install = null } = {}) {
  const top = gitRoot(cwd);
  if (!top) return { error: 'not inside a git repository' };
  fs.mkdirSync(copyRoot(), { recursive: true });
  let n = 1, r = null, dest = '';
  for (let tries = 0; tries < 5; tries++) { // another session may take the same number in the same instant: the next free one
    while (fs.existsSync(path.join(copyRoot(), String(n)))) n++;
    dest = path.join(copyRoot(), String(n));
    r = git(top, 'worktree', 'add', '--detach', dest, ref);
    if (r.status === 0) return { path: dest, install };
  }
  return { error: `git worktree add failed: ${(r.stderr || r.stdout).trim().slice(0, 200)}` };
}

// Removes a copy of the root: its worktree entry, then the folder, retrying (an antivirus or an editor holds a file for a moment on Windows;
// node_modules is deep), and prunes. → { removed, left } where `left` is true when the folder still exists.
export function removeCopy(p, { cwd = process.cwd() } = {}) {
  if (!inRoot(p)) return { removed: false, left: fs.existsSync(p), error: `${p} is not a copy of Waymark's (${copyRoot()})` };
  const top = gitRoot(cwd);
  if (top) git(top, 'worktree', 'remove', '--force', p);
  for (let i = 0; i < 6 && fs.existsSync(p); i++) { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }
  if (top) git(top, 'worktree', 'prune');
  return { removed: !fs.existsSync(p), left: fs.existsSync(p) };
}

// The folders left behind: every copy in the root, and the temp folders of Waymark's tests and of an agent's own improvised copies
// (a git worktree an agent improvised under any name, wm-*, waymark-*, tmp.*) in the OS temp folder and at the top of the disk, older than `maxAgeMs`
// (a running task's is not one). A worktree is told by what it is, never by a project's name: its `.git` is a file that points to the repository.
const ORPHAN = /^(?:wm-|waymark-)/;
const worktree = (p) => { try { return /^gitdir:/.test(fs.readFileSync(path.join(p, '.git'), 'utf8')); } catch { return false; } };
// `tmp.*` is what other programs name their scratch folders too: it is a leftover of ours only when it holds a repository copy or its modules.
const ours = (p, name) => ORPHAN.test(name) || worktree(p) || (/^tmp\./.test(name) && ['.git', 'node_modules'].some((e) => fs.existsSync(path.join(p, e))));
export function orphans({ maxAgeMs = 6 * 3600000, now = Date.now(), places = [copyRoot(), os.tmpdir(), path.parse(os.tmpdir()).root], home = os.homedir() } = {}) {
  const out = [];
  // the home: only the .wm-* folders older versions of the test suite made there (never another folder of the user's)
  try { for (const name of fs.readdirSync(home)) if (/^\.wm-/.test(name)) { const p = path.join(home, name); const st = fs.statSync(p); if (st.isDirectory() && now - st.mtimeMs > maxAgeMs) out.push({ path: p, ageH: Math.round((now - st.mtimeMs) / 3600000) }); } } catch {}
  for (const dir of [...new Set(places)]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const p = path.join(dir, name);
      if (dir !== copyRoot() && !ours(p, name)) continue;
      if (dir === path.parse(os.tmpdir()).root && !ORPHAN.test(name) && !worktree(p)) continue; // the top of the disk: only Waymark's names and improvised worktrees
      if (dir === copyRoot() && name.startsWith('.')) continue;
      try { const st = fs.statSync(p); if (st.isDirectory() && now - st.mtimeMs > maxAgeMs) out.push({ path: p, ageH: Math.round((now - st.mtimeMs) / 3600000) }); } catch {}
    }
  }
  return out;
}

// Removes the orphans (the user said yes). → { removed: n, left: [paths] }
export function cleanOrphans(list = orphans()) {
  const left = [];
  let removed = 0;
  for (const { path: p } of list) {
    for (let i = 0; i < 6 && fs.existsSync(p); i++) { try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }
    if (fs.existsSync(p)) left.push(p); else removed++;
  }
  return { removed, left };
}

// Copies of the root a task made since `since` (ms): the close removes them, so none outlives its task. → { removed: [paths], left: [paths] }
export function closeCopies(since, cwd = process.cwd()) {
  const removed = [], left = [];
  let names = [];
  try { names = fs.readdirSync(copyRoot()); } catch { return { removed, left }; }
  // only the copies of this repository's own worktree list: another session's copy of another repo is not this task's to remove
  const top = gitRoot(cwd), mine = new Set(top ? git(top, 'worktree', 'list', '--porcelain').stdout.split('\n').filter((l) => l.startsWith('worktree ')).map((l) => path.resolve(l.slice(9)).toLowerCase()) : []);
  for (const name of names) {
    const p = path.join(copyRoot(), name);
    try { if (!fs.statSync(p).isDirectory() || name.startsWith('.') || fs.statSync(p).birthtimeMs < since || !mine.has(path.resolve(p).toLowerCase())) continue; } catch { continue; }
    (removeCopy(p, { cwd }).left ? left : removed).push(p);
  }
  return { removed, left };
}
