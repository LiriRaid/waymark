#!/usr/bin/env node
// Waymark · decision gate, the pre-tool link of the chain (docs/adr/0001–0005, 0008). Registered by install-hooks.mjs
// as a pre-tool hook (Claude Code: PreToolUse, matcher "Bash|PowerShell|Edit|Write|NotebookEdit"; another agent: same
// script with `--agent <name>`). Runs locally (0 tokens unless it fires). Every L1–L3 change to project files (edits,
// and shell commands that change files: git checkout --, sed -i, rm, redirects) is denied until the task has a
// choice-window question (AskUserQuestion), so a retry never applies a decision before asking. A turn routed Q is told once to re-route (by tool call: the owner dept-* with args "L<n>"). The
// message asks for the foreseeable sub-decisions in the same call; browser verification is never offered (only when the
// user asks); the branch is the user's, never pushed as a sub-decision. An unrouted reply inside an open task inherits its routing.
// Memory and scratch files are exempt; L0 skipped. Procedure and mem_search are recorded and scored by the end-of-turn hook, not denied.
// A git commit whose "Waymark-Task" trailer the end-of-turn hook would record under another ID is denied with the right one.
// Remove the hook from the agent's settings to disable it.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { currentTurn, routedLevel, inheritedRoute, readTurns } from './transcript.mjs';
import { spawnSync } from 'node:child_process';
import { taskLines, taskStart, askedChoice, changesProject, projectHome, readRecords, taskIds, validId, taskFiles } from './provenance.mjs';
import { agentFrom } from './agents/index.mjs';

const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

// Files the routine itself writes (memory, learnings, scratch) never need the opener.
const exempt = (file) => {
  const f = norm(file), home = norm(os.homedir());
  return f.startsWith(`${home}/.waymark/`) || f.includes('/.waymark/') || f.includes('/.claude/projects/') || f.includes('/appdata/local/temp/') || f.startsWith('/tmp/') || f.includes('/scratchpad/');
};

// Decision gate: deny once per prompt (state keyed by session + prompt uuid), never for L0 or exempt files. A turn routed
// Q that edits a project file is denied once too: a question that became a change must re-route, or every check and
// the record would be skipped.
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
  // The task starts after this session's last close: the previous task's question never opens it (the ID is not known
  // yet, so a follow-up asks or confirms again).
  let records = [];
  try { records = readRecords(projectHome(cwd).log); } catch {}
  if (!askedChoice(taskLines(lines, { since: taskStart(records, session) }))) {
    return `Waymark: L${level} decision gate — the user decides every real decision, you never decide alone. Before changing files, ask in your choice window (AskUserQuestion): the approach with its optimal options (files, risk, cost; recommended marked, it may not be what the user needs) AND, as more questions in the same call (up to 4), every decision that shapes the work you can foresee — data/schema design, visual style, behavior details, defaults. Never offer, recommend or run browser verification (browser-verify, Playwright) unless the user asks for it: prove UI work with specs and the build. ` +
      'Later questions only confirm; the user\'s answer is recorded as is. The branch is the user\'s: never asked as a decision. If there is only one real way, or the user already chose in their message, confirm it there (that option + "otra cosa"). This gate stays until the user has been asked in this task.';
  }
  return null;
}

// Commit trailer: a "Waymark-Task: <id>" the end-of-turn hook would record under another ID (a follow-up letter whose
// task shares no staged file, or an ID never offered) is denied with the right one, so a commit and its record carry
// the same ID. A recorded task's ID passes (its work committed by a later task); nothing staged yet → no evidence, no
// denial. → the denial reason, or null.
export function checkTrailer(command, cwd = process.cwd()) {
  const id = String(command || '').match(/Waymark-Task:\s*(20\d\d-\d\d-\d\d · T\d+[a-z]?)/)?.[1];
  if (!id || !/\bgit\b[\s\S]*\bcommit\b/.test(command)) return null;
  const ids = taskIds(cwd);
  if (ids.known.has(id)) return null;
  const home = projectHome(cwd);
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: home.root, encoding: 'utf8', timeout: 3000 });
  const files = staged.status === 0 ? staged.stdout.split('\n').filter(Boolean).map((f) => norm(path.resolve(home.root, f))) : [];
  if (!files.length) return null;
  const parent = id.replace(/[a-z]$/, '');
  let why = validId(id, ids) ? null : 'was never offered for this task';
  if (!why && id !== parent) {
    const own = new Set(taskFiles(readRecords(home.log), id).map(norm));
    if (!files.some((f) => own.has(f))) why = `is a follow-up of ${parent}, but none of the staged files is one ${parent} changed`;
  }
  return why ? `Waymark: the trailer "Waymark-Task: ${id}" ${why}, so the end-of-turn hook would record this task as ${ids.next} and the commit would disagree with its record. Commit with "Waymark-Task: ${ids.next}" and use the same ID in the Cierre heading.` : null;
}

// → the denial reason, or null.
export function gate(hook, agent) {
  const c = agent.call(hook), cwd = hook.cwd || process.cwd();
  if (!c) return null;
  const withNote = (deny) => (deny ? deny + agent.note(SKILLS_DIR) : null);
  if (c.command !== undefined) {
    const trailer = checkTrailer(c.command, cwd);
    if (trailer) return trailer;
    return changesProject(c.command) ? withNote(checkDecision({ command: c.command }, readTurns((b) => agent.read(hook, b)), hook.session_id, undefined, cwd)) : null;
  }
  const files = c.files.filter((f) => !exempt(f));
  if (!files.length) return null;
  const lines = readTurns((b) => agent.read(hook, b)); // a long session (pasted images) keeps the turn's prompt in view
  for (const f of files) { const deny = checkDecision(f, lines, hook.session_id, undefined, cwd); if (deny) return withNote(deny); }
  return null;
}
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Recordar by the hook (docs/adr/0015): the first edit of each project file in a task gets that file's `pack` (what
// earlier tasks did there) as context, so the routine never depends on the agent remembering it. Claude Code and Codex
// take it before the tool runs; OpenCode and Gemini CLI with the tool's result (their after-tool hook). The files
// handed over are kept per session and task (packed state), and the end-of-turn hook reads them for the testigo.
export const PACKED = () => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.packed.json');
const readPacked = (file = PACKED()) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
// The files whose pack this session's current task already got (task = since its last close). → Set of normalized paths.
export function packedFiles(session, since = 0, file = PACKED()) {
  const st = readPacked(file)[session || 'unknown'];
  return new Set(st && st.since === since ? st.files : []);
}
export async function packContext(hook, agent, file = PACKED()) {
  const c = agent.call(hook), cwd = hook.cwd || process.cwd();
  const home = projectHome(cwd);
  if (!home.dir || home.legacy) return null; // a project with Waymark's memory
  // the project's own files: not outside its root (scratch), not Waymark's or engram's memory
  const root = norm(home.root);
  const files = (c?.files || []).filter((f) => { const p = norm(path.resolve(cwd, f)); return p.startsWith(`${root}/`) && !/\/\.(waymark|engram)\//.test(p); });
  if (!files.length) return null;
  let records = [];
  try { records = readRecords(home.log); } catch {}
  const session = hook.session_id || 'unknown', since = taskStart(records, session);
  const done = packedFiles(session, since, file), fresh = files.filter((f) => !done.has(norm(path.resolve(cwd, f))));
  if (!fresh.length) return null;
  const { pack } = await import('./waymark.mjs');
  const text = pack(cwd, fresh);
  const all = readPacked(file);
  for (const [k, v] of Object.entries(all)) if (Date.now() - (v.at || 0) > 7 * 86400000) delete all[k];
  all[session] = { since, at: Date.now(), files: [...done, ...fresh.map((f) => norm(path.resolve(cwd, f)))] };
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(all)); } catch { return null; }
  return `Waymark memory for the file${fresh.length > 1 ? 's' : ''} you are changing (waymark.mjs pack, handed over by the hook; earlier tasks there, newest first):\n${text}`;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const run = async () => {
    if (done) return;
    done = true;
    try {
      const hook = JSON.parse(input), after = /^(PostToolUse|AfterTool)$/.test(hook.hook_event_name || '');
      if (!after) {
        const deny = gate(hook, agent);
        if (deny) { process.stdout.write(JSON.stringify(agent.out.deny(deny))); return; }
      }
      if (after || agent.preContext) {
        const text = await packContext(hook, agent);
        if (text) process.stdout.write(JSON.stringify(agent.out.context(after ? 'PostToolUse' : 'PreToolUse', text)));
      }
    } catch {}
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', run);
  process.stdin.resume();
  setTimeout(run, 1000).unref();
}
