#!/usr/bin/env node
// Waymark · the session-start link of the chain (docs/adr/0007, 0008). Registered by install-hooks.mjs as a
// session-start hook (Claude Code: SessionStart, fires on startup, resume, clear and after a context summary; another
// agent: same script with `--agent <name>`). Runs locally; it injects once per session a compact digest of what the
// agent must recall: this machine's Environment and the current project's memory (Work in progress, the latest learned
// memories from engram (docs/adr/0015)
// symptoms, Quality gates) with the pointer to .waymark/tasks.md. Missing project memory → a one-line instruction.
// With ~/.waymark/coexistence.md it also injects that file's rules (the agent must obey them). Offers, syncs and the
// update check are `waymark.mjs check` (docs/adr/0008): this hook only adds one line pointing to it when the last
// check is older than a week (at most once a week). It never blocks. Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { projectHome, readTaskRecords, readRecords, aprendidoOf, workspaceSiblings, expireOpen, refreshTasks, logHookError, PROBE_OK } from './provenance.mjs';
import { repairNotes, noteLateCommits, hasFetchSpec, mergeNotes, ensureFetchSpec } from './notes.mjs';
import { learnedLines } from './engram.mjs';
import { linkProjectSkills } from './skill-links.mjs';
import { stackOf, stackLine, translate, directBins } from './stack.mjs';
import { incidents, incidentsLine } from './incidents.mjs';
import { agentFrom, parseHook } from './agents/index.mjs';
import { instructionsBlock, newAgents } from './connect-agents.mjs';
import { newProposals } from './learn.mjs';

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
// The commands script, defined once in the card as W; a line added after the card says W only when the card defined it.
export const W_CMD = `node "${path.join(SCRIPTS, 'waymark.mjs').replace(/\\/g, '/')}"`;
const wIn = (text) => (text.includes(` W = ${W_CMD}`) ? 'W' : W_CMD);
// The lines added after the card's cap, built here so size.mjs measures the same text.
export const EXTRA = {
  held: (msg) => `\nHeld message (the context brake stopped it in a large session; it is the user's request, start with it): ${msg}`,
  pointer: (last, w = W_CMD) => `\nWaymark check (last run: ${last}): before the task, run ${w} check — read-only: update, skills, MCP fit, migration, agents, frameworks, session size — and offer with your choice window only what it reports as pending; nothing pending → do not mention it.`,
  agents: (names, w = W_CMD) => `\nNew agents on this machine (said once): ${names.join(', ')}. Before the task, run ${w} check and offer in your choice window what it reports for them.`,
  proposals: (texts, w = W_CMD) => `\nProposals (said once; offer each in your choice window, write it only after the user's yes; ${w} check lists them): ${texts.join('; ')}`,
};
// The open tasks of Work in progress lines: a task line not closed (✔), whether "▶ [<id>]" or an older pending "[<id>]".
export const openIds = (lines) => lines.map((l) => l.match(/^-\s*(?:▶\s*)?\[([^\]]*· T\d+[a-z]?)\]/)?.[1]).filter(Boolean);
export const HELD_MAX = 1200; // characters of the held message
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
  out.push(home.legacy ? `Project memory: ${where} (old location; read; full file there; W check offers the move). W = ${W_CMD}.` : `Project memory: ${where} (read; full file there) and tasks.md next to it (where the work stands). W = ${W_CMD}.`);
  // The context card: what the next agent needs first, ~400 tokens; the rest is pulled on demand with short commands.
  const all = readTaskRecords(home), last = all.filter((r) => r.id).pop(); // read once: the last close and the incidents
  if (last) {
    const learned = aprendidoOf(String(last.cierre || '').replace(/\*\*|__/g, ''));
    const result = String(last.cierre || '').match(/Resultado:[ \t]*([A-Za-zÀ-ÿ]+)/)?.[1] || '?';
    out.push(`Last closed: ${last.id} · ${last.agent || '?'} · ${result}${learned ? ` · ${clip(learned, 180)}` : ''} (whole record: W tasks "${last.id}")`);
  }
  const wipAll = section('\n' + best.text, 'Work in progress').filter((l) => l.startsWith('-'));
  const open = openIds(wipAll);
  // listed, not asked: `W check` asks which already work, so the first reply of a session is the user's task
  if (open.length) out.push(`Open tasks (▶): ${open.join(', ')} (W check asks the user which already work).`);
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
  // the learned layer (docs/adr/0015): what any agent learned here, newest first; the end-of-turn hook writes it
  let learned = [];
  try { if (!home.legacy) learned = learnedLines(home, 3, 150, last?.id); } catch {} // the last closed is already above
  if (learned.length) out.push(`Learned (engram, newest first; more: engram search "<words>" --project ${home.slug}):\n${learned.map((l) => `- ${l}`).join('\n')}`);
  out.push(`Commands: the hook hands you W pack at your first edit of each file (what earlier tasks did there, from git; never run it yourself); on demand, W memory <section> (Conventions · Identity) and W tasks.`);
  // the other projects of the workspace (an API and its FE): what they left open and what they last closed; last, so
  // the card's cap trims this before the commands
  try {
    const sib = workspaceSiblings(home.root).slice(0, 4).map((h) => {
      const closed = readTaskRecords(h).filter((r) => r.id).slice(-3).reverse(); // the newest 3, newest first
      const openIds = section('\n' + read(h.memory), 'Work in progress').map((l) => l.match(/^-\s*▶\s*\[([^\]]*· T\d+[a-z]?)\]/)?.[1]).filter(Boolean);
      const lines = closed.map((r) => `  - ${r.id} · ${r.agent || '?'} · ${clip(aprendidoOf(String(r.cierre || '').replace(/\*\*|__/g, '')) || '', 120)}`);
      return `- ${path.basename(h.root)}${openIds.length ? ` (open ▶ ${openIds.join(', ')})` : ''}:${lines.length ? `\n${lines.join('\n')}` : ' no task closed yet'}`;
    });
    if (sib.length) out.push(`Workspace (projects next to this one; whole records: W tasks --workspace):\n${sib.join('\n')}`);
  } catch {}
  return out.join('\n');
}

// The message the context brake kept in .waymark/next-prompt.md, if under a day old; the file is removed once read.
export function heldPrompt(home, now = Date.now()) {
  const file = path.join(home.dir, 'next-prompt.md');
  let text = '';
  try { if (now - fs.statSync(file).mtimeMs < 86400000) text = fs.readFileSync(file, 'utf8').replace(/^<!--[^\n]*-->\n/, '').trim(); fs.rmSync(file, { force: true }); } catch {}
  return text.length > HELD_MAX ? text.slice(0, HELD_MAX - 1) + '…' : text;
}

// One line when neither a check nor this pointer happened in the last week.
export function checkPointer(now = Date.now(), w = W_CMD) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(CHECK_STATE, 'utf8')); } catch {}
  if (now - Math.max(st.checkedAt || 0, st.pointedAt || 0) < WEEK) return '';
  try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CHECK_STATE, JSON.stringify({ ...st, pointedAt: now })); } catch { return ''; }
  const last = st.checkedAt ? `${Math.floor((now - st.checkedAt) / 86400000)} days ago` : 'never';
  return EXTRA.pointer(last, w).slice(1);
}

// Modes: waymark-leads | guest | skills-only (`other-leads` from 1.5.0 is read as guest). Only the rules the agent must
// obey are injected; a framework that appeared or vanished is reported by `waymark.mjs check`.
export function coexistence() {
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

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const emit = () => {
    if (done) return;
    done = true;
    let cwd = process.cwd(), sessionId = null;
    const h = parseHook(input, agent, { lenient: true });
    if (!h) return; // Claude Code's hook run by Cursor: Cursor's own hook does the work
    if (h.waymark_probe) { process.stdout.write(PROBE_OK); return; }
    cwd = h.cwd || cwd; sessionId = h.session_id || null;
    let text = '', held = '';
    // the remote's records a fetch brought (the refspec of `waymark.mjs notes setup`) join the local notes before the card
    // a repo with Waymark memory gets the refspec on its own, once (no network; the next fetch brings the records)
    let joined = false, added = false;
    try {
      const home = projectHome(cwd), root = home.root;
      added = !!home.dir && !home.legacy && fs.existsSync(home.dir) && ensureFetchSpec(root);
      joined = hasFetchSpec(root) && mergeNotes(root);
    } catch (e) { logHookError('session-hook notes', e); }
    try {
      text = CARD_HEAD + digest(cwd, agent.name);
      if (added) text += '\nNotes: fetches from origin now bring the task records (one fetch refspec added to .git/config).';
      if (joined) text += '\nNotes: the records the remote brought joined the local ones (git notes merge).';
      // a note a rebase or amend left on the old commit follows the task to its new commit
      try {
        const home = projectHome(cwd), records = home.dir && !home.legacy ? readRecords(home.log) : [];
        const moved = records.length ? repairNotes(home.root, records) : [];
        if (moved.length) text += `\nNotes: moved to their rebased commits: ${moved.join(', ')}`;
        if (records.length) noteLateCommits(home.root, records); // a task committed after its close (by hand or by a later task)
        // turns other sessions left open for hours (API error, quota, crash): closed as interrupted, said once here
        const gone = home.dir && !home.legacy ? expireOpen(home, sessionId) : [];
        if (gone.length) { refreshTasks(home, true); text += `\nInterrupted (never closed, now out of tasks.md): ${gone.map((o) => `${o.next}${o.agent ? ` in ${o.agent}` : ''} "${o.prompt}"`).join('; ')}`; }
        held = home.dir && !home.legacy ? heldPrompt(home) : ''; // the context brake's message (docs/adr/0016), once
        // a project skill lives once in .agents/skills (every agent); Claude Code gets a link in .claude/skills
        const linked = home.dir && !home.legacy ? linkProjectSkills(home.root) : [];
        if (linked.length) text += `\nProject skills (one copy in .agents/skills, linked for Claude Code): ${linked.join('; ')}`;
      } catch (e) { logHookError('session-hook', e); }
    } catch (e) { logHookError('session-hook', e); text = ''; }
    if (text.length > MAX) text = text.slice(0, MAX) + '…';
    // after the cap: the user's own words are never cut by it
    if (held) text += EXTRA.held(held);
    const w = wIn(text);
    try { const p = checkPointer(Date.now(), w); if (p) text += '\n' + p; } catch {}
    try { const c = coexistence(); if (c) text = (text ? text + '\n' : '') + c; } catch {}
    const guest = /\nMode:\s*(guest|other-leads|skills-only)\b/.test('\n' + read(path.join(HOME, 'coexistence.md')));
    // an agent installed since the last session, not prepared yet (docs/adr/0022): said once, check has the offers
    try {
      const fresh = guest ? [] : newAgents();
      if (fresh.length) text += EXTRA.agents(fresh, w);
    } catch (e) { logHookError('session-hook agents', e); }
    // what the project could learn (docs/adr/0023): each proposal said once; written only after the user's yes
    try {
      const home = projectHome(cwd), fresh = guest || !home.dir || home.legacy ? [] : newProposals(home, readTaskRecords(home));
      if (fresh.length) text += EXTRA.proposals(fresh.map((p) => p.text), w);
    } catch (e) { logHookError('session-hook proposals', e); }
    // an agent with no instructions file of its own (Cursor): the Rule 0 block comes first, never cut by the cap
    try { if (agent.ruleInCard && !guest) text = instructionsBlock() + (text ? '\n\n' + text : ''); } catch {}
    if (text) process.stdout.write(JSON.stringify(agent.out.context('SessionStart', text)));
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', emit);
  process.stdin.resume();
  setTimeout(emit, 1500).unref();
}
