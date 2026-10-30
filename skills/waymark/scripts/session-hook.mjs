#!/usr/bin/env node
// Waymark · the session-start link of the chain (docs/adr/0007, 0008). Registered by install-hooks.mjs as a
// session-start hook (Claude Code: SessionStart, fires on startup, resume, clear and after a context summary; another
// agent: same script with `--agent <name>`). Runs locally; it injects once per session a compact digest of what the
// agent must recall: this machine's Environment and the current project's memory (Work in progress, the latest learned
// memories from engram (docs/adr/0015)
// symptoms, Quality gates) with the pointer to .waymark/tasks.md. Missing project memory → a one-line instruction, unless
// git holds the project's records: then memory.md and tasks.md are rebuilt from them first (docs/adr/0013).
// With ~/.waymark/coexistence.md it also injects that file's rules (the agent must obey them). Offers, syncs and the
// update check are `waymark.mjs check` (docs/adr/0008): this hook only adds one line pointing to it when the last
// check is older than a week (at most once a week). It never blocks. Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import { readStdin } from './lib/stdin.mjs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { projectHome, readTaskRecords, readRecords, aprendidoOf, workspaceSiblings, expireOpen, refreshTasks, rebuildFromGit, readRelay, RELAY_MARK, logHookError, gitError, PROBE_OK } from './provenance.mjs';
import { repairNotes, noteLateCommits, hasFetchSpec, mergeNotes, ensureFetchSpec, hasRemote, fetchNotes, defaultRemote } from './notes.mjs';
import { learnedLines } from './engram.mjs';
import { census, fillMemory } from './convention.mjs';
import { fillRuntime, runtimeDir } from './runtime.mjs';
import { fillEyes, cleanEyes } from './eyes.mjs';
import { linkProjectSkills } from './skill-links.mjs';
import { stackOf, stackLine, translate, directBins, gateCell, rowProblem, fillMigrations, fillRelated, syncIdentity, PM_PLACEHOLDER } from './stack.mjs';
import { incidents, incidentsLine } from './incidents.mjs';
import { agentFrom, parseHook, answer } from './agents/index.mjs';
import { instructionsBlock, newAgents } from './connect-agents.mjs';
import { newProposals } from './learn.mjs';
import { waymarkHome } from './lib/paths.mjs';
import { tagLatency } from './lib/latency.mjs';
import { read } from './lib/fs.mjs';

const HOME = waymarkHome();
const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const MAX = 2700; // characters of injected project memory, hard cap
const STALE_DAYS = 14; // Work in progress entries older than this are flagged for confirmation
const MAX_COEXIST = 1800; // characters of injected coexistence rules, hard cap
const WEEK = 7 * 86400000;
export const CHECK_STATE = path.join(HOME, '.check.json'); // { checkedAt } written by waymark.mjs check, { pointedAt } here
const FETCH_MS = 5000; // the notes fetch of a repo with no .waymark/: short, so the session never waits on the network
const FETCH_STATE = path.join(HOME, '.notes-fetch.json'); // { <repo root>: last attempt } of that fetch, at most once a day
// A repo with no .waymark/ fetches the remote's notes when its refspec was just added, else at most once a day.
function fetchDue(root, now = Date.now()) {
  let st = {};
  try { st = JSON.parse(fs.readFileSync(FETCH_STATE, 'utf8')) || {}; } catch {}
  if (now - (st[root] || 0) < 86400000) return false;
  try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(FETCH_STATE, JSON.stringify({ ...st, [root]: now })); } catch {}
  return true;
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const section = (text, title) => {
  const m = text.match(new RegExp(`\\n## ${title}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  return m ? m[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('<!--')) : [];
};

export const CARD_HEAD = 'Waymark context card. Pointers, not facts: the code wins; fix the entry.\n';
// The commands script, defined once in the card as W; a line added after the card says W only when the card defined it.
export const W_CMD = `node "${path.join(SCRIPTS, 'waymark.mjs').replace(/\\/g, '/')}"`;
const wIn = (text) => (text.includes(` W = ${W_CMD}`) ? 'W' : W_CMD);
// The lines added after the card's cap, built here so size.mjs measures the same text.
export const EXTRA = {
  held: (msg) => `\nHeld message (stopped by the context brake; the user's request, start with it): ${msg}`,
  pointer: (last, w = W_CMD) => `\nWaymark check (last run: ${last}): before the task, run ${w} check — read-only: update, skills, MCP fit, migration, agents, frameworks, session size — and offer with your choice window only what it reports as pending; nothing pending → do not mention it.`,
  agents: (names, w = W_CMD) => `\nNew agents on this machine (said once): ${names.join(', ')}. Before the task, run ${w} check and offer in your choice window what it reports for them.`,
  proposals: (texts, w = W_CMD) => `\nProposals (said once; offer each in your choice window, write it only after the user's yes; ${w} check lists them): ${texts.join('; ')}`,
};
// The open tasks of Work in progress lines: a task line not closed (✔), whether "▶ [<id>]" or an older pending "[<id>]".
export const openIds = (lines) => lines.map((l) => l.match(/^-\s*(?:▶\s*)?\[([^\]]*· T\d+[a-z]?)\]/)?.[1]).filter(Boolean);
// The open IDs as the card lists them: a date said once for the IDs that follow it, at most OPEN_MAX, the rest counted (W tasks lists them).
const OPEN_MAX = 6;
export const openList = (ids) => {
  let day = null;
  const shown = ids.slice(0, OPEN_MAX).map((id) => { const [d, t] = id.split(' · '); if (t && d === day) return t; day = t ? d : null; return id; });
  return shown.join(', ') + (ids.length > OPEN_MAX ? ` +${ids.length - OPEN_MAX} (W tasks)` : '');
};
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
  // the template's Architecture placeholder becomes what the repo itself shows (docs/adr/0043), never over a line somebody wrote
  // with it, the Stack, Source root, Path aliases, Related projects and Reusables placeholders the repo answers by itself, each "(to confirm)"
  if (!home.legacy && /^- (?:Architecture|Stack|Source root and layout|Path aliases|Related projects):\s*<(?!\s*$)/m.test(best.text)) {
    try {
      const related = workspaceSiblings(home.root).slice(0, 4).map((h) => `${h.slug} (${path.relative(home.root, h.root).split(path.sep).join('/')})`);
      if (fillMemory(home.memory, census(home.root), { related })) best.text = read(home.memory);
    } catch (e) { logHookError('session-hook convention', e); }
  }
  // the template's Package manager placeholder becomes the repo's own (lockfile or packageManager), marked to confirm
  if (!home.legacy && PM_PLACEHOLDER.test(best.text)) {
    try { if (syncIdentity(home.memory, stackOf(home.root))) best.text = read(home.memory); } catch (e) { logHookError('session-hook identity', e); }
  }
  out.push(home.legacy ? `Project memory: ${where} (old location; read; full file there; W check offers the move). W = ${W_CMD}.` : `Project memory: ${where} (read; full file there) and tasks.md next to it (where the work stands). W = ${W_CMD}.`);
  // the Node the stack needs, when this machine's is not it (a legacy Angular on Node 24): a `runtime` row in Quality gates the first time, never over a line somebody wrote
  if (!home.legacy) { try { if (fillRuntime(home.memory, home.root)) best.text = read(home.memory); } catch (e) { logHookError('session-hook runtime', e); } }
  // the dev server the eyes look at (docs/adr/0047): proposed from package.json, "to confirm" until the user's first seen change; the captures of a week ago go
  if (!home.legacy) { try { if (fillEyes(home.memory, home.root)) best.text = read(home.memory); cleanEyes(); } catch (e) { logHookError('session-hook eyes', e); } }
  // the project's own migration command (docs/adr/0046): "to confirm" in Conventions, so a migration written by hand is asked about first
  if (!home.legacy) { try { if (fillMigrations(home.memory, home.root)) best.text = read(home.memory); } catch (e) { logHookError('session-hook migrations', e); } }
  // the tests of the touched files from the repo's runner (Vitest related, Jest --findRelatedTests), "to confirm", when the row is empty: seconds, not the suite
  if (!home.legacy) { try { if (fillRelated(home.memory, home.root)) best.text = read(home.memory); } catch (e) { logHookError('session-hook related', e); } }
  // every runtime row, one language each: the folders go first on the PATH together, a "none (…)" says what is missing, a command the user wrote is their prefix
  const runtimes = [...best.text.matchAll(/^\|\s*runtime\s*\|\s*([^|]+)\|/gim)].map((m) => m[1].trim().replace(/`/g, ''));
  const dirs = runtimes.map(runtimeDir).filter(Boolean), posix = (p) => String(p).replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, d) => `/${d.toLowerCase()}`);
  const legacyRule = 'stacks/generic.md → Legacy repos';
  for (const r of runtimes.filter((c) => /^none\b/i.test(c))) out.push(`Runtime: ${r}. ${legacyRule}.`);
  if (dirs.length) out.push(`Runtime: this machine's runtime is not the one this repo needs (memory.md → Quality gates, the runtime rows): run every gate with ${dirs.join(' and ')} first on the PATH, never \`nvm use\`, \`rbenv global\`, \`pyenv global\` or \`sdk default\` (they switch the machine's runtime) — bash: PATH="${dirs.map(posix).join(':')}:$PATH" <gate> · PowerShell: $env:PATH="${dirs.join(';')};$env:PATH"; <gate>. ${legacyRule}.`);
  for (const r of runtimes.filter((c) => !/^none\b/i.test(c) && !runtimeDir(c))) out.push(`Runtime: this machine's runtime is not the one this repo needs (memory.md → Quality gates, the runtime row): start every gate with "${r}".`);
  const toConfirm = best.text.match(/^- Architecture:[^\n]*\(to confirm\)\s*$/m);
  if (toConfirm) out.push('Architecture is detected, not confirmed (memory.md → Identity): on the first task ask the user once to confirm it, then mark it "confirmed <date>". A move between layers is always its own window (W convention --move <from> <to>).');
  // The context card: what the next agent needs first, ~400 tokens; the rest is pulled on demand with short commands.
  const all = readTaskRecords(home), last = all.filter((r) => r.id).pop(); // read once: the last close and the incidents
  const relay = home.legacy ? '' : readRelay(home); // what the last task left for whoever starts next (.waymark/next-prompt.md), any agent
  if (last) {
    // the Handoff of the same task carries its Aprendido whole: the line does not repeat it
    const learned = relay.startsWith(`Relevo de ${last.id} `) ? '' : aprendidoOf(String(last.cierre || '').replace(/\*\*|__/g, ''));
    const result = String(last.cierre || '').match(/Resultado:[ \t]*([A-Za-zÀ-ÿ]+)/)?.[1] || '?';
    out.push(`Last closed: ${last.id} · ${last.agent || '?'} · ${result}${learned ? ` · ${clip(learned, 90)}` : ''} (whole record: W tasks "${last.id}")`);
  }
  const wipAll = section('\n' + best.text, 'Work in progress').filter((l) => l.startsWith('-'));
  const open = openIds(wipAll);
  // listed, not asked: `W check` asks which already work, so the first reply of a session is the user's task
  if (open.length) out.push(`Open tasks (▶): ${openList(open)} (W check asks the user which already work).`);
  // the card's line is bounded: the head clipped, the Aprendido's tail kept (its next step and the plan's ✔1 · ▶2 are there), the whole in the file
  if (relay) {
    const [head, ...rest] = relay.split(/\n+/), tail = [...rest.join(' · ')]; // by code point: a cut never splits an emoji
    const short = `${clip(head, 90)}${tail.length ? ` · ${tail.length > 70 ? `…${tail.slice(-69).join('').trimStart()}` : tail.join('')}` : ''}`;
    out.push(`Handoff (the user's request comes first): ${short}${short.length < relay.length ? ' (whole: .waymark/next-prompt.md)' : ''}`);
  }
  // lines with no task ID at their head (notes, or a memory in the older format) are kept, short
  const notes = wipAll.filter((l) => !/^-\s*[▶✔]?\s*\[[^\]]*· T\d/.test(l)).slice(0, 4).map((l) => clip(l, 160));
  if (notes.length) out.push('Notes:\n' + notes.join('\n'));
  const stack = stackOf(home.root);
  const direct = directBins(agentName); // Codex on Windows: binaries with node, not pnpm exec
  const line = stackLine(home.root, { direct });
  if (line) out.push(`Repo (read now): ${line}`);
  const gates = section('\n' + best.text, 'Quality gates').filter((l) => l.startsWith('|') && !/^\|\s*(Gate|---)/.test(l))
    .map((l) => l.split('|').slice(1, 3).map((s) => s.replace(/`/g, '').trim())).filter(([g, c]) => g && c && !rowProblem(c, home.root)).map(([g, c]) => `${g}: ${translate(gateCell(c), stack, { root: home.root, direct })}`);
  if (gates.length) out.push('Gates: ' + gates.join(' · '));
  try { const inc = incidentsLine(incidents(all), 'W'); if (inc) out.push(inc); } catch {}
  // the learned layer (docs/adr/0015): what any agent learned here, newest first; the end-of-turn hook writes it
  let learned = [];
  try { if (!home.legacy) learned = learnedLines(home, 2, 90, last?.id); } catch {} // the last closed is already above
  if (learned.length) out.push(`Learned (engram search "<words>" --project ${home.slug} for more):\n${learned.map((l) => `- ${l}`).join('\n')}`);
  out.push(`Commands: the hook hands you W pack at a file's first edit (never run it); W memory <section>, W tasks on demand.`);
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

export const HELD_MAX_CHARS = 20000; // a held message longer than this is a pasted document, not a request: it is bounded
// The message the context brake kept in .waymark/next-prompt.md, if under a day old; the file is removed once read.
export function heldPrompt(home, now = Date.now()) {
  const file = path.join(home.dir, 'next-prompt.md');
  let text = '';
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (content.startsWith(RELAY_MARK)) return ''; // a handoff is no held message: the card shows it and it stays
    const cut = content.indexOf('\n' + RELAY_MARK), whole = cut < 0 ? content : content.slice(0, cut + 1); // a handoff after the message stays
    if (now - fs.statSync(file).mtimeMs < 86400000) text = whole.replace(/^<!--[^\n]*-->\n/, '').trim();
    if (cut < 0) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, content.slice(cut + 1));
  } catch {}
  try { fs.rmSync(path.join(home.dir, 'held-full.md'), { force: true }); } catch {} // the file 2.0.19 kept the rest of a long message in: the card now carries it whole
  // the user's words arrive whole, after the card's cap (EXTRA.held), once: a message of a few thousand characters is theirs entire; only a pasted document bounds it, and the card says how much was cut
  return text.length > HELD_MAX_CHARS ? `${text.slice(0, HELD_MAX_CHARS)} … (${text.length - HELD_MAX_CHARS} more characters were cut: ask the user for the rest)` : text;
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
    tagLatency(h, h.cwd);
    if (h.waymark_probe) { process.stdout.write(PROBE_OK); return; }
    cwd = h.cwd || cwd; sessionId = h.session_id || null;
    let text = '', held = '';
    // the remote's records a fetch brought (the refspec of `waymark.mjs notes setup`) join the local notes before the card
    // a repo with Waymark memory gets the refspec on its own, once (no network; the next fetch brings the records); one
    // without .waymark/ (a clone, a cleaned project) also fetches them now, short and without prompts, and rebuilds
    // memory.md and tasks.md from what git holds
    let joined = false, added = false, rebuilt = 0, failed = '';
    try {
      const home = projectHome(cwd), root = home.root;
      const bare = !!home.dir && !home.legacy && !fs.existsSync(home.dir);
      if (bare && hasRemote(root)) {
        added = ensureFetchSpec(root);
        if ((added || fetchDue(root)) && hasFetchSpec(root)) { const f = fetchNotes(root, defaultRemote(root), FETCH_MS); if (!f.ok) failed = gitError(f.output); }
      } else added = !!home.dir && !home.legacy && fs.existsSync(home.dir) && ensureFetchSpec(root);
      joined = hasFetchSpec(root) && mergeNotes(root);
      if (bare) rebuilt = rebuildFromGit(home);
    } catch (e) { logHookError('session-hook notes', e); }
    try {
      text = CARD_HEAD;
      if (rebuilt) text += `Rebuilt from git: .waymark/memory.md and tasks.md from ${rebuilt} records (notes, waymark-log, trailer commits); complete Identity and Quality gates in memory.md (Minimal bootstrap).\n`;
      if (failed) text += `Notes: the fetch from origin failed (${failed}); the records here are the local ones. Run ${W_CMD} notes setup from your shell.\n`;
      text += digest(cwd, agent.name);
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
    if (text) answer(agent, agent.out.context('SessionStart', text));
  };
  readStdin((text) => { input = text; emit(); }, { idle: 1500 });
}
