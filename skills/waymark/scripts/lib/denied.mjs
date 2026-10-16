// The tool calls the sensitive-path guard denied, per session: written by the pre-tool hook, read by the end-of-turn hook
// so the task's record says what was stopped (docs/adr/0027).
import path from 'node:path';
import { waymarkHome } from './paths.mjs';
import { readJson } from './fs.mjs';
import fs from 'node:fs';

export const DENIED = () => path.join(waymarkHome(), '.denied.json');
export function addDenied(session, entry, file = DENIED()) {
  const all = readJson(file, {});
  for (const [k, v] of Object.entries(all)) if (Date.now() - (v.at || 0) > 7 * 86400000) delete all[k];
  const cur = all[session || 'unknown'] || { at: 0, list: [] };
  all[session || 'unknown'] = { at: Date.now(), list: [...cur.list, { ...entry, at: Date.now() }].slice(-50) };
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(all)); } catch {}
}
// → the denials of the session since `since` (ms).
export const deniedSince = (session, since = 0, file = DENIED()) => (readJson(file, {})[session || 'unknown']?.list || []).filter((d) => d.at >= since);
