#!/usr/bin/env node
// Waymark · the per-prompt link of the chain (docs/adr/0001, 0002, 0008). Registered by install-hooks.mjs as a
// per-prompt hook (Claude Code: UserPromptSubmit; another agent: same script with `--agent <name>`). Runs locally
// (0 tokens); only this reaches the model:
// - the Rule 0 reminder: full (~140 tokens) when the last reply did not open with "Waymark →", one line (~60) when it did;
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
import { taskIds, saveSnapshot, markOpen, projectHome } from './provenance.mjs';
import { stackLine } from './stack.mjs';
import { agentFrom } from './agents/index.mjs';

const HOME = process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // where this install's skills live

// Coexistence mode (~/.waymark/coexistence.md, waymark/references/coexistence.md) decides the reminder.
let mode = '';
try { mode = fs.readFileSync(path.join(HOME, 'coexistence.md'), 'utf8').match(/^Mode:\s*(waymark-leads|guest|other-leads|skills-only)\b/m)?.[1] || ''; } catch {}

// guest / skills-only (and 1.5.0's other-leads): the orchestrator owns the turn, so no reminder at all.
// The rules themselves live in the instructions block; this only points at the steps a new session skips most.
const full =
  'Waymark Rule 0 (the instructions block) — first text: "Waymark → L<n>|Q · <dept> · skills: …"; first tool call: the owner dept-* skill. ' +
  'Before the first change: its procedures.md section, L2+ mem_search, git status --short, then one choice-window call with the options and every decision that shapes the work (the user decides; never offer browser verification). ' +
  'Close changes with "## Cierre · <task ID>" (Resultado · Evidencia · Aprendido ≤200 characters). The end-of-turn hook blocks once per testigo of waymark/routine.json that applies. Independent tool calls in one response. User\'s language. Only L0 skips.';
const short = 'Waymark Rule 0 as in your last reply: routing line + owner dept-* skill first; opener before the first edit; the user decides every real decision (options first); "## Cierre · <task ID>" after changes. Independent tool calls in one response.';
export function taskLine(cwd, now = new Date()) {
  const ids = taskIds(cwd, now);
  return ` Task ID for the Cierre heading: new task → ${ids.next}${ids.followUp ? ` · follow-up of ${ids.last} → ${ids.followUp}` : ''}.`;
}
export const REMINDER = { full, short }; // measured by size.mjs
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
  // the stack as the repo has it now (package manager, versions): never from memory, which can be stale
  let repo = '';
  try { const line = stackLine(projectHome(cwd).root); if (line) repo = ` Repo (read now): ${line}.`; } catch {}
  return agent.out.context('UserPromptSubmit', (st.openedWithWaymark ? short : full) + ids + repo + (mode === 'waymark-leads' ? coexist : '') + agent.note(SKILLS_DIR));
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
