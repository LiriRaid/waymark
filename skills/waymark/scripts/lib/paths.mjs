// One definition of the path helpers every script used to copy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The command that runs waymark.mjs from anywhere: it is a script, not a program on the PATH, so every message that tells
// someone to run it carries this full form.
export const WAYMARK_CMD = `node "${path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'waymark.mjs').replace(/\\/g, '/')}"`;

// The private layer's folder; read at call time because tests and installs set WAYMARK_HOME after load.
export const waymarkHome = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');

// Separators only: the shape a path is shown and compared in, case and trailing slash kept.
export const slash = (p) => String(p).replace(/\\/g, '/');

// The key two spellings of one path share: forward slashes, lower case, no trailing slash. A filesystem root keeps
// its slash ('c:/', '/') so `norm(root) + '/…'` and a prefix test still read right.
export const norm = (p) => {
  const s = String(p || '').replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
  return s === '' && /\//.test(String(p || '')) ? '/' : /^[a-z]:$/.test(s) ? `${s}/` : s;
};

// A path as the filesystem spells it: links and junctions resolved and, on Windows, 8.3 short names expanded
// (C:\Users\RUNNER~1 → C:\Users\runneradmin), so the path an agent typed and the root git reports compare equal. A path
// that does not exist yet keeps its missing tail on the real form of its nearest existing folder.
export const real = (p) => {
  const abs = path.resolve(String(p || '.'));
  const tail = [];
  for (let head = abs; ; head = path.dirname(head)) {
    try { return path.join(fs.realpathSync.native(head), ...tail); } catch {}
    if (path.dirname(head) === head) return abs;
    tail.unshift(path.basename(head));
  }
};

// Files the routine itself writes (memory, learnings, scratch) are not the project's. The OS temp folder is the one Node
// reports (TMPDIR on macOS, /var/folders/…; TEMP on Windows). A project whose own root lives under a scratch place (a
// checkout or a clone there) is still a project: `root`, the folder the agent works in, takes its files out of the
// scratch rule. The temp folder itself is never a project root. Each path is read as written and as the filesystem
// spells it (`real`), so a file and a root written through different names of one folder still match.
let realTmp = null; // the temp folder's real spelling, once per process (keyed by what os.tmpdir() says now)
const tmpReal = () => { const t = os.tmpdir(); if (realTmp?.t !== t) realTmp = { t, r: norm(real(t)) }; return realTmp.r; };
export const exemptPath = (file, root = '') => {
  const f = norm(file), F = norm(real(file)), home = norm(os.homedir()), tmp = norm(os.tmpdir()), TMP = tmpReal();
  // a directory entry (git lists an untracked folder alone) is matched like the files in it
  if ([`${f}/`, `${F}/`].some((d) => d.startsWith(`${home}/.waymark/`) || d.includes('/.waymark/') || d.includes('/.claude/projects/'))) return true;
  const scratch = (x) => x.includes('/appdata/local/temp/') || x.startsWith('/tmp/') || (tmp && x.startsWith(`${tmp}/`)) || (TMP && x.startsWith(`${TMP}/`)) || x.includes('/scratchpad/');
  if (!scratch(f) && !scratch(F)) return false;
  if (!root) return true;
  const r = norm(root), R = norm(real(root)), isTmp = (x) => x === tmp || x === TMP || x === '/tmp';
  return !(!isTmp(r) && !isTmp(R) && (f.startsWith(`${r}/`) || F.startsWith(`${R}/`)));
};
