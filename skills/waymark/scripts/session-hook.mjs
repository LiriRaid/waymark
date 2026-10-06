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
import { projectHome, readTaskRecords, readRecords, aprendidoOf, workspaceSiblings } from './provenance.mjs';
import { repairNotes } from './notes.mjs';
import { stackOf, stackLine, translate, directBins } from './stack.mjs';
import { incidents, incidentsLine } from './incidents.mjs';
import { agentFrom } from './agents/index.mjs';

const HOME = process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const MAX = 2700; // characters of injected project memory, hard cap
const STALE_DAYS = 14; // Work in progress entries older than this are flagged for confirmation
const MAX_COEXIST = 1800; // characters of injected coexistence rules, hard cap
const WEEK = 7 * 86400000;
export const CHECK_STATE = path.join(HOME, '.check.json'); // { checkedAt } written by waymark.mjs check, { pointedAt } here
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const section = (text, title) => {
  const m = text.match(new RegExp(`\\n## ${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return m ? m[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('<!--')) : [];
};

export const CARD_HEAD = 'Waymark context card (already recalled). Pointers, not facts: verify in the code; the code wins, fix the entry.\n';
export function digest(cwd, agentName = 'claude') {
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
  // The context card: what the next agent needs first, ~400 tokens; the rest is pulled on demand with short commands.
  const all = readTaskRecords(home), last = all.filter((r) => r.id).pop(); // read once: the last close and the incidents
  if (last) {
    const learned = aprendidoOf(String(last.cierre || '').replace(/\*\*|__/g, ''));
    const result = String(last.cierre || '').match(/Resultado:[ \t]*([A-Za-zÀ-ÿ]+)/)?.[1] || '?';
    out.push(`Last closed: ${last.id} · ${last.agent || '?'} · ${result}${learned ? ` · ${clip(learned, 180)}` : ''} (whole record: waymark.mjs tasks "${last.id}")`);
  }
  const wipAll = section('\n' + best.text, 'Work in progress').filter((l) => l.startsWith('-'));
  // open: a task line not closed (✔), whether "▶ [<id>]" or an older pending "[<id>]"
  const open = wipAll.map((l) => l.match(/^-\s*(?:▶\s*)?\[([^\]]*· T\d+[a-z]?)\]/)?.[1]).filter(Boolean);
  if (open.length) out.push(`Open tasks (▶): ${open.join(', ')}. In your first reply ask the user once, in the choice window (multi-select), which of them already work; close those with node "${path.join(SCRIPTS, 'waymark.mjs').replace(/\\/g, '/')}" done "<ID>"… --note "<their words>".`);
  // lines with no task ID at their head (notes, or a memory in the older format) are kept, short
  const notes = wipAll.filter((l) => !/^-\s*[▶✔]?\s*\[[^\]]*· T\d/.test(l)).slice(0, 4).map((l) => clip(l, 160));
  if (notes.length) out.push('Notes:\n' + notes.join('\n'));
  const stack = stackOf(home.root);
  const direct = directBins(agentName); // Codex on Windows: binaries with node, not pnpm exec
  const line = stackLine(home.root, { direct });
  if (line) out.push(`Repo (read now): ${line}`);
  const gates = section('\n' + best.text, 'Quality gates').filter((l) => l.startsWith('|') && !/^\|\s*(Gate|---)/.test(l))
    .map((l) => l.split('|').slice(1, 3).map((s) => s.replace(/`/g, '').trim())).filter(([g, c]) => g && c).map(([g, c]) => `${g}: ${translate(c, stack, { root: home.root, direct })}`);
  if (gates.length) out.push('Gates: ' + gates.join(' · '));
  try { const inc = incidentsLine(incidents(all)); if (inc) out.push(inc); } catch {}
  const solved = section('\n' + best.text, 'Solved problems').filter((l) => l.startsWith('-')).length;
  const cmd = `node "${path.join(SCRIPTS, 'waymark.mjs').replace(/\\/g, '/')}"`;
  out.push(`Commands (W = ${cmd}): before your first change to a file, W pack <files…> (what earlier tasks did there, from git); on demand, W memory <section> (${solved ? `Solved problems: ${solved} · ` : ''}Conventions · Identity) and W tasks.`);
  // the other projects of the workspace (an API and its FE): what they left open and what they last closed; last, so
  // the card's cap trims this before the commands
  try {
    const sib = workspaceSiblings(home.root).slice(0, 4).map((h) => {
      const closed = readTaskRecords(h, { last: 3 }).filter((r) => r.id).slice(-3).reverse(); // the newest 3, newest first
      const openIds = section('\n' + read(h.memory), 'Work in progress').map((l) => l.match(/^-\s*▶\s*\[([^\]]*· T\d+[a-z]?)\]/)?.[1]).filter(Boolean);
      const lines = closed.map((r) => `  - ${r.id} · ${r.agent || '?'} · ${clip(aprendidoOf(String(r.cierre || '').replace(/\*\*|__/g, '')) || '', 120)}`);
      return `- ${path.basename(h.root)}${openIds.length ? ` (open ▶ ${openIds.join(', ')})` : ''}:${lines.length ? `\n${lines.join('\n')}` : ' no task closed yet'}`;
    });
    if (sib.length) out.push(`Workspace (projects next to this one; whole records: W tasks --workspace):\n${sib.join('\n')}`);
  } catch {}
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
      text = CARD_HEAD + digest(cwd, agent.name);
      // a note a rebase or amend left on the old commit follows the task to its new commit
      try { const home = projectHome(cwd), moved = home.dir && !home.legacy ? repairNotes(home.root, readRecords(home.log)) : []; if (moved.length) text += `\nNotes: moved to their rebased commits: ${moved.join(', ')}`; } catch {}
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
