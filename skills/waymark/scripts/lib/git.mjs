// git in a folder; the caller picks encoding and timeout when the default does not fit.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, timeout: 8000, maxBuffer: 32 * 1024 * 1024, ...opts });

// The repo-relative paths HEAD never held under any name: files new to git and untracked ones, not a renamed or moved file (a rename pairs with its old path, and an
// unstaged move of the same name leaves that name deleted). One diff and one listing; an empty set outside a repository or before the first commit, so nothing is called new.
export function addedPaths(root) {
  const run = (...a) => { try { return String(git(root, a, { encoding: 'utf8', timeout: 3000 }).stdout || ''); } catch { return ''; } };
  const added = new Set(), gone = new Set();
  for (const l of run('diff', '-M', '--name-status', 'HEAD').split('\n').filter(Boolean)) { const [st, ...p] = l.split('\t'); if (st === 'A') added.add(p[0]); else if (st === 'D') gone.add(path.basename(p[0])); }
  if (!added.size && !gone.size && !run('rev-parse', '--verify', 'HEAD').trim()) return new Set(); // before the first commit nothing is known to be new
  for (const f of run('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)) added.add(f);
  return new Set([...added].filter((f) => !gone.has(path.basename(f))));
}

// The repository root of a folder as git writes it, or null: asked once per folder in a run (a hook resolves the same folders from
// several checks, 40-60 ms each on Windows). Only a found root is kept, so a folder that becomes a repository later is asked again.
const TOPS = new Map();
export function topOf(dir) {
  const key = String(dir);
  if (TOPS.has(key)) return TOPS.get(key);
  let top = null;
  try { const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', timeout: 5000 }); top = r.status === 0 ? r.stdout.trim() || null : null; } catch {}
  if (top) TOPS.set(key, top);
  return top;
}

// ---- refs read from .git itself: a few file reads where each git call costs 30-60 ms on Windows ----
// The repository's own folder and its common folder (a worktree's `.git` is a file naming its folder, whose `commondir` names the shared one),
// or null when the files do not say it plainly: GIT_DIR set, no `.git` up the tree, or refs kept as a reftable. Each caller then asks git.
const DIRS = new Map(); // only a found repository is kept, as in topOf: a folder that becomes one later is looked at again
export function gitDirs(cwd) {
  if (process.env.GIT_DIR || process.env.GIT_COMMON_DIR) return null;
  const key = path.resolve(cwd || '.');
  if (DIRS.has(key)) return DIRS.get(key);
  const found = findDirs(key);
  if (found) DIRS.set(key, found);
  return found;
}
function findDirs(start) {
  let dir = start;
  for (;;) {
    const dot = path.join(dir, '.git');
    let st = null;
    try { st = fs.statSync(dot); } catch {}
    if (st) {
      let gitdir = dot;
      if (st.isFile()) { const m = fs.readFileSync(dot, 'utf8').match(/^gitdir:\s*(.+?)\s*$/m); if (!m) return null; gitdir = path.resolve(dir, m[1]); }
      let common = gitdir;
      try { common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch {}
      if (fs.existsSync(path.join(common, 'reftable'))) return null;
      return { gitdir, common };
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const PACKED = new Map(); // common folder → { mtime, rows }: parsed again only when the file changes
const packed = (common) => {
  const file = path.join(common, 'packed-refs');
  let mtime = null;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return []; }
  if (PACKED.get(common)?.mtime !== mtime) {
    let rows = [];
    try { rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !/^[#^]/.test(l)).map((l) => l.split(' ')); } catch {}
    PACKED.set(common, { mtime, rows });
  }
  return PACKED.get(common).rows;
};
// The sha a ref points to, from its loose file or packed-refs (a symbolic ref is followed); undefined when the files cannot say (ask git), null when there is no such ref.
export function refTip(dirs, ref, depth = 0) {
  if (!dirs || depth > 5) return undefined;
  for (const base of ref === 'HEAD' ? [dirs.gitdir] : [dirs.gitdir, dirs.common]) {
    let text = null;
    try { text = fs.readFileSync(path.join(base, ref), 'utf8').trim(); } catch { continue; }
    if (SHA.test(text)) return text;
    const sym = text.match(/^ref:\s*(\S+)$/);
    return sym ? refTip(dirs, sym[1], depth + 1) : undefined;
  }
  const row = packed(dirs.common).find(([, name]) => name === ref);
  return row && SHA.test(row[0]) ? row[0] : null;
}
// The tips of refs/notes/* (loose files and packed-refs) → Map(ref → sha), or undefined when the files cannot say.
export function noteTipsOf(dirs) {
  if (!dirs) return undefined;
  const out = new Map(packed(dirs.common).filter(([sha, name]) => name?.startsWith('refs/notes/') && SHA.test(sha)).map(([sha, name]) => [name, sha]));
  const walk = (rel) => {
    let names = [];
    try { names = fs.readdirSync(path.join(dirs.common, rel), { withFileTypes: true }); } catch { return; }
    for (const e of names) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r);
      else if (!e.name.endsWith('.lock')) { try { const sha = fs.readFileSync(path.join(dirs.common, r), 'utf8').trim(); if (SHA.test(sha)) out.set(r, sha); } catch {} } // gone since the listing: another process removed it
    }
  };
  walk('refs/notes');
  return out;
}
