#!/usr/bin/env node
// Waymark · what Waymark itself puts in the agent's context, by when it is loaded: every session (instructions block
// + context card), every prompt (reminder: full, or short after a reply that opened with "Waymark →"), and each
// department or tool skill when it is invoked. Characters are exact; tokens are an estimate (characters / 4). The
// real figure of a session, with the agent's own system prompt and tools, is `measure.mjs`. Offline, 0 model tokens.
// Usage: node size.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REMINDER } from './rule0-hook.mjs';
import { CARD_HEAD, digest } from './session-hook.mjs';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
export const tokens = (chars) => Math.round(chars / 4);

// → [{ group, name, chars }] for the folder whose project card is measured.
export function sizes(cwd) {
  const rows = [
    { group: 'session', name: 'instructions block', chars: read(path.join(SKILLS, 'waymark', 'templates', 'instructions.md')).length },
    { group: 'session', name: 'context card', chars: (() => { try { return (CARD_HEAD + digest(cwd)).length; } catch { return 0; } })() },
    { group: 'prompt', name: 'reminder (full)', chars: REMINDER.full.length },
    { group: 'prompt', name: 'reminder (short)', chars: REMINDER.short.length },
  ];
  for (const dir of fs.readdirSync(SKILLS).sort()) {
    const skill = read(path.join(SKILLS, dir, 'SKILL.md'));
    if (!skill || dir === 'waymark') continue;
    rows.push({ group: dir.startsWith('dept-') ? 'department' : 'tool', name: dir, chars: skill.length });
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = sizes(process.cwd());
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows)); process.exit(0); }
  const sum = (g) => rows.filter((r) => r.group === g).reduce((n, r) => n + r.chars, 0);
  const avg = (g) => Math.round(sum(g) / Math.max(1, rows.filter((r) => r.group === g).length));
  console.log('| Loaded | Part | Chars | ≈Tokens |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.group} | ${r.name} | ${r.chars} | ${tokens(r.chars)} |`);
  console.log(`\nEvery session: ${sum('session')} chars (≈${tokens(sum('session'))} tokens) · every prompt: ${REMINDER.full.length} full / ${REMINDER.short.length} short · a department when invoked: ${avg('department')} on average (≈${tokens(avg('department'))} tokens).`);
  console.log('Tokens ≈ chars / 4. The real session figure, with the agent\'s own prompt and tools: measure.mjs.');
}
