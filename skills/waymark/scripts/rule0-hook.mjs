#!/usr/bin/env node
// Waymark · the per-prompt link of the chain (docs/adr/0001, 0002, 0008). Registered by install-hooks.mjs as a
// per-prompt hook (Claude Code: UserPromptSubmit; another agent: same script with `--agent <name>`). Runs locally
// (0 tokens); only this reaches the model:
// - the Rule 0 reminder: full (~70 tokens) when the last reply did not open with "Waymark →", one line (~10) when it did;
// - the repo now: its stack (package manager, versions) and a one-line git status (branch, changed files);
// - the task ID of a new task and of a follow-up of the last recorded one (~25 tokens), from the project's provenance
//   log; the Cierre heading carries it.
// It also takes a git snapshot (the end-of-turn hook diffs against it) and marks the turn open in .waymark/open.json, so
// a turn that never ends (quota, crash) still shows in tasks.md. Update checks, session size and offers live in
// `waymark.mjs check` (docs/adr/0008). Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sessionState } from './transcript.mjs';
import { taskIds, saveSnapshot, markOpen, projectHome } from './provenance.mjs';
import { stackLine, directBins } from './stack.mjs';
import { agentFrom } from './agents/index.mjs';

const HOME = process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // where this install's skills live

// Coexistence mode (~/.waymark/coexistence.md, waymark/references/coexistence.md) decides the reminder.
let mode = '';
try { mode = fs.readFileSync(path.join(HOME, 'coexistence.md'), 'utf8').match(/^Mode:\s*(waymark-leads|guest|other-leads|skills-only)\b/m)?.[1] || ''; } catch {}

// guest / skills-only (and 1.5.0's other-leads): the orchestrator owns the turn, so no reminder at all.
// The rules themselves live in the instructions block; this only points at the steps a new session skips most.
// The rules live once, in the block; the reminder points at the steps a turn skips most (docs/adr/0015, C3).
const full = 'Waymark Rule 0 (the instructions block): routing line first ("Waymark → L<n> or Q · dept-<owner> · skills: …"); a department not loaded yet in this session → its dept-* skill; one choice-window call before the first change; "## Cierre · <task ID>" after changes. User\'s language.';
const short = 'Waymark Rule 0 as in your last reply.';
// The repo's state now, so the agent does not spend a response on `git status` (docs/adr/0015, C2). → '' outside git.
export function gitLine(root, max = 8) {
  const r = spawnSync('git', ['status', '--short', '--branch'], { cwd: root, encoding: 'utf8', timeout: 2000 });
  if (r.status !== 0) return '';
  const [head, ...files] = r.stdout.split('\n').filter(Boolean);
  const branch = head.replace(/^##\s*/, '').replace(/\.\.\.\S+/, '').trim();
  const shown = files.slice(0, max).map((l) => `${l.slice(0, 2).trim()} ${l.slice(3)}`).join(', ');
  return ` Git (read now): ${branch} · ${files.length ? `${files.length} changed: ${shown}${files.length > max ? ', …' : ''}` : 'clean'}.`;
}
export function taskLine(cwd, now = new Date()) {
  const ids = taskIds(cwd, now);
  return ` Task ID for the Cierre heading: new task → ${ids.next}${ids.followUp ? ` · follow-up of ${ids.last} (it continues that task's files) → ${ids.followUp}` : ''}.`;
}
export const REMINDER = { full, short }; // measured by size.mjs
const coexist = ' Coexistence: follow the injected Adopted/Fallback/Resolved rules; never edit the other framework\'s files.';
const silent = ['guest', 'other-leads', 'skills-only'].includes(mode);

// Context brake (docs/adr/0016): every response re-reads the whole session, so a new message to a session past
// BRAKE_TOKENS is stopped before the model (0 tokens), once per session. The message is kept in
// .waymark/next-prompt.md and the next session's card brings it; sending it again here continues. Agents whose
// prompt hook cannot stop a prompt (no out.blockPrompt) get one line in the reminder instead.
// WAYMARK_BRAKE_TOKENS tunes it (0 = off).
export const BRAKE_TOKENS = Number(process.env.WAYMARK_BRAKE_TOKENS ?? 300000);
export const NEXT_PROMPT = 'next-prompt.md';
export function brake(hook, agent, st, stateFile = path.join(HOME, '.brake.json')) {
  if (!BRAKE_TOKENS || (st.context || 0) < BRAKE_TOKENS || !String(hook.prompt || '').trim()) return null;
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const session = hook.session_id || 'unknown', k = `${Math.round(st.context / 1000)}k`;
  if (seen[session]) { // braked once already: the user chose to continue here, so this session's held message is not for a new one
    try {
      const home = projectHome(hook.cwd || process.cwd()), file = path.join(home.dir, NEXT_PROMPT);
      if (home.dir && !home.legacy && fs.readFileSync(file, 'utf8').split('\n')[0].includes(`· session ${session} -->`)) fs.rmSync(file, { force: true });
    } catch {}
    return null;
  }
  for (const [s, at] of Object.entries(seen)) if (Date.now() - at > 7 * 86400000) delete seen[s];
  seen[session] = Date.now();
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return null; }
  if (!agent.out.blockPrompt) return { line: ` Context: this session holds ~${k} tokens and every response re-reads them; before working, tell the user in one line that a new session is cheaper (the card, tasks.md and engram carry the work over).` };
  const home = projectHome(hook.cwd || process.cwd());
  let kept = '';
  try { if (home.dir && !home.legacy) { fs.writeFileSync(path.join(home.dir, NEXT_PROMPT), `<!-- ${new Date().toISOString()} · held by the context brake (~${k}) · session ${session} -->\n${String(hook.prompt).trim()}\n`); kept = ` Your message is kept in .waymark/${NEXT_PROMPT}: the new session's card brings it.`; } } catch {}
  return { block: agent.out.blockPrompt(`Waymark: this session holds ~${k} tokens of context and every response re-reads all of it. Open a new session (the card, tasks.md and engram carry the work over).${kept} Send it again here to continue in this session.`) };
}

export function reminder(hook, agent) {
  if (silent) return null;
  const cwd = hook.cwd || process.cwd();
  let st = { openedWithWaymark: false };
  try { st = sessionState(agent.read(hook)); } catch {}
  let held = null;
  try { held = brake(hook, agent, st); } catch {}
  if (held?.block) return held.block; // stopped before the model: no snapshot, no open turn
  let ids = '';
  try { ids = taskLine(cwd); } catch {}
  try { saveSnapshot(hook.session_id, cwd); } catch {} // the end-of-turn hook diffs against it
  try { markOpen(cwd, hook.session_id, hook.prompt, new Date(), agent.name); } catch {} // a turn that never ends still shows in tasks.md, with its agent
  // the stack as the repo has it now (package manager, versions): never from memory, which can be stale
  let repo = '';
  try { const line = stackLine(projectHome(cwd).root, { direct: directBins(agent.name) }); if (line) repo = ` Repo (read now): ${line}.`; } catch {}
  try { repo += gitLine(projectHome(cwd).root); } catch {}
  return agent.out.context('UserPromptSubmit', (st.openedWithWaymark ? short : full) + ids + repo + (held?.line || '') + (mode === 'waymark-leads' ? coexist : '') + agent.note(SKILLS_DIR));
}

// Real paths on both sides: Node runs a script reached through a link (~/.claude/skills → ~/.agents/skills) from its
// real path, so the path as typed would never match and the hook would do nothing.
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
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
