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
