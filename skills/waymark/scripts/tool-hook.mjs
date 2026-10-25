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
import { readStdin } from './lib/stdin.mjs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { currentTurn, routedLevel, routedDept, inheritedRoute, readTurns, readTail, sessionTools, isPrompt, promptText } from './transcript.mjs';
import { spawnSync } from 'node:child_process';
import { changesProject, shellSkeleton, shellRuns, scriptWriteTargets } from './runs.mjs';
import { taskLines, taskStart, decisionsIn, askedChoice, addRepoSnapshot, projectHome, readRecords, taskIds, validId, taskFiles, logHookError, PROBE_OK } from './provenance.mjs';
import { agentFrom, parseHook, answer } from './agents/index.mjs';
import { recordSpend } from './statusline.mjs';
import { norm, exemptPath, repoOf, nameIn } from './lib/paths.mjs';
import { inRoot } from './copy.mjs';
import { loadRisk, isSensitive } from './lib/risk.mjs';
import { addDenied } from './lib/denied.mjs';
import { commandSensitive, expandHome } from './lib/guard.mjs';
import { grantsIn, recordGrants, WINDOW } from './lib/grants.mjs';
import { PACKED, readPacked, packedFiles, procDelivered } from './lib/packed.mjs';
export { PACKED, packedFiles, procDelivered }; // moved to lib/packed.mjs; kept for existing importers


// Files the routine itself writes (memory, learnings, scratch) never need the opener; the rule lives in lib/paths.mjs.
const exempt = (file, root = '') => exemptPath(file, root);

// Decision gate: deny once per prompt (state keyed by session + prompt uuid), never for L0 or exempt files. A turn routed
// Q that edits a project file is denied once too: a question that became a change must re-route, or every check and
// the record would be skipped.
export function checkDecision(target, lines, session = 'unknown', stateFile = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.decision-gate.json'), cwd = process.cwd()) {
  // target: a file path (an edit) or { command } (a shell command that changes files: git checkout --, sed -i, rm, >).
  if (target && typeof target === 'object') { if (!changesProject(target.command)) return null; }
  else if (!target || exempt(target, cwd)) return null;
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

// A git commit the shell runs, read on the command's skeleton (heredoc and here-string bodies blanked): a file written
// through a heredoc that mentions `git commit` is no commit. The message and its trailer are read on the whole command.
// `git` must start the command (after ; && | or a subshell, env assignments allowed) and only its global options may stand
// before `commit`: `git config --get commit.gpgsign`, `git -c commit.gpgsign=false status` and `echo git commit` are no commit.
const isCommit = (command) => /(?:^|[;&|(]\s*|\n\s*)(?:[A-Za-z_]\w*=\S*\s+)*git(?:\s+(?:-c\s+\S+|-C\s+\S+|--[\w-]+(?:=\S+)?))*\s+commit(?![\w-])/.test(shellSkeleton(command, { quotes: false }));

// Commit trailer: a "Waymark-Task: <id>" the end-of-turn hook would record under another ID (a follow-up letter whose
// task shares no staged file, or an ID never offered) is denied with the right one, so a commit and its record carry
// the same ID. A recorded task's ID passes (its work committed by a later task); nothing staged yet → no evidence, no
// denial. → the denial reason, or null.
export function checkTrailer(command, cwd = process.cwd()) {
  const id = String(command || '').match(/Waymark-Task:\s*(20\d\d-\d\d-\d\d · T\d+[a-z]?)/)?.[1];
  if (!id || !isCommit(command)) return null;
  const ids = taskIds(cwd);
  if (ids.known.has(id)) return null;
  const home = projectHome(cwd);
  const staged = spawnSync('git', ['diff', '--cached', '--name-only'], { cwd: home.root, encoding: 'utf8', timeout: 5000 });
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

// A commit whose message carries no "Waymark-Task:" leaves its task's record unlinked: denied once per session and task
// ID, with the ID to add; sent again without it, it goes through (the user may not want a trailer in that repo). Not
// judged: --amend --no-edit (no message written) and -F <file> (a message the hook cannot see). → the reason, or null.
export function missingTrailer(command, session = 'unknown', cwd = process.cwd(), stateFile = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.trailer-gate.json')) {
  const c = String(command || '');
  if (!isCommit(c) || /Waymark-Task:/.test(c) || /--amend\b[\s\S]*--no-edit|--no-edit[\s\S]*--amend/.test(c)) return null;
  if (/(?:\s-F|\s--file)[\s=]+(?!-(?:\s|$))\S/.test(c)) return null;
  const ids = taskIds(cwd), key = `${session || 'unknown'}:${ids.next}`;
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  if (seen[key]) return null;
  for (const [k, at] of Object.entries(seen)) if (Date.now() - at > 7 * 86400000) delete seen[k];
  seen[key] = Date.now();
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return null; }
  return `Waymark: this commit has no "Waymark-Task: <task ID>" in its message, so the task's record and the commit stay unlinked. Add it as the message's last paragraph, next to Co-Authored-By: "Waymark-Task: ${ids.next}"${ids.followUp ? ` (or "${ids.followUp}" when it continues ${ids.last})` : ''}, and use the same ID in the Cierre heading. Sent again without it, the commit goes through.`;
}

// Sensitive-path guard (docs/adr/0027): a read or an edit of a secret-bearing path (routine.json `risk.sensitive`: .env*, ~/.ssh,
// ~/.aws, ~/.config/gcloud, keys) is denied, except what `risk.allow` and the user's `Sensitive allow:` line in
// ~/.waymark/preferences.md name. It acts where the agent's hook runs before the tool: Claude Code's Read, Edit and Write,
// every agent's edit tools, and a shell command whose arguments (or redirect target) name such a path that exists, also through a glob,
// a flag's value, an attached redirect, a revision (`git show HEAD:.env`) or another shell (`bash -c`; lib/guard.mjs).
// It does not stop what a command only reaches by searching (`grep -r KEY .`, `find`, a script that reads the file): the end-of-turn
// hook detects what got through (detectGuarded) and records it.
export { commandSensitive }; // the reading of a shell command lives in lib/guard.mjs, shared with the end-of-turn detection
// `lines` (optional) reads the session's transcript: when the guard would deny, the user may have answered the permission window since (lib/grants.mjs);
// their answer, read there, is written as a `Sensitive allow:` line with its scope and the call is judged again. Nothing the agent writes grants anything.
export function checkSensitive(c, cwd, session = 'unknown', lines = null) {
  if (!c) return null;
  let root = cwd;
  try { root = projectHome(cwd).root; } catch {}
  const paths = c.reads || c.files || [];
  const look = () => { const cfg = loadRisk(root, { session }); return c.command !== undefined ? commandSensitive(c.command, cwd, cfg) : paths.map((f) => path.resolve(cwd, expandHome(f))).find((f) => isSensitive(f, cfg)); };
  let hit = look();
  if (hit && lines) {
    try { if (recordGrants(grantsIn(decisionsIn(lines())), { session, taskId: taskIds(cwd).next })) hit = look(); } catch (e) { logHookError('tool-hook grants', e); }
  }
  if (!hit) return null;
  try { addDenied(session, { tool: c.command !== undefined ? 'shell' : c.reads ? 'read' : 'edit', path: String(hit).replace(/\\/g, '/') }); } catch {}
  const named = String(hit).replace(/\\/g, '/');
  return `Waymark: ${named} is a sensitive path (secrets, keys or credentials): reading or editing it is blocked, and only the user can allow it: a message in the chat does not. Ask them in a choice window whose question contains "Sensitive allow: ${named}" and whose options are exactly: ${WINDOW}. Their answer unblocks it (for this task, this session or always); or they write the line "Sensitive allow: ${named}" in ~/.waymark/preferences.md (or "allow" in the project's .waymark/risk.json). Do not look for another way to read it, and never write down what you read.`;
}

// → the denial reason, or null.
// A junction or symbolic link to a node_modules (mklink /J, New-Item -ItemType Junction|SymbolicLink, ln -s): the package manager of the
// copy can purge the repo's modules through it, which deleted a project's own dependencies. A clean copy installs from the store.
const LINK = /\bmklink\b[^\n]*\/[JD]\b|New-Item\b[^\n|;]*-ItemType\s+(?:Junction|SymbolicLink)|\bln\s+-[a-z]*s[a-z]*\b/i;
export function checkLink(command) {
  const text = String(command || '');
  return LINK.test(text) && /node_modules/i.test(text)
    ? 'Waymark: a junction or link to a node_modules is denied: the clean copy\'s package manager can purge the repo\'s own modules through it. Make the copy with `waymark.mjs copy HEAD` (a short folder Waymark owns; it prints the install step, which installs from the store with no network) and remove it with `waymark.mjs copy --remove <path>`.'
    : null;
}

// The user's accounts and pull requests are the user's (docs/adr/0046): switching the gh account is denied always; opening or merging a pull
// request only when the task's own words ask for one. Waymark reads `git config user.email` and `gh auth status` when it needs to know
// whose they are, and never writes either anywhere.
const GH_START = String.raw`(?:^|[;&|(]\s*|\n\s*)(?:(?:[A-Za-z_]\w*=\S*|&|command|sudo|env|exec)\s+)*gh(?:\.exe)?\s+`; // after an env assignment, `command`, `sudo`, PowerShell's `&`, or the .exe
const GH_AUTH = new RegExp(`${GH_START}auth\\s+(?:switch|login|logout|refresh|setup-git)\\b`);
const GH_PR = new RegExp(`${GH_START}pr\\s+(create|merge|ready)\\b`);
// What the request says about a pull request, with what it denies left out ("no abras el PR").
const asking = (text, words) => new RegExp(String.raw`\b(?:${words})\b`, 'i').test(String(text).replace(/\b(?:no|sin|nunca|don't|do not|never)\b[^.\n]{0,30}\b(?:pull requests?|PRs?|merge)\b/gi, ' '));
export function checkGh(command, asked = '') {
  const sk = shellSkeleton(command, { quotes: false });
  if (GH_AUTH.test(sk)) return 'Waymark: changing the gh account (auth switch, login, logout, refresh, setup-git) is the user\'s: it decides which of their accounts every later command uses, and it is not undone by switching back. Read which one is active with `gh auth status` and tell the user if it is not the one the task needs; never write the account or an address anywhere.';
  const pr = sk.match(GH_PR)?.[1];
  // opening one needs the words "pull request" or "PR"; merging one also takes "merge" ("resuelve el conflicto de merge" opens nothing)
  if (pr && !asking(asked, pr === 'merge' ? 'pull requests?|PRs?|merge|mergea\\w*|fusiona\\w*' : 'pull requests?|PRs?')) return 'Waymark: opening or merging a pull request is the user\'s (they open and merge every one), and this task\'s request does not ask for one. Leave the branch pushed if they said so and tell them it is ready; if they do want it opened, they say so in the request.';
  return null;
}

// A repository the task's request does not name (docs/adr/0046): the Pedido line lists the repos it touches (`Repos: a, b`), and the user\'s answer in the
// choice window that names one counts too. Editing another is denied once per task and repo, asking the user first.
export function namedRepos(lines) {
  const text = [];
  for (const d of lines || []) {
    if (d.type === 'assistant' && !d.isSidechain) for (const c of d.message?.content || []) if (c.type === 'text') for (const m of String(c.text).replace(/\*\*|__/g, '').matchAll(/(?:^|·)[ \t]*(?:[-*]\s*)?Repos?:[ \t]*([^\n·]+)/gim)) text.push(m[1]);
    const r = d.toolUseResult;
    if (d.type === 'user' && r && Array.isArray(r.questions) && r.answers) text.push(...Object.values(r.answers).map(String));
    if (d.type === 'user' && !d.isSidechain && typeof d.message?.content === 'string') text.push(d.message.content);
  }
  return text.join('\n').toLowerCase();
}
export function checkRepo(root, cwdRoot, lines, session, stateFile = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.repo-gate.json'), task = '') {
  if (!root || norm(root) === norm(cwdRoot) || path.basename(root).length < 2 || inRoot(root)) return null; // Waymark's own clean copies are no repository of the user's
  if (nameIn(path.basename(root), namedRepos(lines))) return null;
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const key = `${session}:${task}:${norm(root)}`; // once per task and repo
  if (seen[key]) return null; // asked once; the same repo again goes through
  for (const [k, at] of Object.entries(seen)) if (Date.now() - at > 7 * 86400000) delete seen[k];
  seen[key] = Date.now();
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return null; }
  return `Waymark: this change is in ${path.basename(root)}, a repository the task's request does not name (the session works in ${path.basename(cwdRoot)}). Ask the user in your choice window whether to change it, then name it in the Pedido line ("Repos: <each repo this task touches>"). Sent again after that, it goes through.`;
}

// A project that migrates with its own script (its Conventions: "Migrations: <command>") has the migration made and run by it: a migration file
// written by hand under a migrations folder is denied once per file, naming the script.
const MIGRATION_DIR = /(?:^|[\\/])(?:db[\\/]migrate|migrations?|prisma[\\/]migrations|alembic[\\/]versions|database[\\/]migrations)[\\/]/i;
export function checkMigration(file, memory, session, stateFile = path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.migration-gate.json')) {
  const script = String(memory || '').replace(/<!--[\s\S]*?-->/g, '').match(/^[ \t]*[-*]?[ \t]*Migrations?:[ \t]*(.+)$/im)?.[1]?.trim();
  if (!script || !MIGRATION_DIR.test(String(file)) || fs.existsSync(file)) return null; // a new file only; an edit of one is not the case
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const key = `${session}:${norm(file)}`;
  if (seen[key]) return null;
  seen[key] = Date.now();
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return null; }
  return `Waymark: this project migrates with its own script (Conventions: "Migrations: ${script.slice(0, 120)}"), and this writes a migration file by hand. Use the script to make it and to run it; if it cannot do what the task needs, say so in your choice window and write it by hand only if the user chooses that.`;
}

export function gate(hook, agent) {
  const c = agent.call(hook), cwd = hook.cwd || process.cwd();
  if (!c) return null;
  // The guard that cannot judge a command denies it: failing open there let a command with a bracket in it read what the guard exists to stop.
  let sensitive;
  const turns = () => { let since = 0; try { since = taskStart(readRecords(projectHome(cwd).log), hook.session_id); } catch {} return readTurns((b) => agent.read(hook, b), 3, undefined, undefined, since); };
  try { sensitive = checkSensitive(c, cwd, hook.session_id, turns); } catch (e) {
    logHookError('tool-hook guard', e);
    sensitive = `Waymark: the sensitive-path guard could not read this call (${String(e?.message || e).slice(0, 100)}), so it was not run. Rephrase it (one command, no pattern text in brackets) and run it again; the cause is in ~/.waymark/hook-errors.log.`;
  }
  if (sensitive) return sensitive;
  const withNote = (deny) => (deny ? deny + agent.note(SKILLS_DIR) : null);
  const taskKey = () => { try { return String(taskStart(readRecords(projectHome(cwd).log), hook.session_id)); } catch { return ''; } }; // the task's start: the repo question is asked once per task
  // turns(): read back to the task's start (its first prompt), so a task of many prompts keeps its first decision in view
  if (c.command !== undefined) {
    const link = checkLink(c.command);
    if (link) return link;
    if (/\bgh\s+(?:auth|pr)\b/.test(c.command)) { const gh = checkGh(c.command, turns().filter(isPrompt).map(promptText).join('\n')); if (gh) return gh; } // the user's account and pull requests
    const trailer = checkTrailer(c.command, cwd) || missingTrailer(c.command, hook.session_id, cwd);
    if (trailer) return trailer;
    if (!changesProject(c.command)) return null;
    const lines = turns(), own = projectHome(cwd).root;
    for (const d of commandRepos(c.command, cwd)) { const deny = checkRepo(repoOf(d), own, lines, hook.session_id, undefined, taskKey()); if (deny) return withNote(deny); }
    return withNote(checkDecision({ command: c.command }, lines, hook.session_id, undefined, cwd));
  }
  const files = (c.files || []).filter((f) => !exempt(f, cwd));
  if (!files.length) return null;
  const lines = turns(); // a long session (pasted images) keeps the turn's prompt in view
  const own = projectHome(cwd).root;
  let memory = '';
  try { memory = fs.readFileSync(projectHome(cwd).memory, 'utf8'); } catch {}
  for (const f of files) {
    const deny = checkRepo(repoOf(f), own, lines, hook.session_id, undefined, taskKey()) || checkMigration(f, memory, hook.session_id) || checkDecision(f, lines, hook.session_id, undefined, cwd);
    if (deny) return withNote(deny);
  }
  return null;
}
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Recordar by the hook (docs/adr/0015): the first edit of each project file in a task gets that file's `pack` (what
// earlier tasks did there) as context, so the routine never depends on the agent remembering it. Claude Code and Codex
// take it before the tool runs; OpenCode and Gemini CLI with the tool's result (their after-tool hook). The files
// handed over are kept per session and task (packed state), and the end-of-turn hook reads them for the testigo.
// The files a shell command names, resolved against the `cd` before them in the same command: arguments that are
// existing files and redirect targets (a new file too, when its folder exists). Heredoc bodies name nothing. → paths.
export function commandFiles(command, cwd = process.cwd()) {
  const out = new Set();
  for (const p of shellRuns(command)) {
    const dir = path.resolve(cwd, String(p.cd || '.').replace(/^["']|["']$/g, '').replace(/^\/([a-z])\//i, '$1:/'));
    const words = [...String(p.text).matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
    for (const w of words.slice(1)) {
      if (!w || /^-|^[<>&|]|=/.test(w)) continue;
      const abs = path.resolve(dir, w);
      try { if (fs.statSync(abs).isFile()) out.add(abs); } catch {}
    }
    for (const m of String(p.text).matchAll(/(?<![0-9&>=-])>{1,2}\s*(?:"([^"]*)"|'([^']*)'|([^\s"'&|;<>]+))/g)) {
      const abs = path.resolve(dir, m[1] ?? m[2] ?? m[3]);
      if (fs.existsSync(path.dirname(abs))) out.add(abs);
    }
  }
  // the files a script run from a heredoc or -e writes (python, node): their names are in its body, which the parts above blank
  for (const f of scriptWriteTargets(command)) { const abs = path.resolve(cwd, f); if (fs.existsSync(path.dirname(abs))) out.add(abs); }
  return [...out];
}

// Other repos a shell command works in: a `cd <dir>` before a part, or `git -C <dir>`; only folders inside a git repo
// other than the session's. → their folders.
export function commandRepos(command, cwd = process.cwd()) {
  const top = (dir) => { const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? norm(r.stdout.trim()) : null; };
  const own = top(cwd), dirs = new Set();
  for (const p of shellRuns(command)) {
    if (p.cd) dirs.add(path.resolve(cwd, String(p.cd).replace(/^["']|["']$/g, '').replace(/^\/([a-z])\//i, '$1:/')));
    const c = String(p.text).match(/\bgit\s+-C\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
    if (c) dirs.add(path.resolve(cwd, c[1] ?? c[2] ?? c[3]));
  }
  return [...dirs].filter((d) => { try { if (!fs.statSync(d).isDirectory()) return false; } catch { return false; } const t = top(d); return t && t !== own; });
}

// The owner department of the task: the last dept-* skill invoked in the session (null: no transcript, or none invoked). The calls are read
// through the agent's own adapter (its rollout, chat or journal as the core's lines): a transcript that is not Claude Code's .jsonl holds no
// Skill call of its own, so reading it raw would find no department and the procedures would never be handed over there.
// The department the task is routed to comes first: the line "Waymark → L<n> · dept-X" of the turn, or a re-route by Skill call with args. A session
// that loaded dept-frontend and now routes a backend task by the line alone owns a backend task, not a frontend one. The line is not in the transcript
// for a second or two after it is written, so until it shows the last department the session invoked stands in (the next edit hands the right one).
function ownerDept(hook, agent) {
  if (!hook.transcript_path) return null;
  try {
    const lines = agent.read(hook, 512 * 1024), turn = currentTurn(lines);
    const routed = routedDept(turn.texts, turn.tools);
    if (routed) return routed;
    const calls = sessionTools(lines).filter((t) => t.name === 'Skill' && /^dept-/.test(String(t.input?.skill || '')));
    return calls.length ? String(calls.at(-1).input.skill) : null;
  } catch { return null; }
}

// Procedures by the hook (docs/adr/0027): at the task's first change the owner department's procedures.md goes in as
// context, once per task and department, so the agent spends no response reading it. The delivery is kept with the packed
// state and the procedure testigo counts it as read; with no hook before the tool the agent reads the file as before.
const procedureText = (dept) => { try { return fs.readFileSync(path.join(SKILLS_DIR, dept, 'procedures.md'), 'utf8'); } catch { return null; } };

export async function packContext(hook, agent, file = PACKED()) {
  const c0 = agent.call(hook), cwd = hook.cwd || process.cwd();
  // a shell command that changes files: the files it names (what it will change is known only after it runs)
  const c = c0?.command !== undefined ? (changesProject(c0.command) ? { files: commandFiles(c0.command, cwd) } : null) : c0;
  const home = projectHome(cwd);
  if (!home.dir || home.legacy) return null; // a project with Waymark's memory
  // Each file's own repo: the session's project, or another repo it edits (a front's session fixing the API). Not
  // Waymark's or engram's memory, and not a folder that is no repo (scratch, temp).
  const root = norm(home.root);
  const repoOf = (abs) => {
    if (norm(abs).startsWith(`${root}/`)) return home.root;
    const h = projectHome(path.dirname(abs));
    return h.dir && !h.legacy && (fs.existsSync(path.join(h.root, '.git')) || fs.existsSync(h.memory)) ? h.root : null;
  };
  const files = (c?.files || []).map((f) => path.resolve(cwd, f)).filter((p) => !/\/\.(waymark|engram)\//.test(norm(p)) && repoOf(p));
  if (!files.length) return null;
  let records = [];
  try { records = readRecords(home.log); } catch {}
  const session = hook.session_id || 'unknown', since = taskStart(records, session);
  const done = packedFiles(session, since, file), fresh = files.filter((f) => !done.has(norm(f)));
  const dept = ownerDept(hook, agent), procsDone = procDelivered(session, since, file);
  const procText = dept && !procsDone.has(dept) ? procedureText(dept) : null;
  if (!fresh.length && !procText) return null;
  const { pack } = await import('./waymark.mjs');
  const byRepo = new Map();
  for (const f of fresh) { const r = repoOf(f); byRepo.set(r, [...(byRepo.get(r) || []), f]); }
  const text = fresh.length ? [...byRepo].map(([r, list]) => pack(r, list)).join('\n') : '';
  const all = readPacked(file);
  for (const [k, v] of Object.entries(all)) if (Date.now() - (v.at || 0) > 7 * 86400000) delete all[k];
  all[session] = { since, at: Date.now(), files: [...done, ...fresh.map(norm)], procs: [...procsDone, ...(procText ? [dept] : [])] };
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(all)); } catch { return null; }
  const memory = fresh.length ? `Waymark memory for the file${fresh.length > 1 ? 's' : ''} you are changing (the project memory, handed over by the hook; earlier tasks there, newest first):\n${text}` : '';
  const procs = procText ? `Waymark procedures of ${dept} (${dept}/procedures.md, handed over by the hook: it counts as read, no need to open the file):\n${procText}` : '';
  return [memory, procs].filter(Boolean).join('\n\n');
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const run = async () => {
    if (done) return;
    done = true;
    try {
      const hook = parseHook(input, agent);
      if (!hook) return; // Claude Code's hook run by Cursor: Cursor's own hook does the work
      const after = /^(PostToolUse|AfterTool)$/.test(hook.hook_event_name || '');
      if (hook.waymark_probe) { process.stdout.write(PROBE_OK); return; } // waymark.mjs check: this hook runs from where it is registered
      // a session with no status line (the desktop app): what it spent so far, so a rise read mid-turn is split with it
      if (agent.name === 'claude') try { recordSpend(hook.session_id, hook.transcript_path); } catch (e) { logHookError('tool-hook spend', e); }
      if (!after) {
        const deny = gate(hook, agent);
        if (deny) { answer(agent, agent.out.deny(deny)); return; }
        // a shell change in another repo: its snapshot before the command runs, so the close sees what it changed there
        const c = agent.call(hook);
        if (c?.command !== undefined && changesProject(c.command)) for (const d of commandRepos(c.command, hook.cwd || process.cwd())) addRepoSnapshot(hook.session_id, d);
      }
      if (after || agent.preContext) {
        // the per-prompt reminder an agent kept for the turn's first tool result (Cursor), then the pack
        const text = [after ? agent.takePrompt?.(hook) : '', await packContext(hook, agent)].filter(Boolean).join('\n\n');
        if (text) { answer(agent, agent.out.context(after ? 'PostToolUse' : 'PreToolUse', text)); return; }
      }
      if (agent.out.pass) answer(agent, agent.out.pass(hook.hook_event_name));
    } catch (e) { logHookError('tool-hook', e); }
  };
  readStdin((text) => { input = text; run(); });
}
