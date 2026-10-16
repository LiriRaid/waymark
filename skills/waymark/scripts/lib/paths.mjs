// One definition of the path helpers every script used to copy.
import os from 'node:os';
import path from 'node:path';

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

// Files the routine itself writes (memory, learnings, scratch) are not the project's. The OS temp folder is the one Node
// reports (TMPDIR on macOS, /var/folders/…; TEMP on Windows). A project whose own root lives under a scratch place (a
// checkout or a clone there) is still a project: `root`, the folder the agent works in, takes its files out of the
// scratch rule. The temp folder itself is never a project root.
export const exemptPath = (file, root = '') => {
  const f = norm(file), home = norm(os.homedir()), tmp = norm(os.tmpdir());
  const d = `${f}/`; // a directory entry (git lists an untracked folder alone) is matched like the files in it
  if (d.startsWith(`${home}/.waymark/`) || d.includes('/.waymark/') || d.includes('/.claude/projects/')) return true;
  if (!(f.includes('/appdata/local/temp/') || f.startsWith('/tmp/') || (tmp && f.startsWith(`${tmp}/`)) || f.includes('/scratchpad/'))) return false;
  const r = root ? norm(root) : '';
  return !(r && r !== tmp && r !== '/tmp' && f.startsWith(`${r}/`));
};
