#!/usr/bin/env node
// Waymark · moves a project's memory and provenance record from ~/.waymark into the project (docs/adr/0007).
//   node migrate-memory.mjs --project <path>   one project (the old memory file whose Path holds it)
//   node migrate-memory.mjs --all              every project in ~/.waymark/projects/ not migrated yet
//   add --apply to write; without it this is a dry run that only prints the plan.
// Per project: back up the old files, copy memory.md and provenance.jsonl byte for byte (the hash chain must verify the
// same after the copy), write .waymark/README.md and tasks.md, add .waymark/ to the project's .gitignore, leave a `Moved:` stub
// in the old memory file (the bridge then skips it), remove the old log and point the projects.md row to the new file.
// It never overwrites: a project that already has <root>/.waymark/memory.md is skipped. Offline, no dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyMemory, readRecords, verifyChain, projectHome, ensureLocal, refreshTasks } from './provenance.mjs';

const HOME = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const BACKUPS = () => process.env.WAYMARK_BACKUPS || path.join(path.dirname(HOME()), '.waymark-backups');
const stamp = (d = new Date()) => `${d.toLocaleDateString('sv')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

// → { slug, root, from: { memory, log }, to: { dir, memory, log }, records, chain, skip?, steps[] }
export function planFor(old) {
  const to = { dir: path.join(old.root, '.waymark') };
  to.memory = path.join(to.dir, 'memory.md'); to.log = path.join(to.dir, 'provenance.jsonl');
  const from = { memory: old.file, log: path.join(HOME(), 'provenance', `${old.slug}.jsonl`) };
  const records = readRecords(from.log), chain = verifyChain(records);
  const plan = { slug: old.slug, root: old.root, from, to, records: records.length, chain, steps: [] };
  if (!fs.existsSync(old.root)) plan.skip = `the project folder ${old.root} does not exist on this machine`;
  else if (fs.existsSync(to.memory)) plan.skip = `${to.memory} already exists (never overwritten)`;
  else if (fs.existsSync(to.log)) plan.skip = `${to.log} already exists (never overwritten; merge it by hand, then rerun)`;
  if (plan.skip) return plan;
  plan.steps.push(`back up the old files to ${BACKUPS()}/<stamp>-migrate-memory/${old.slug}/`,
    `copy ${from.memory} → ${to.memory}`,
    fs.existsSync(from.log) ? `copy ${from.log} → ${to.log} (${records.length} records, chain ${chain.ok ? 'ok' : `broken at record ${chain.at}, copied as is`})` : 'no provenance log yet (it starts at the next closed task)',
    `write ${to.dir}/README.md and tasks.md; add .waymark/ to the project's .gitignore`,
    `leave a Moved: stub in ${from.memory}${fs.existsSync(from.log) ? `, remove ${from.log}` : ''}; point the projects.md row to ${to.memory}`);
  return plan;
}

export function apply(plan, now = new Date()) {
  const bk = path.join(BACKUPS(), `${stamp(now)}-migrate-memory`, plan.slug);
  fs.mkdirSync(bk, { recursive: true });
  const index = path.join(HOME(), 'projects.md');
  for (const f of [plan.from.memory, plan.from.log, index]) if (fs.existsSync(f)) fs.copyFileSync(f, path.join(bk, path.basename(f)));
  fs.mkdirSync(plan.to.dir, { recursive: true });
  if (fs.existsSync(plan.from.log)) { // the log first: memory.md is what makes the hooks switch to the new folder
    fs.copyFileSync(plan.from.log, plan.to.log);
    const copied = readRecords(plan.to.log);
    if (verifyChain(copied).ok !== plan.chain.ok || copied.length !== plan.records) {
      fs.rmSync(plan.to.log);
      throw new Error(`the copied log of ${plan.slug} does not verify like the original: copy removed, old files untouched, backup in ${bk}`);
    }
  }
  fs.copyFileSync(plan.from.memory, plan.to.memory);
  const home = projectHome(plan.root);
  ensureLocal(home);
  refreshTasks(home, true);
  const text = fs.readFileSync(plan.from.memory, 'utf8');
  fs.writeFileSync(plan.from.memory, `# Project: ${plan.slug}\n\n${text.match(/^Path:[^\n]*/m)?.[0] || `Path: ${plan.root}`}\nMoved: ${plan.to.memory.replace(/\\/g, '/')} (Waymark 2.0, ${now.toLocaleDateString('sv')}; backup ${bk.replace(/\\/g, '/')})\n`);
  if (fs.existsSync(plan.from.log)) fs.rmSync(plan.from.log);
  if (fs.existsSync(index)) {
    const rows = fs.readFileSync(index, 'utf8').split('\n').map((l) => (l.startsWith(`| ${plan.slug} |`) ? l.replace(`projects/${plan.slug}.md`, plan.to.memory.replace(/\\/g, '/')) : l));
    fs.writeFileSync(index, rows.join('\n'));
  }
  return bk;
}

function oldProjects() {
  const dir = path.join(HOME(), 'projects');
  const out = [];
  try {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md'))) {
      const text = fs.readFileSync(path.join(dir, f), 'utf8');
      const root = text.match(/^Path:\s*([^·\n]+)/m)?.[1]?.trim();
      if (root && !/^Moved:/m.test(text)) out.push({ slug: f.slice(0, -3), file: path.join(dir, f), root: root.replace(/\\/g, '/') });
    }
  } catch {}
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), write = args.includes('--apply');
  const p = args[args.indexOf('--project') + 1];
  const olds = args.includes('--all') ? oldProjects() : args.includes('--project') && p ? [legacyMemory(path.resolve(p))].filter(Boolean) : null;
  if (!olds) { console.log('Usage: node migrate-memory.mjs --project <path> | --all [--apply]'); process.exit(1); }
  if (!olds.length) { console.log('Nothing to migrate: no project memory left in ~/.waymark/projects/ for that folder.'); process.exit(0); }
  let failed = 0;
  for (const old of olds) {
    const plan = planFor(old);
    console.log(`\n${plan.slug} (${plan.root})`);
    if (plan.skip) { console.log(`  skip: ${plan.skip}`); continue; }
    for (const s of plan.steps) console.log(`  - ${s}`);
    if (!write) continue;
    try { console.log(`  done · backup ${apply(plan)}`); } catch (e) { failed++; console.log(`  FAILED: ${e.message}`); }
  }
  if (!write) console.log('\nDry run: nothing was written. Add --apply to migrate.');
  process.exit(failed ? 1 : 0);
}
