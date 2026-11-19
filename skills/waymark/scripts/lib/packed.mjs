// The files whose pack (what earlier tasks did there) this session's current task already got; written by the
// pre/after-tool hook, read by the end-of-turn hook for the Recordar testigo. Task = since its last close.
import path from 'node:path';
import { waymarkHome } from './paths.mjs';
import { readJson } from './fs.mjs';

export const PACKED = () => path.join(waymarkHome(), '.packed.json');
export const readPacked = (file = PACKED()) => readJson(file, {});
// → Set of normalized paths.
export function packedFiles(session, since = 0, file = PACKED()) {
  const st = readPacked(file)[session || 'unknown'];
  return new Set(st && st.since === since ? st.files : []);
}
// → true when the hook handed something over at this task's first change, even with no file to name (a script, a variable path, a new folder): nothing was left for the agent to search.
export function packedAny(session, since = 0, file = PACKED()) {
  const st = readPacked(file)[session || 'unknown'];
  return !!st && st.since === since;
}
// → Set of department names whose procedures.md the hook already handed over in this session and task.
export function procDelivered(session, since = 0, file = PACKED()) {
  const st = readPacked(file)[session || 'unknown'];
  return new Set(st && st.since === since ? st.procs || [] : []);
}
// → Set of those handed over only when the department was loaded after the task's first change: read, but too late to guide it.
export function procLate(session, since = 0, file = PACKED()) {
  const st = readPacked(file)[session || 'unknown'];
  return new Set(st && st.since === since ? st.late || [] : []);
}
// → { first: { dept, at } | null, deliveries: [{ dept, by: 'edit' | 'load', late?, at }] }: the route at the task's first change and what the hook handed, in order (the record keeps it, docs/adr/0065).
export function procHistory(session, since = 0, file = PACKED()) {
  const st = readPacked(file)[session || 'unknown'];
  return st && st.since === since ? { first: st.first || null, deliveries: st.deliveries || [] } : { first: null, deliveries: [] };
}
