#!/usr/bin/env node
// Waymark · decision gate, the pre-tool link of the chain (docs/adr/0001–0005, 0008). Registered by install-hooks.mjs
// as a pre-tool hook (Claude Code: PreToolUse, matcher "Bash|PowerShell|Edit|Write|NotebookEdit"; another agent: same
// script with `--agent <name>`). Runs locally (0 tokens unless it fires). Every L1–L3 change to project files (edits,
// and shell commands that change files: git checkout --, sed -i, rm, redirects) is denied until the task has a
// choice-window question (AskUserQuestion) — strict since test 2.0-2, where a retry let the agent apply two decisions
// before asking. A turn routed Q is told once to re-route (by tool call: the owner dept-* with args "L<n>"). The
// message asks for the foreseeable sub-decisions in the same call; browser verification is never offered (only when the
// user asks, 3c); the branch is the user's, never pushed as a sub-decision (3c). An unrouted reply inside an open task inherits its routing (3c).
// Memory and scratch files are exempt; L0 skipped. Procedure and mem_search are recorded and scored by the end-of-turn hook, not denied.
// Remove the hook from the agent's settings to disable it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { currentTurn, routedLevel, inheritedRoute, readTurns } from './transcript.mjs';
import { taskLines, askedChoice, changesProject } from './provenance.mjs';
import { agentFrom } from './agents/index.mjs';

const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

// Files the routine itself writes (memory, learnings, scratch) never need the opener.
const exempt = (file) => {
  const f = norm(file), home = norm(os.homedir());
  return f.startsWith(`${home}/.waymark/`) || f.includes('/.waymark/') || f.includes('/.claude/projects/') || f.includes('/appdata/local/temp/') || f.startsWith('/tmp/') || f.includes('/scratchpad/');
};

// Decision gate: deny once per prompt (state keyed by session + prompt uuid), never for L0 or exempt files. A turn routed
// Q that edits a project file is denied once too: a question that became a change must re-route (test 2.0-1: routed Q,
// 8 edits, so every check and the record were skipped).
export function checkDecision(target, lines, session = 'unknown', stateFile = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.decision-gate.json'), cwd = process.cwd()) {
  // target: a file path (an edit) or { command } (a shell command that changes files: git checkout --, sed -i, rm, >).
  if (target && typeof target === 'object') { if (!changesProject(target.command)) return null; }
  else if (!target || exempt(target)) return null;
  const turn = currentTurn(lines);
  const level = routedLevel(turn.texts, turn.tools) || inheritedRoute(lines)?.level || 0, q = level === 'Q';
  if (!turn.found || !level) return null;
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const once = (suffix) => { // true the first time per prompt; false after, or when the state cannot be kept
    const key = `${session}:${turn.uuid || turn.prompt.slice(0, 80)}:${suffix}`;
    if (seen[key]) return false;
    for (const [k, at] of Object.entries(seen)) if (Date.now() - at > 7 * 86400000) delete seen[k];
    seen[key] = Date.now();
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); return true; } catch { return false; }
  };
  if (q && once('q')) return 'Waymark: this turn was routed as a question (Q) but is about to change project files. A question that becomes a change is a task: re-route with a tool call — invoke the owner dept-* skill with args "L<n>" (e.g. Skill dept-frontend, args "L2"); a routing line written mid-turn is not persisted — then the opener, and put the decision to the user with the optimal options before changing anything.';
  // Strict gate (user's decision 2026-10-02): no change until the user was asked in the choice window in this task.
  if (!askedChoice(taskLines(lines))) {
    return `Waymark: L${level} decision gate — the user decides every real decision, you never decide alone. Before changing files, ask in your choice window (AskUserQuestion): the approach with its optimal options (files, risk, cost; recommended marked, it may not be what the user needs) AND, as more questions in the same call (up to 4), every decision that shapes the work you can foresee — data/schema design, visual style, behavior details, defaults. Never offer, recommend or run browser verification (browser-verify, Playwright) unless the user asks for it: prove UI work with specs and the build. ` +
      'Later questions only confirm; the user\'s answer is recorded as is. The branch is the user\'s: never asked as a decision. If there is only one real way, or the user already chose in their message, confirm it there (that option + "otra cosa"). This gate stays until the user has been asked in this task.';
  }
  return null;
}

// → the denial reason, or null.
export function gate(hook, agent) {
  const c = agent.call(hook), cwd = hook.cwd || process.cwd();
  if (!c) return null;
  const withNote = (deny) => (deny ? deny + agent.note(SKILLS_DIR) : null);
  if (c.command !== undefined) return changesProject(c.command) ? withNote(checkDecision({ command: c.command }, readTurns((b) => agent.read(hook, b)), hook.session_id, undefined, cwd)) : null;
  const files = c.files.filter((f) => !exempt(f));
  if (!files.length) return null;
  const lines = readTurns((b) => agent.read(hook, b)); // a long session (pasted images) keeps the turn's prompt in view
  for (const f of files) { const deny = checkDecision(f, lines, hook.session_id, undefined, cwd); if (deny) return withNote(deny); }
  return null;
}
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const run = () => {
    if (done) return;
    done = true;
    try {
      const deny = gate(JSON.parse(input), agent);
      if (deny) process.stdout.write(JSON.stringify(agent.out.deny(deny)));
    } catch {}
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', run);
  process.stdin.resume();
  setTimeout(run, 1000).unref();
}
