#!/usr/bin/env node
// Waymark · the per-prompt link of the chain (docs/adr/0001, 0002, 0008). Registered by install-hooks.mjs as a
// per-prompt hook (Claude Code: UserPromptSubmit; another agent: same script with `--agent <name>`). Runs locally
// (0 tokens); only this reaches the model:
// - the Rule 0 reminder: full (~130 tokens) when the last reply did not open with "Waymark →", one line (~40) when it did;
// - the task ID of a new task and of a follow-up of the last recorded one (~25 tokens), from the project's provenance
//   log; the Cierre heading carries it.
// It also takes a git snapshot (the end-of-turn hook diffs against it) and marks the turn open in .waymark/open.json, so
// a turn that never ends (quota, crash) still shows in tasks.md. Update checks, session size and offers live in
// `waymark.mjs check` (docs/adr/0008). Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { sessionState } from './transcript.mjs';
import { taskIds, saveSnapshot, markOpen } from './provenance.mjs';
import { agentFrom } from './agents/index.mjs';

const HOME = process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // where this install's skills live

// Coexistence mode (~/.waymark/coexistence.md, waymark/references/coexistence.md) decides the reminder.
let mode = '';
try { mode = fs.readFileSync(path.join(HOME, 'coexistence.md'), 'utf8').match(/^Mode:\s*(waymark-leads|guest|other-leads|skills-only)\b/m)?.[1] || ''; } catch {}

// guest / skills-only (and 1.5.0's other-leads): the orchestrator owns the turn, so no reminder at all.
const full =
  'Waymark Rule 0 — first text: "Waymark → L<n>|Q · <dept> · skills: …"; first tool call: the owner dept-* skill. ' +
  'Before the first edit: "Pedido · Captura" (the ask; what each image marks; "like X" → Copia: only what was named; a layer the user named → Capa, ask before leaving it) then "Memoria · Reutiliza · Evidencia · Procedimiento" (memory digest injected at session start: pointers, verify in code; obey Environment; code read ≠ observed). ' +
  'Every real decision, any level: the optimal options (files, risk, cost; recommended marked) plus every decision that shapes the work, all in the first choice-window call, before acting; never offer, recommend or run browser verification (browser-verify, Playwright) unless the user asks for it: prove UI work with specs and the build. Later questions only confirm; the decision is the user\'s answer in the choice window, recorded as is (never restate it); the branch is the user\'s, never asked as a decision; A rule or preference of the user exists only where it is written (their message, memory.md, preferences.md): cite it, never assume one; none → ask. the user decides, never you; changes stay blocked until asked. A question that becomes a change: re-route by invoking the owner dept-* skill with args "L<n>". Before the first change: its procedures.md section, L2+ mem_search, git status --short. Commits of the task carry "Waymark-Task: <task ID>" in the last paragraph, next to Co-Authored-By. ' +
  'Gates: scoped while working, full typecheck/build once at the end, after the last change. A failure you call pre-existing: check it right then in a clean copy (git worktree add). ' +
  'Close changes with "## Cierre · <task ID>" (Resultado · Evidencia · Aprendido = the task\'s line for the next session, ≤200 characters; the hook writes it into the project memory and keeps the record as a git note on the task\'s commit); the hook judges the rest with testigos that execute, records them with an automatic evaluation, and blocks once for every testigo of waymark/routine.json that applies (choice window before the first change, a passing gate after the last code change, the Cierre, no secrets, the owner\'s procedure; L2+: mem_search, code-review and build with code; a spec next to the changed code; red and pre-existing claims backed; docs behind an inference from docs). Independent tool calls in one response. User\'s language. Only L0 skips.';
const short = 'Waymark Rule 0 as in your last reply: routing line + owner dept-* skill first; opener before the first edit; the user decides every real decision (options first); "## Cierre · <task ID>" after changes. Independent tool calls in one response.';
export function taskLine(cwd, now = new Date()) {
  const ids = taskIds(cwd, now);
  return ` Task ID for the Cierre heading: new task → ${ids.next}${ids.followUp ? ` · follow-up of ${ids.last} → ${ids.followUp}` : ''}.`;
}
const coexist = ' Coexistence: follow the injected Adopted/Fallback/Resolved rules; never edit the other framework\'s files.';
const silent = ['guest', 'other-leads', 'skills-only'].includes(mode);

export function reminder(hook, agent) {
  if (silent) return null;
  const cwd = hook.cwd || process.cwd();
  let st = { openedWithWaymark: false };
  try { st = sessionState(agent.read(hook)); } catch {}
  let ids = '';
  try { ids = taskLine(cwd); } catch {}
  try { saveSnapshot(hook.session_id, cwd); } catch {} // the end-of-turn hook diffs against it
  try { markOpen(cwd, hook.session_id, hook.prompt, new Date(), agent.name); } catch {} // a turn that never ends still shows in tasks.md, with its agent
  return agent.out.context('UserPromptSubmit', (st.openedWithWaymark ? short : full) + ids + (mode === 'waymark-leads' ? coexist : '') + agent.note(SKILLS_DIR));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const run = () => {
    if (done) return;
    done = true;
    let hook = {};
    try { hook = JSON.parse(input); } catch {}
    try { const out = reminder(hook, agent); if (out) process.stdout.write(JSON.stringify(out)); } catch {}
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', run);
  process.stdin.resume();
  setTimeout(run, 1000).unref();
}
