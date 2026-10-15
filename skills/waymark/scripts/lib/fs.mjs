// One definition of the tolerant file helpers every script used to copy: a missing or broken file is the fallback.
import fs from 'node:fs';
import path from 'node:path';

export const read = (p, fallback = '') => { try { return fs.readFileSync(p, 'utf8'); } catch { return fallback; } };
export const readJson = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };
export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}
