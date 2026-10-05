#!/usr/bin/env node
// Waymark · the session-start link of the chain (docs/adr/0007, 0008). Registered by install-hooks.mjs as a
// session-start hook (Claude Code: SessionStart, fires on startup, resume, clear and after a context summary; another
// agent: same script with `--agent <name>`). Runs locally; it injects once per session a compact digest of what the
// agent must recall: this machine's Environment and the current project's memory (Work in progress, Solved problems
// symptoms, Quality gates) with the pointer to .waymark/tasks.md. Missing project memory → a one-line instruction.
// With ~/.waymark/coexistence.md it also injects that file's rules (the agent must obey them). Offers, syncs and the
// update check are `waymark.mjs check` (docs/adr/0008): this hook only adds one line pointing to it when the last
// check is older than a week (at most once a week). It never blocks. Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { projectHome } from './provenance.mjs';
import { agentFrom } from './agents/index.mjs';

const HOME = process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const MAX = 2700; // characters of injected project memory, hard cap
const STALE_DAYS = 14; // Work in progress entries older than this are flagged for confirmation
const MAX_COEXIST = 1800; // characters of injected coexistence rules, hard cap
const WEEK = 7 * 86400000;
export const CHECK_STATE = path.join(HOME, '.check.json'); // { checkedAt } written by waymark.mjs check, { pointedAt } here
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const section = (text, title) => {
  const m = text.match(new RegExp(`\\n## ${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return m ? m[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('<!--')) : [];
};

function digest(cwd) {
  const out = [];
  const env = section('\n' + read(path.join(HOME, 'profile.md')), 'Environment').filter((l) => l.startsWith('-'));
  if (env.length) out.push('Environment (this machine): ' + env.map((l) => l.replace(/^- \[[^\]]*\]\s*/, '')).join(' | '));

  const home = projectHome(cwd); // one resolver for every hook (docs/adr/0007)
  const where = home.memory.replace(/\\/g, '/');
  const best = { text: read(home.memory) };
  if (!best.text) {
    out.push(`Project memory: none for ${cwd}. Create ${where} now with the Minimal bootstrap (waymark/references/project-detection.md) before the first edit${home.dir ? '; the end-of-turn hook keeps .waymark/ out of git' : ''}.`);
    return out.join('\n');
  }
  out.push(home.legacy ? `Project memory: ${where} (old location; read; full file there; \`waymark.mjs check\` offers the move).` : `Project memory: ${where} (read; full file there). Where the work stands: ${home.root.replace(/\\/g, '/')}/.waymark/tasks.md.`);
  const solved = section('\n' + best.text, 'Solved problems').filter((l) => l.startsWith('-'))
    .map((l) => '- ' + (l.match(/Symptom:\s*([^·]+)/)?.[1] || l.slice(2, 120)).trim());
  if (solved.length) out.push('Solved problems (symptoms; details in the file):\n' + solved.slice(-10).join('\n'));
  const gates = section('\n' + best.text, 'Quality gates').filter((l) => l.startsWith('|') && !/^\|\s*(Gate|---)/.test(l));
  if (gates.length) out.push('Gates: ' + gates.map((l) => l.split('|').slice(1, 3).map((s) => s.trim()).join(': ')).join(' · '));
  const wip = section('\n' + best.text, 'Work in progress').filter((l) => l.startsWith('-')).map((l) => {
    const date = Date.parse(l.match(/\b(20\d\d-\d\d-\d\d)\b/)?.[1] || '');
    const stale = date && Date.now() - date > STALE_DAYS * 86400000 ? ` [>${STALE_DAYS} d old: confirm it still applies before acting on it]` : '';
    return (l.length > 300 ? l.slice(0, 297) + '…' : l) + stale;
  });
  // Open lines wait for the user (a check in the browser, a migration they run): ask once, close what already works.
  // Before the lines themselves: the digest is clipped at its end.
  const open = wip.filter((l) => /^-\s*▶/.test(l)).map((l) => l.match(/\[([^\]]+)\]/)?.[1]).filter(Boolean);
  if (open.length) out.push(`Open tasks (▶): ${open.join(', ')}. In your first reply ask the user once, in the choice window (multi-select), which of them already work; close those with node "${path.join(SCRIPTS, 'waymark.mjs').replace(/\\/g, '/')}" done "<ID>"… --note "<their words>".`);
  if (wip.length) out.push('Work in progress:\n' + wip.join('\n'));
  return out.join('\n');
}

// One line when neither a check nor this pointer happened in the last week.
export function checkPointer(now = Date.now()) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(CHECK_STATE, 'utf8')); } catch {}
  if (now - Math.max(st.checkedAt || 0, st.pointedAt || 0) < WEEK) return '';
  try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CHECK_STATE, JSON.stringify({ ...st, pointedAt: now })); } catch { return ''; }
  const script = path.join(SCRIPTS, 'waymark.mjs').replace(/\\/g, '/');
  const last = st.checkedAt ? `${Math.floor((now - st.checkedAt) / 86400000)} days ago` : 'never';
  return `Waymark check (last run: ${last}): before the task, run node "${script}" check — read-only: update, skills, MCP fit, migration, agents, frameworks, session size — and offer with your choice window only what it reports as pending; nothing pending → do not mention it.`;
}

// Modes: waymark-leads | guest | skills-only (`other-leads` from 1.5.0 is read as guest). Only the rules the agent must
// obey are injected; a framework that appeared or vanished is reported by `waymark.mjs check`.
function coexistence() {
  const text = '\n' + read(path.join(HOME, 'coexistence.md'));
  let mode = text.match(/\nMode:\s*(waymark-leads|guest|other-leads|skills-only)\b/)?.[1];
  if (mode === 'other-leads') mode = 'guest';
  if (!mode) return '';
  const frameworks = (text.match(/\nFrameworks:\s*([^\n]+)/)?.[1] || '').toLowerCase();
  if (mode === 'guest' || mode === 'skills-only') {
    // Normally no hook runs in these modes; if one is still registered, stay out of the orchestrator's way.
    return `Coexistence mode ${mode} (${frameworks || 'other framework'} leads): no Waymark opener or Cierre; departments are knowledge (waymark/references/coexistence.md → Guest entry). Offer to remove the Waymark hooks from the agent settings.`;
  }
  const rules = ['Adopted', 'Fallback', 'Resolved'].map((t) => [t, section(text, t).filter((l) => l.startsWith('-'))]).filter(([, l]) => l.length);
  let block = `Coexistence (mode ${mode}; ${frameworks || 'other framework'}). Waymark adapts; never edit the other framework's files:`;
  for (const [t, l] of rules) block += `\n${t}:\n${l.join('\n')}`;
  return block.length > MAX_COEXIST ? block.slice(0, MAX_COEXIST) + '…' : block;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const emit = () => {
    if (done) return;
    done = true;
    let cwd = process.cwd();
    try { cwd = JSON.parse(input).cwd || cwd; } catch {}
    let text = '';
    try {
      text = 'Waymark session memory (already recalled, cite it in "Memoria:"). Pointers, not facts: verify against the code before relying on them; if the code disagrees, the code wins and you fix or remove the entry.\n' + digest(cwd);
    } catch { text = ''; }
    if (text.length > MAX) text = text.slice(0, MAX) + '…';
    try { const p = checkPointer(); if (p) text += '\n' + p; } catch {}
    try { const c = coexistence(); if (c) text = (text ? text + '\n' : '') + c; } catch {}
    if (text) process.stdout.write(JSON.stringify(agent.out.context('SessionStart', text)));
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', emit);
  process.stdin.resume();
  setTimeout(emit, 1500).unref();
}
