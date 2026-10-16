#!/usr/bin/env node
// Waymark · what Waymark itself puts in the agent's context, by when it is loaded: every session (instructions block,
// context card and the skill descriptions the agent lists), every prompt (the reminder as the hook sends it to Claude
// Code, with the task ID, the repo and git lines; another agent adds its own note; short after a reply that opened with "Waymark →"), the lines the session hook adds
// after the card's cap (each at what it would say now on this machine; the held message at its cap), the protocol an
// L2 or L3 reads, and each department or tool skill when it is invoked. Characters are exact; tokens are an estimate
// (characters / 4). The real figure of a session, with the agent's own system prompt and tools, is `measure.mjs`.
// Offline, 0 model tokens; it writes nothing (the "said once" files are not touched).
// Usage: node size.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REMINDER, taskLine, gitLine } from './rule0-hook.mjs';
import { CARD_HEAD, digest, EXTRA, HELD_MAX, HELD_MORE, coexistence } from './session-hook.mjs';
import { found, unprepared, agentLabel, instructionsBlock } from './connect-agents.mjs';
import { proposals } from './learn.mjs';
import { projectHome, readTaskRecords } from './provenance.mjs';
import { stackLine } from './stack.mjs';
import { read } from './lib/fs.mjs';

const SKILLS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = path.join(SKILLS, 'waymark');
const len = (f) => { try { return f().length; } catch { return 0; } };
export const tokens = (chars) => Math.round(chars / 4);

// → [{ group, name, chars }] for the folder whose project card and reminder are measured.
// The rows that do not depend on the project (README.md carries them between markers; tests/docs.test.mjs checks them).
export const README_ROWS = [
  ['instructions block', 'every session', 'instructions block in CLAUDE.md / AGENTS.md: levels, routing, the testigos, memory'],
  ['skill descriptions', 'every session', "Waymark's 17 skill descriptions, which the agent lists"],
  ['reminder (full)', 'every prompt', 'the rule line of the per-prompt reminder (the task ID, stack and git line come on top)'],
  ['reminder (short)', 'every prompt after a reply that followed the routine', 'the short reminder'],
  ['protocol L2', 'an L2 task', 'the protocol an L2 reads'],
  ['protocol L3', 'an L3 task', 'the protocol an L3 reads (L2 and L3 parts)'],
  ['held message (max)', 'only after the context brake', 'the largest line the session hook adds for a held message'],
];
export const readmeTable = (rows) => ['| Part | Loaded | What it is | Characters |', '|---|---|---|---|', ...README_ROWS.map(([name, when, what]) => `| ${name} | ${when} | ${what} | ${(rows.find((r) => r.name === name)?.chars || 0).toLocaleString('en-US')} |`)].join('\n');

export function sizes(cwd) {
  const home = projectHome(cwd);
  const dirs = fs.readdirSync(SKILLS).sort();
  const descriptions = dirs.map((d) => (read(path.join(SKILLS, d, 'SKILL.md')).match(/^description:.*$/m) || [''])[0].length).reduce((a, b) => a + b, 0);
  const real = () => {
    const repo = stackLine(home.root);
    return REMINDER.full + taskLine(cwd) + (repo ? ` Repo: ${repo}.` : '') + gitLine(home.root);
  };
  const protocol = (part) => read(path.join(CORE, 'references', 'protocol', part)).length;
  const rows = [
    { group: 'session', name: 'instructions block', chars: read(path.join(CORE, 'templates', 'instructions.md')).length },
    { group: 'session', name: 'context card', chars: len(() => CARD_HEAD + digest(cwd)) },
    { group: 'session', name: 'skill descriptions', chars: descriptions },
    { group: 'prompt', name: 'reminder (full)', chars: REMINDER.full.length },
    { group: 'prompt', name: 'reminder (real)', chars: len(real) },
    { group: 'prompt', name: 'reminder (short)', chars: REMINDER.short.length },
    { group: 'outside cap', name: 'check pointer', chars: EXTRA.pointer('never', 'W').length },
    { group: 'outside cap', name: 'held message (max)', chars: EXTRA.held('x'.repeat(HELD_MAX) + HELD_MORE).length },
    { group: 'outside cap', name: 'new agents', chars: len(() => { const names = found().filter(unprepared).map(agentLabel); return names.length ? EXTRA.agents(names, 'W') : ''; }) },
    { group: 'outside cap', name: 'proposals', chars: len(() => { const p = home.dir && !home.legacy ? proposals(home, readTaskRecords(home)) : []; return p.length ? EXTRA.proposals(p.map((x) => x.text), 'W') : ''; }) },
    { group: 'outside cap', name: 'coexistence', chars: len(coexistence) },
    { group: 'outside cap', name: 'instructions block (Cursor)', chars: len(instructionsBlock) },
    { group: 'level', name: 'protocol L2', chars: protocol('l2.md') },
    { group: 'level', name: 'protocol L3', chars: protocol('l2.md') + protocol('l3.md') },
    { group: 'level', name: 'when stuck', chars: protocol('stuck.md') },
  ];
  for (const dir of dirs) {
    const skill = read(path.join(SKILLS, dir, 'SKILL.md'));
    if (!skill || dir === 'waymark') continue;
    rows.push({ group: dir.startsWith('dept-') ? 'department' : 'tool', name: dir, chars: skill.length });
  }
  return rows;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const rows = sizes(process.cwd());
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows)); process.exit(0); }
  if (process.argv.includes('--readme')) { console.log(readmeTable(rows)); process.exit(0); }
  const of = (name) => rows.find((r) => r.name === name)?.chars || 0;
  const sum = (g) => rows.filter((r) => r.group === g).reduce((n, r) => n + r.chars, 0);
  const avg = (g) => Math.round(sum(g) / Math.max(1, rows.filter((r) => r.group === g).length));
  console.log('| Loaded | Part | Chars | ≈Tokens |\n|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.group} | ${r.name} | ${r.chars} | ${tokens(r.chars)} |`);
  const extra = sum('outside cap') - of('held message (max)') - of('instructions block (Cursor)');
  console.log(`\nEvery session: ${sum('session')} chars (≈${tokens(sum('session'))} tokens), plus up to ${extra} after the card's cap here (a held message adds up to ${of('held message (max)')}; Cursor gets the block in the card) · every prompt: ${of('reminder (real)')} here (${REMINDER.short.length} after a reply that followed the routine) · an L2 reads ${of('protocol L2')} of protocol, an L3 ${of('protocol L3')} · a department when invoked: ${avg('department')} on average (≈${tokens(avg('department'))} tokens).`);
  console.log(`Tokens ≈ chars / 4. The real session figure, with the agent's own prompt and tools: measure.mjs.`);
}
