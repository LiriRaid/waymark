// git in a folder; the caller picks encoding and timeout when the default does not fit.
import { spawnSync } from 'node:child_process';

export const git = (cwd, args, opts = {}) => spawnSync('git', args, { cwd, timeout: 8000, maxBuffer: 32 * 1024 * 1024, ...opts });

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
