// Waymark · moves the learned sections of a project's memory.md (Solved problems, Gotchas, Decisions) to engram, the
// learned layer (docs/adr/0015), so memory.md stays the project manual. Each entry is saved once (topic = section +
// hash of its text, so a second run updates instead of duplicating); the sections leave memory.md and their text is
// appended whole to .waymark/history.md first. Dry run by default; --apply after the user's yes. `waymark.mjs check`
// reports a project that still has them.
// Usage: node learned.mjs [--apply]   (from the project folder)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { projectHome, maskSecrets } from './provenance.mjs';
import { engramBin, ensureConfig } from './engram.mjs';

export const SECTIONS = [['Solved problems', 'bugfix'], ['Gotchas', 'learning'], ['Decisions', 'decision']];
const HEAD = (title) => new RegExp(`\\n## ${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`);

// → [{ section, type, text }] for every "- " entry of the learned sections (placeholders and comments skipped).
export function learnedEntries(memoryText) {
  const out = [];
  for (const [title, type] of SECTIONS) {
    const body = ('\n' + memoryText).match(HEAD(title))?.[1] || '';
    for (const l of body.split('\n')) {
      const text = l.replace(/^\s*-\s*/, '').trim();
      if (/^\s*-/.test(l) && text && text !== '…' && !/^\[YYYY-MM-DD\]/.test(text)) out.push({ section: title, type, text });
    }
  }
  return out;
}

// Saves the entries to engram, then removes the sections from memory.md (their text appended to history.md). → the
// number moved, or null when engram is missing.
export function moveLearned(home, now = new Date()) {
  const text = fs.readFileSync(home.memory, 'utf8'), entries = learnedEntries(text);
  if (!entries.length) return 0;
  const bin = engramBin();
  if (!bin) return null;
  const project = ensureConfig(home);
  for (const e of entries) {
    const title = e.text.replace(/^\[\d{4}-\d\d-\d\d\]\s*/, '').replace(/^Symptom:\s*/i, '').split(/\s·\s|—/)[0].trim().slice(0, 90);
    const topic = `waymark/memory/${e.section.toLowerCase().replace(/\s+/g, '-')}/${crypto.createHash('sha256').update(e.text).digest('hex').slice(0, 10)}`;
    const r = spawnSync(bin[0], [...bin.slice(1), 'save', maskSecrets(title), maskSecrets(e.text), '--type', e.type, '--project', project, '--topic', topic], { cwd: home.root, encoding: 'utf8', timeout: 5000, env: { ...process.env, ENGRAM_NO_UPDATE_CHECK: '1' } });
    if (r.status !== 0) throw new Error(`engram save failed: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}`);
  }
  let kept = '\n' + text, moved = '';
  for (const [title] of SECTIONS) kept = kept.replace(new RegExp(`\\n## ${title}[^\\n]*\\n[\\s\\S]*?(?=\\n## |$)`), (m) => { moved += m; return ''; });
  fs.appendFileSync(path.join(path.dirname(home.memory), 'history.md'), `\n<!-- moved to engram on ${now.toISOString().slice(0, 10)} (docs/adr/0015) -->${moved}\n`);
  fs.writeFileSync(home.memory, kept.slice(1).replace(/\n{3,}/g, '\n\n'));
  return entries.length;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const home = projectHome(process.cwd());
  if (!fs.existsSync(home.memory) || home.legacy) { console.log('No project memory in .waymark/ here.'); process.exit(0); }
  const entries = learnedEntries(fs.readFileSync(home.memory, 'utf8'));
  if (!entries.length) { console.log('memory.md has no learned sections left: nothing to move.'); process.exit(0); }
  if (!process.argv.includes('--apply')) {
    console.log(`Plan (dry run): ${entries.length} entries move from ${home.memory} to engram (project ${home.slug}); the sections leave memory.md and their text goes to history.md first.`);
    for (const e of entries) console.log(`- [${e.section} → ${e.type}] ${e.text.slice(0, 120)}`);
    console.log('Ask the user, then re-run with --apply.');
    process.exit(0);
  }
  const n = moveLearned(home);
  console.log(n === null ? 'engram is not installed: nothing moved (waymark.mjs check offers it).' : `moved ${n} entries to engram (project ${home.slug}); memory.md keeps the manual, history.md the moved text.`);
}
