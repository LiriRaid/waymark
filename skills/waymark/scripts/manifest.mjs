#!/usr/bin/env node
// Waymark · the manifest of a release (docs/adr/0027): the sha256 of every file under skills/, in skills/waymark/MANIFEST.json,
// so an installed copy can be compared with what was released, offline. The manifest never lists itself. Text files are
// hashed with CRLF read as LF, so a copy checked out on Windows matches one from Linux.
//   node manifest.mjs            check the manifest of this install against its files (exit 1 when it differs)
//   node manifest.mjs --write    rebuild it (the release checklist runs this; tests/supply-chain-verify.test.mjs checks it is current)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha } from './lib/hash.mjs';

export const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST_FILE = path.join(SKILLS, 'waymark', 'MANIFEST.json');
export const SCHEMA = 'waymark.manifest/v1';
const SKIP = new Set(['waymark/MANIFEST.json']);
const SKIP_DIR = /(^|\/)(node_modules|\.git|\.waymark|\.engram)(\/|$)/;

export const hashFile = (file) => {
  const buf = fs.readFileSync(file);
  return sha(buf.includes(0) ? buf : Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n')));
};

// → sorted relative paths (forward slashes) of every file under `dir`.
export function listFiles(dir = SKILLS) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name), rel = path.relative(dir, abs).split(path.sep).join('/');
      if (SKIP_DIR.test(rel)) continue;
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && !SKIP.has(rel)) out.push(rel);
    }
  };
  walk(dir);
  return out.sort();
}

export function buildManifest(dir = SKILLS) {
  const version = (() => { try { return fs.readFileSync(path.join(dir, 'waymark', 'VERSION'), 'utf8').trim(); } catch { return null; } })();
  const files = {};
  for (const rel of listFiles(dir)) files[rel] = hashFile(path.join(dir, rel));
  return { schema: SCHEMA, version, algorithm: 'sha256', files };
}

// Compares `dir` with a manifest (default: the one in this install). → { ok, version, checked, missing[], changed[], extra[] }.
export function checkManifest(dir = SKILLS, manifest = null) {
  const m = manifest || JSON.parse(fs.readFileSync(path.join(dir, 'waymark', 'MANIFEST.json'), 'utf8'));
  const missing = [], changed = [];
  for (const [rel, hash] of Object.entries(m.files || {})) {
    const abs = path.join(dir, rel);
    if (!fs.existsSync(abs)) missing.push(rel);
    else if (hashFile(abs) !== hash) changed.push(rel);
  }
  const extra = listFiles(dir).filter((rel) => !(rel in (m.files || {})));
  return { ok: !missing.length && !changed.length && !extra.length, version: m.version || null, checked: Object.keys(m.files || {}).length, missing, changed, extra };
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    const m = buildManifest();
    fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 1) + '\n');
    console.log(`manifest: ${Object.keys(m.files).length} files, version ${m.version}`);
  } else {
    const r = checkManifest();
    console.log(r.ok ? `manifest: ${r.checked} files match (version ${r.version})` : `manifest differs: ${r.changed.length} changed, ${r.missing.length} missing, ${r.extra.length} extra\n${[...r.changed.map((f) => `~ ${f}`), ...r.missing.map((f) => `- ${f}`), ...r.extra.map((f) => `+ ${f}`)].slice(0, 20).join('\n')}`);
    process.exitCode = r.ok ? 0 : 1;
  }
}
