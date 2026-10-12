#!/usr/bin/env node
// Copies the live, installed skills back into this repository so improvements learned while working
// can be reviewed and published.
// Usage: node scripts/export.mjs [<skills-dir>] [--strip-learned]
//   <skills-dir>     installed skills folder (default: ~/.agents/skills, the one real copy every agent reads)
//   --strip-learned  empty the "Learned rules / Learned notes" lists (personal experience) in the export
// The private layer ~/.waymark/ is never exported. Review the diff with git before committing.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const strip = args.includes('--strip-learned');
const live = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(os.homedir(), '.agents', 'skills'));
const out = path.join(repo, 'skills');
const mapFile = path.join(live, 'waymark', 'skill-map.json');
if (!fs.existsSync(mapFile)) { console.error(`No Waymark found in ${live}`); process.exit(1); }
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));

const names = [
  'waymark',
  ...fs.readdirSync(live).filter((n) => /^dept-/.test(n)),
  ...Object.entries(map.skills).filter(([, e]) => e.owned).map(([n]) => n),
].filter((n, i, all) => all.indexOf(n) === i && fs.existsSync(path.join(live, n, 'SKILL.md')));

for (const n of names) {
  fs.rmSync(path.join(out, n), { recursive: true, force: true });
  fs.cpSync(path.join(live, n), path.join(out, n), { recursive: true, dereference: true });
  if (n === 'waymark') {
    const mf = path.join(out, n, 'skill-map.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    for (const [k, e] of Object.entries(m.skills)) if (e.auto && e.origin && e.origin !== 'user') delete m.skills[k];
    fs.writeFileSync(mf, JSON.stringify(m, null, 2) + '\n');
  }
  if (!strip) continue;
  const f = path.join(out, n, 'SKILL.md');
  const t = fs.readFileSync(f, 'utf8').replace(/(\n## Learned (?:rules|notes)\n\n_[^\n]*_\n)[\s\S]*$/, '$1');
  fs.writeFileSync(f, t);
}
console.log(`Exported ${names.length} skills from ${live} to ${out}${strip ? ' (learned lists stripped)' : ''}:\n  ${names.join(', ')}`);
