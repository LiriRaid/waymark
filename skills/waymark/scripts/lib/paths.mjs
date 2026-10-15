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
