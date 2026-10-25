#!/usr/bin/env node
// Waymark · end-of-turn record and evaluation, the last link of the chain. Registered by install-hooks.mjs as an
// end-of-turn hook (Claude Code: Stop; another agent: same script with `--agent <name>`, docs/adr/0008).
// Runs locally (0 model tokens unless it blocks). Supply chain of the agent's work (docs/adr/0001–0005):
// - What can be observed is COMPUTED from the transcript and git, never declared by the agent (memory, procedure,
//   gates after the last change with time and failure, tests, browser, code-review, docs, branches, time, tokens).
// - The agent writes only `## Cierre · <task ID>`: Resultado · Evidencia · Aprendido. The decision is the user's
//   answer in the choice window, recorded as is with its position (before / after the task's first change).
// - What blocks (once, decision "block") and what is only recorded and scored is defined in ONE place: the catalog of
//   testigos waymark/routine.json (docs/adr/0006, 0012). Each testigo has its claim, the levels and the condition where it
//   applies; this file judges it by executing (tool calls, git, a re-run through testigos.mjs), never by reading prose.
//   The instructions block quotes each block claim (tests check it).
// - Then the record is written with an automatic evaluation (routine ✔/✘, score, tokens, estimated quota): as a git
//   note on the task's commit with a chained stub in <project>/.waymark/provenance.jsonl, or whole in that file when
//   the task has no commit (docs/adr/0007, 0012). The hook writes the task's Work in progress line from the Cierre's
//   Aprendido (≤200 characters), regenerates tasks.md, and the user sees a one-line summary (systemMessage, 0 model
//   tokens). The record names the agent that did the work.
// - A turn routed Q (analysis only, no change) in a project with memory gets a short record {kind: "Q"} with no task ID:
//   it leaves a trace without taking a T<n>, with what it answered and the skills it ran (tasks.md lists the last five).
//   A turn that launched an agent or skill in the background is recorded when its notification ends it.
// It never blocks twice in a row (stop_hook_active). Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import { readStdin } from './lib/stdin.mjs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CIERRE, pendingBackground, subagentUsage, withSubagents, currentTurn, routedLevel, routedDept, inheritedRoute, readTurns, isPrompt, closingQuestions, promptText, sessionTools, readSomething, turnUsage, turnLinks, costByCall, sessionState } from './transcript.mjs';
import { estimate, appendPair } from './calibrate.mjs';
import { takePrecedent, keepPrecedent, usedOf } from './precedent.mjs';
import { measure, clearStart, recordSpend, watched } from './statusline.mjs';
import { agentFrom, parseHook, answer } from './agents/index.mjs';
import { changesProject, shellSkeleton, shellRuns, splitAtChange, copyPaths, inCopy as inCopyCmd, apart as apartCmd } from './runs.mjs';
import { ID, RECORD_V2, v2Fields, pedidoItems, pedidoAnswers, askedGaps, optionsLint, windowCheck, pinnedRules, taskIds, validId, taskLines, taskStart, taskFiles, decisionsIn, appendRecord, turnInputs, commitsFor, saveSnapshot, projectHome, refreshTasks, ensureLocal, closeOpen, readRecords, maskSecrets, recordedDecisions, deepMask, verifyChain, anchorsFor, readNotes, writeTaskLine, readTaskRecords, gitNote, aprendidoOf, turnChanged, markPaused, clearTaskStart, logHookError, gitError, PROBE_OK } from './provenance.mjs';
import { rerunGate, secretSources, secretHits, buildNone } from './testigos.mjs';
import { stackOf, syncIdentity, copyInstall } from './stack.mjs';
import { closeCopies } from './copy.mjs';
import { pushNotes, noteLateCommits, shouldPushNotes, unpushedNotes } from './notes.mjs';
import { autoPushNotes, pushPref } from './notes-remote.mjs';
import { saveLearned, saveQuestion, engramInput } from './engram.mjs';
import { packedFiles, procDelivered } from './lib/packed.mjs';
import { commitSignatures } from './verify.mjs';
import { deniedSince } from './lib/denied.mjs';
import { detectGuarded, guardedLine } from './lib/guard.mjs';
import { expireGrants } from './lib/grants.mjs';
import { loadKnownValues } from './lib/known.mjs';
import { learn } from './learn.mjs';
import { norm, real, exemptPath, repoOf as nearestRepo, nameIn, waymarkHome, WAYMARK_CMD } from './lib/paths.mjs';
import { loadRisk, reviewRisk, editedLines } from './lib/risk.mjs';
import { commentOnlyEdit } from './lib/comments.mjs';

let projectRoot = ''; // the folder the turn's agent works in (cierreGaps sets it), so a checkout under a scratch place still counts
const exempt = (file) => exemptPath(file, projectRoot);
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const UI = /\.(html|css|scss|sass|less|tsx|jsx|vue|svelte|astro)$|\.component\.ts$/i;
const NOT_CODE = /\.(md|mdx|txt|json|ya?ml|toml|ini|env|lock|csv|svg|png|jpe?g|gif|example|sample|dist)$/i; // .env.example, .env.sample, config.dist: placeholders, not code
// An edit that only touches comments owes no gate, spec or build (lib/comments.mjs): not a code change for those testigos.
const codeEdit = (t) => EDITS.test(t.name) && !exempt(fileOf(t)) && !NOT_CODE.test(fileOf(t)) && !commentOnlyEdit(t);
// a test case: it()/test() (it.each, test.only…), RSpec's `it "…"`, Python's def test_, Go's func TestX(
const CASES = /\b(?:it|test)(?:\.\w+)*\s*\(|^\s*it\s+['"]|\bdef test_\w+|\bfunc Test\w+\(/gm;
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$|_spec\.rb$|_test\.(go|py)$|^test_.*\.py$/i;
const MEMORY_FILE = /[\\/]\.waymark[\\/](projects[\\/][^\\/]+\.md|memory\.md)$/i; // <project>/.waymark/memory.md or the pre-0007 ~/.waymark/projects/<slug>.md (tasks.md is generated)
// A command's output that shows a failure, read only when its exit is not the gate's or the test's own (a pipe, a `;`).
// Only the tools' own summary lines, never a count anywhere (a test titled "reports 2 errors" passes); eslint's
// "✖ N problems" counts only with errors in it, since warnings alone exit 0.
const FAIL_OUT = /error TS\d+|error\[E\d+\]|npm ERR!|ELIFECYCLE|Command failed with exit code|^SyntaxError:|Found [1-9]\d* errors?\b|✖ [1-9]\d* problems? \([1-9]\d* errors?|^\s*[1-9]\d* failing\b|ℹ fail [1-9]|Tests?:\s+[1-9]\d* failed|^\s*Tests\s+[1-9]\d* failed|Test Files\s+[1-9]\d* failed|Failed to resolve import|ERR_MODULE_NOT_FOUND|Cannot find module '/im; // vitest prints "Tests  N failed" (two spaces); a spec red because its import does not resolve is a red
const FAIL_LINE = /^\s*(?:FAIL|×)\s+\S/m; // vitest's " FAIL  file > case" and "× case", case-sensitive: a log line "fail to connect" is no test failure
const failOut = (text) => FAIL_OUT.test(text) || FAIL_LINE.test(text);
// The part of a chained command whose own tool printed the failure: tsc's "error TS", eslint's "✖ N problems", a test runner's summary. The exit of a
// line such as `prisma status | tail; eslint x.ts | tail` is no part's, and blaming the whole line sent the agent to the wrong command.
const SIGNATURES = [[/error TS\d+|Found [1-9]\d* errors?\b/, /\b(tsc|vue-tsc|svelte-check|ng|nest)\b/], [/✖ [1-9]\d* problems?/, /\b(eslint|biome|oxlint|stylelint)\b/], [/error\[E\d+\]/, /\bcargo\b/],
  [/^\s*(?:Tests?:?\s+[1-9]\d* failed|Test Files\s+[1-9]|FAIL\s|×\s|[1-9]\d* failing)/m, /\b(vitest|jest|mocha|karma|pytest|rspec|phpunit|ava|tap|test)\b/], [/ℹ fail [1-9]/, /--test\b/]];
export function failingPart(command, out) {
  const parts = shellRuns(command).filter((p) => p.gate || p.test || p.build);
  for (const [seen, prog] of SIGNATURES) if (seen.test(String(out || ''))) { const p = parts.find((x) => prog.test(x.text)); if (p) return p.text; }
  return null;
}
// The catalog of testigos: what blocks and what is recorded and scored (waymark/routine.json, docs/adr/0006, 0012).
// A missing or invalid catalog never disables the hook: a minimal one keeps the chain (decision, gate, Cierre) and
// the record says the catalog could not be read.
const FALLBACK = { fallback: true, testigos: [
  { id: 'decision', label: 'Decision', levels: [1, 2, 3], enforce: 'block' }, { id: 'gate', label: 'Verificar', levels: [1, 2, 3], when: 'code', enforce: 'block' },
  { id: 'cierre', label: 'Cierre', levels: [1, 2, 3], enforce: 'block' }] };
const ROUTINE = (() => { try { const r = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routine.json'), 'utf8')); return Array.isArray(r.testigos) ? r : FALLBACK; } catch { return FALLBACK; } })();
const DOCS = (t) => (t.name === 'Skill' && /library-docs/.test(String(t.input.skill || ''))) || /^(WebFetch|WebSearch)$/.test(t.name) || /context7|docs?/i.test(t.name) || (t.name === 'Read' && /node_modules|\.d\.ts$/.test(String(t.input.file_path || '')));
const fileOf = (t) => t.input.file_path || t.input.notebook_path || '';
const shell = (t) => /^(Bash|PowerShell)$/.test(t.name);
// A relative file name in a shell command resolves against the `cd` before it in the same command, so
// `cd ".../dept-qa" && cat procedures.md` reads dept-qa/procedures.md. → ' <dir>/<file>' for each one, or ''.
export function cdPaths(command) {
  let dir = null;
  const out = [];
  for (const part of String(command || '').split(/&&|\|\||[;|\n]/)) {
    const cd = part.match(/^\s*(?:cd|pushd|Set-Location|sl)\s+(?:\/d\s+|-Path\s+)?["']?([^"'\s]+)["']?\s*$/i);
    if (cd) { dir = cd[1].replace(/[\\/]+$/, ''); continue; }
    if (!dir) continue;
    for (const file of part.match(/(?<![\w./\\:~-])[\w@-][\w./\\@-]*\.[A-Za-z]{1,5}\b/g) || []) out.push(`${dir}/${file}`);
  }
  return out.length ? ` ${out.join(' ')}` : '';
}
const cmdOf = (t) => String(t.input.command || '');
// A gate's command is kept whole: the hook re-runs it and learn.mjs writes it into Quality gates, so a cut one (it once became
// `tsc -p ts`) failed on every later task. Only one over CMD_MAX is cut, and then marked `cut`: never re-run, never learned.
const CMD_MAX = 2000;
// What a test run runs: the files or folders it names, filters (-t, --grep, -k) and flags left out. [] is the whole suite. A later green run that
// covers the same files clears an earlier red (a folder run covers a filtered single-spec run), whatever the text of either command.
const VALUE_FLAGS = /^(-t|--testNamePattern|--grep|-g|-k|-m|-c|--config|--reporter|--project|--shard|-r|--outputFile|--root|--dir|--testTimeout|--pool|--environment)$/;
const TEST_TOOL = /^(vitest|jest|mocha|karma|pytest|rspec|phpunit|ava|tap|test)$|^--test$/;
export function testTargets(command) {
  const out = [];
  for (const p of shellRuns(command)) {
    if (!p.test) continue;
    const w = [...String(p.text).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]), at = w.findIndex((x) => TEST_TOOL.test(path.basename(x)));
    for (let i = at + 1; at >= 0 && i < w.length; i++) {
      const x = w[i];
      if (VALUE_FLAGS.test(x)) i++;
      else if (!x.startsWith('-') && !/^(run|watch|test|--)$/.test(x) && !/[=]/.test(x)) out.push(x.replace(/\\/g, '/').replace(/::.*$/, '').replace(/^\.\//, '').replace(/\/+$/, ''));
    }
  }
  return [...new Set(out)];
}
export const testCovers = (later, earlier) => !later.length || (earlier.length > 0 && earlier.every((f) => later.some((r) => f === r || f.startsWith(`${r}/`))));
// An edit that only re-exports (a barrel: `export * from './x'`): no behavior, so no spec has to fail before it.
export const isBarrel = (t) => {
  const s = String(t.input?.content ?? t.input?.new_string ?? '');
  return s.trim() !== '' && s.split('\n').every((l) => !l.trim() || /^\s*(\/\/.*|\/\*.*\*\/|export\s+(\*(\s+as\s+\w+)?|type\s+\{[^}]*\}|\{[^}]*\})\s+from\s+['"][^'"]+['"];?)\s*$/.test(l));
};
// A stylesheet, or a template whose edits touch no binding or logic: no spec can see what it changes (jsdom does not compute layout).
const BINDING = /\{\{|\*ng\w|@(?:if|for|switch|defer)\b|\(\w+\)\s*=|\[\(?\w[\w.-]*\)?\]\s*=|\bv-(?:if|for|on|bind|model)|\bonclick=|\bhx-/;
export const styleOnly = (file, tools) => /\.(css|scss|sass|less)$/i.test(file) || (/\.html?$/i.test(file) && !tools.some((t) => EDITS.test(t.name) && norm(fileOf(t)) === norm(file) && BINDING.test(String(t.input?.new_string ?? t.input?.content ?? (t.input?.edits || []).map((e) => e.new_string).join('\n')))));
export const keepCmd = (c) => { const s = String(c).replace(/\s+/g, ' ').trim(); return s.length > CMD_MAX ? { cmd: s.slice(0, CMD_MAX), cut: true } : { cmd: s }; };

// The commits this turn made with a task's ID, in every repo it committed in: the session's, and the one a commit
// command entered (`cd <repo> && git commit`, `git -C <repo> commit`). The ID may be the Cierre's, or an earlier
// recorded task's (its work committed now); it is read anywhere in the message, not only in the last paragraph.
// → the commit hashes (the trailer testigo).
export function turnCommits(tools, cwd, claimed, ids, since = 0) {
  const ok = (id) => id === claimed || id === ids?.next || !!ids?.known?.has(id);
  return [...new Set(commitsSince(new Set([path.resolve(cwd), ...commitRepos(tools, cwd)]), since)
    .filter((c) => trailerIds(c.msg).some(ok)).map((c) => c.h))];
}
// The Waymark-Task trailer as git reads it: a line of the message's last paragraph (git does not call a line in the middle of the message a trailer,
// so `git log --format=%(trailers)` and every tool that follows it never saw one written there). → the IDs it names.
export function trailerIds(message) {
  const paragraphs = String(message || '').replace(/\r\n/g, '\n').trimEnd().split(/\n[ \t]*\n/);
  return [...(paragraphs[paragraphs.length - 1] || '').matchAll(/^\s*Waymark-Task:\s*(.+?)\s*$/gim)].map((m) => m[1]);
}
// The git commands `verb` (commit, push) of the tools and the folder each ran in: the session's, a `cd <repo> &&` before
// it, or `git -C <repo>`. → [{ dir, part, t }] (part: the command's own piece of the line)
function gitRuns(tools, cwd, verb) {
  const out = [], has = new RegExp(`\\bgit\\b[\\s\\S]*\\s${verb}\\b`), here = new RegExp(`\\bgit\\b[^|;&]*\\s${verb}\\b`), atC = new RegExp(`\\bgit\\s+-C\\s+["']?([^"'\\s]+)["']?[^|;&]*\\s${verb}\\b`);
  for (const t of tools.filter((x) => shell(x) && has.test(cmdOf(x)))) {
    let dir = null;
    for (const part of bare(t).split(/&&|\|\||[;|\n]/)) {
      const cd = part.match(/^\s*(?:cd|pushd|Set-Location|sl)\s+(?:\/d\s+|-Path\s+)?["']?([^"']+?)["']?\s*$/i);
      if (cd) { dir = cd[1]; continue; }
      const c = part.match(atC);
      if (c) out.push({ dir: path.resolve(cwd, c[1]), part, t });
      else if (here.test(part)) out.push({ dir: path.resolve(cwd, (dir || '.').replace(/^\/([a-z])\//i, '$1:/')), part, t });
    }
  }
  return out;
}
// The repos the turn's commit commands ran in.
const commitRepos = (tools, cwd) => new Set(gitRuns(tools, cwd, 'commit').map((r) => r.dir));
const gitRoot = (dir) => { const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', timeout: 5000 }); return r.status === 0 ? r.stdout.trim() : null; };
// one folder however it is spelled: git's long name, an 8.3 short name or a link (lib/paths real)
const sameDir = (a, b) => norm(real(a)) === norm(real(b));

// The other repos the task committed in with its ID (its tool calls' `cd <repo> && git commit`, `git -C <repo> commit`).
// → [{ root, commits }] (commits newest first), the session's repo left out.
export function taskRepos(tools, cwd, root, id) {
  const out = [];
  for (const dir of commitRepos(tools, cwd)) {
    const top = fs.existsSync(dir) && gitRoot(dir);
    if (!top || sameDir(top, root) || out.some((r) => sameDir(r.root, top))) continue;
    const commits = commitsFor(top, id);
    if (commits.length) out.push({ root: top, commits });
  }
  return out;
}

// The repos the turn pushed to (a push that did not fail, not of the notes refs themselves) and the remote each named.
// → [{ root, remote }]
export function pushedRepos(tools, results, cwd) {
  const out = [];
  for (const { dir, part, t } of gitRuns(tools, cwd, 'push')) {
    if (results?.[t.id]?.error || /refs\/notes/.test(cmdOf(t))) continue;
    const top = fs.existsSync(dir) && gitRoot(dir);
    // the first word after `push` that is no flag (`--tags`, `-u`), when it names a remote and not a refspec
    const word = part.slice(part.search(/\bpush\b/) + 4).trim().split(/\s+/).find((w) => w && !w.startsWith('-'));
    const remote = word && /^[\w.-]+$/.test(word) ? word : 'origin';
    if (top && !out.some((r) => sameDir(r.root, top) && r.remote === remote)) out.push({ root: top, remote });
  }
  return out;
}

// Notes the hook could not push (testigo "notes", judged after the record: the push follows it). The close blocks once
// per record and keeps the repos here; the next stop checks them against the tracking refs, without network.
const NOTES_PENDING = () => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), '.notes-pending.json');
const readPending = () => { try { return JSON.parse(fs.readFileSync(NOTES_PENDING(), 'utf8')) || {}; } catch { return {}; } };
const writePending = (all) => { try { fs.mkdirSync(path.dirname(NOTES_PENDING()), { recursive: true }); fs.writeFileSync(NOTES_PENDING(), JSON.stringify(all)); } catch {} };
export function notesBlock(failed, waymark = path.join(path.dirname(fileURLToPath(import.meta.url)), 'waymark.mjs')) {
  const cmd = (f) => `cd "${f.root}" && node "${waymark.replace(/\\/g, '/')}" notes push${f.remote === 'origin' ? '' : ` ${f.remote}`}`;
  return `Waymark: the task's record is written, but the hook could not push its git notes (${failed[0].output}); the hook's process may not have your git credentials. Run from your shell, in each repo: ${failed.map(cmd).join(' ; ')}. Then say in one line whether they went up; do not repeat the Cierre.`;
}
// → the line for the user once the agent ran the push, or '' with nothing pending for the session.
export function notesChecked(session) {
  const all = readPending(), pending = all[session];
  if (!pending) return '';
  delete all[session];
  writePending(all);
  const left = pending.repos.filter((r) => unpushedNotes(r.root, r.remote) !== 0);
  return left.length ? `Waymark ${pending.id} · las notas siguen sin subir en ${left.map((r) => `${path.basename(r.root)} (${r.remote})`).join(', ')}: ${WAYMARK_CMD} notes push desde tu shell`
    : `Waymark ${pending.id} · notas de waymark ya en ${[...new Set(pending.repos.map((r) => r.remote))].join(', ')} (${pending.repos.map((r) => path.basename(r.root)).join(', ')})`;
}
// → [{ h, dir, msg }] committed in those repos since the turn started (a minute of slack); mine: only by the repo's git
// user (commits a pull or rebase brought in keep their own committer).
function commitsSince(dirs, since, mine = false) {
  const out = [];
  for (const dir of dirs) {
    const me = mine && spawnSync('git', ['config', 'user.email'], { cwd: dir, encoding: 'utf8', timeout: 5000 }).stdout?.trim().toLowerCase();
    const r = spawnSync('git', ['log', '-30', `--since=@${Math.floor((since - 60000) / 1000)}`, '--format=%H%x1f%ce%x1f%B%x1e'], { cwd: dir, encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) continue;
    for (const [h, ce, msg] of r.stdout.split('\x1e').map((c) => c.replace(/^\s+/, '').split('\x1f'))) if (h && (!me || String(ce).toLowerCase() === me)) out.push({ h, dir, msg: msg || '' });
  }
  return out;
}
// Every commit the turn made, with or without a trailer and in any repo it committed in (the testigo "sin secretos").
// → [{ h, dir }]
export function turnCommitsAll(tools, cwd, since = 0) {
  const seen = new Set();
  return commitsSince(commitRepos(tools, cwd), since, true).filter((c) => !seen.has(c.h) && seen.add(c.h)).map(({ h, dir }) => ({ h, dir }));
}
// The command as the shell runs it: heredoc bodies and here-strings blanked, so a spec written through `cat > x.spec.ts <<'EOF'`
// is not a test or gate run.
const bare = (t) => shellSkeleton(cmdOf(t), { quotes: false });
// A follow-up ID (with a letter) holds only when the turn changes a file its task already changed, so an unrelated task
// never inherits another task's answers. Not checked without records or without changes.
const followUpShares = (id, changed, ctx) => !/[a-z]$/.test(id) || !ctx.taskFiles || !changed.length || (() => { const own = ctx.taskFiles(id); return changed.some((f) => own.has(norm(f))); })();
const skillCalled = (tools, re) => tools.some((t) => t.name === 'Skill' && re.test(String(t.input.skill || '')));
// Variables assigned in the same command, in place: `W=…/waymark.mjs; node $W review a.ts` (sh) or `$W = "…"; node $W …`
// (PowerShell) reads as `node …/waymark.mjs review a.ts`. A variable not assigned there stays as written.
export function expandVars(command) {
  const vars = {};
  for (const m of String(command).matchAll(/(?:^|[;&|\s])\$?([A-Za-z_]\w*)\s*=\s*("[^"]*"|'[^']*'|[^\s;&|]+)/g)) vars[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  return String(command).replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)(?!\s*=)/g, (all, a, b) => vars[a || b] ?? all);
}
const waymarkCmd = (t, sub) => shell(t) && new RegExp(`waymark\\.mjs["']?\\s+(?:${sub})\\b`).test(expandVars(cmdOf(t)));
// The review: the code-review skill, or `waymark.mjs review <files>` where the agent has none (Codex, Gemini CLI, OpenCode).
// It counts when it ran without error after the first code change of those calls and covers the changed code: code-review
// reads the whole diff, `waymark.mjs review` must name every changed code file: every call counts, also several in one
// command (one repo after another: `… review <api files>; cd ../web && … review <front files>`); a redirect such as
// `2>&1` is not a file. Applying its findings afterwards needs no second review. Returns the code files left unreviewed.
function unreviewed(tools, codeFiles, failed = (t) => !!t.error) {
  const first = tools.findIndex((t) => (!failed(t) && codeEdit(t)) || (shell(t) && changesProject(t.input.command)));
  const after = tools.slice(first + 1).filter((t) => !failed(t));
  if (skillCalled(after, /(^|:)code-review$/)) return [];
  const named = after.filter(shell).flatMap((t) => [...expandVars(cmdOf(t)).matchAll(/waymark\.mjs["']?\s+review\s+([^\n;&|]+)/g)]
    .flatMap((m) => m[1].match(/"[^"]*"|'[^']*'|\S+/g) || []).filter((a) => !/^\d*>/.test(a)).map((a) => a.replace(/^["']|["']$/g, '')));
  const covers = (f) => (SPEC.test(path.basename(f)) && named.length > 0) || named.some((a) => { const x = norm(a).replace(/^\.\//, ''); return norm(f) === x || norm(f).endsWith(`/${x}`); });
  return codeFiles.filter((f) => !covers(f));
}
// The repo that holds a folder on disk (its git top level), or null; cached per close.
const repos = new Map();
function repoOf(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  if (!repos.has(norm(dir))) { const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', timeout: 5000 }); repos.set(norm(dir), r.status === 0 ? norm(r.stdout.trim()) : null); }
  return repos.get(norm(dir));
}
// A Git Bash path (/c/Users/…) as Windows reads it; others unchanged.
const winPath = (p) => (process.platform === 'win32' ? String(p).replace(/^\/([a-z])\//i, '$1:/') : String(p));

export { sessionTools }; // moved to transcript.mjs (shared with tool-hook.mjs); kept here for existing importers

function specsNear(files) {
  for (const f of files) {
    const dir = path.dirname(f);
    try {
      const names = fs.readdirSync(dir);
      const hit = names.find((n) => SPEC.test(n)) || (names.includes('__tests__') ? '__tests__' : null);
      if (hit) return path.join(dir, hit).replace(/\\/g, '/');
    } catch {}
  }
  return null;
}

// memory.md modified at or after the turn started and holding the task ID (written by whatever tool).
function memoryHolds(file, since, id) {
  if (!file || !id) return false;
  try { return fs.statSync(file).mtimeMs >= (since || 0) - 1000 && fs.readFileSync(file, 'utf8').includes(id); } catch { return false; }
}

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// "<Field>: omitido (usuario: "<words>")": at least 3 words (or 12 characters), which are in the user's messages or are a
// whole option they picked (a fragment of the option that accepted the check, e.g. "navegador", does not count).
// → 'ok', null (no skip line) or { quote, short? }.
function userSkip(reply, field, prompts, labels = []) {
  const m = reply.match(new RegExp(`${field}:\\s*omitido \\(usuario:\\s*[“"«]([^”"»]{3,200})[”"»]`, 'i'));
  if (!m) return null;
  const q = plain(m[1]);
  if (labels.some((l) => l === q || l.replace(/\s*\(recomendad[oa]\)$/, '') === q)) return 'ok'; // a whole option they picked
  if (q.split(' ').length < 3 && q.length < 12) return { quote: m[1], short: true };
  return prompts.some((p) => plain(p).includes(q)) ? 'ok' : { quote: m[1] };
}
// A Cierre field: its line; a value that ends with ":" continues on the next lines up to the next field ("Evidencia:"
// with what was seen below it). An empty field never takes the next line. Decisión and Sub-decisiones are not read but
// still end a field an older Cierre spreads over several lines.
const FIELD = /^\s*(?:[-*]\s*)?(?:Resultado|Decisi[oó]n|Sub-?decisiones|Evidencia|Aprendido|Pedido|Tests|Review|Build|Secretos)\s*:/i;
const field = (reply, name) => {
  const m = reply.match(new RegExp(`${name}:[ \\t]*([^\\n]*)`, 'i'));
  let v = m?.[1]?.trim() || '';
  if (!/:$/.test(v)) return v;
  for (const line of reply.slice(m.index + m[0].length).split('\n').slice(1)) {
    if (!line.trim() || FIELD.test(line) || /^\s*#/.test(line)) break;
    v += ' ' + line.trim();
  }
  return v;
};

// The block reason, or null. ctx: { ids, decisions, gitChanged, commits, branches, lacks, agent } (all optional).
export function checkCierre(turn, last, allTools = turn.tools, prompts = [turn.prompt], ctx = {}) {
  return blockReason(cierreGaps(turn, last, allTools, prompts, ctx));
}
// From gaps already computed (the hook never judges twice: the gate testigo may have re-run the typecheck).
export function blockReason(gaps) {
  if (!gaps?.missing.length) return null;
  // One Cierre per task: with one already written the agent does what is missing and says so in a line or two; a
  // field that changes goes as that line alone. Only a turn with no Cierre at all is asked for one.
  const noCierre = gaps.missing.some((m) => m.startsWith('the "## Cierre'));
  const then = noCierre ? 'then reply with the Cierre.' : 'then reply in one or two lines with what you did. Do not repeat the Cierre: the hook keeps the one you wrote; a field that changes goes as that one line (e.g. "Resultado: parcial (…)").';
  return `Waymark: this L${gaps.level} ${gaps.changed?.length ? 'turn changed files' : 'task (no project file changed)'} and is missing: ${gaps.missing.map((m, i) => `${i + 1}) ${m}`).join(' ')}. Do what is missing (or correct the field), ${then}`;
}

// The reply the hook judges: the last one when it holds the Cierre; after a block, the Cierre written earlier in the
// turn with the field lines the last reply corrected (Resultado, Evidencia, Aprendido), then the rest of that reply
// (an exception such as "no comprobado (…)" or "Tests: no (…)" still counts). → text.
const CIERRE_HEAD = /^[ \t]*##\s*Cierre\s*·/m;
const FIELDS = ['Resultado', 'Evidencia', 'Aprendido'];
export function effectiveReply(texts = [], last = '') {
  const plain = (s) => String(s || '').replace(/\*\*|__/g, '');
  const fieldLine = (s, f) => s.match(new RegExp(`^[ \\t]*${f}:[^\\n]*`, 'm'))?.[0];
  if (CIERRE_HEAD.test(plain(last))) {
    // a corrected heading ("## Cierre · <the right ID>" and nothing else, as the hook's own message asks) inherits the fields of the Cierre it corrects
    if (FIELDS.some((f) => fieldLine(plain(last), f))) return last;
    const corrected = [...texts].reverse().find((t) => t !== last && CIERRE_HEAD.test(plain(t)) && FIELDS.every((f) => fieldLine(plain(t), f)));
    if (!corrected) return last;
    const heading = plain(last).match(/^[ \t]*##\s*Cierre\s*·[^\n]*/m)[0];
    return plain(corrected).replace(/^[ \t]*##\s*Cierre\s*·[^\n]*/m, heading.trim());
  }
  const earlier = [...texts].reverse().find((t) => CIERRE_HEAD.test(plain(t)));
  if (!earlier) return last;
  let cierre = plain(earlier), rest = plain(last);
  for (const f of FIELDS) {
    const line = rest.match(new RegExp(`^[ \\t]*${f}:[^\\n]*`, 'm'))?.[0];
    if (!line) continue;
    cierre = new RegExp(`^[ \\t]*${f}:[^\\n]*`, 'm').test(cierre) ? cierre.replace(new RegExp(`^[ \\t]*${f}:[^\\n]*`, 'm'), line.trim()) : `${cierre.trimEnd()}\n${line.trim()}`;
    rest = rest.replace(line, '');
  }
  return rest.trim() ? `${cierre.trimEnd()}\n\n${rest.trim()}` : cierre;
}

// A message that asks for nothing, and a call that acts (a shell command that is not the routine's own or a plain read, or a connector).
const COURTESY = /^\s*(?:gracias|muchas gracias|thanks|thank you|ok|vale|perfecto|genial|listo|excelente|buen[oa]s?(?: d[ií]as| tardes| noches)?|hola|entendido|de acuerdo)\b[^\n?]{0,40}$/i;
const READ_ONLY = /^\s*(?:node\s+\S*waymark\.mjs|git\s+(?:status|log|diff|show|branch|rev-parse)\b|ls|cat|pwd|echo|dir|type|which|grep|rg|find|head|tail|wc)\b/;
const acting = (t) => (shell(t) && String(cmdOf(t)).split(/&&|\|\||;|\|/).some((p) => p.trim() && !READ_ONLY.test(p))) || (/^mcp__/.test(t.name) && !/^mcp__(?:engram|context7|ccd_[a-z]+)__/.test(t.name));


// The other projects a task changed files in: one short record each (kind "touched", no ID of its own: it is no task
// there, so that project's counter never moves), so its tasks.md says who changed its files and under which task. A repo
// the task committed in (rec.repos) already has the task as a git note.
export function touchedRepos(files, root, rec, slug) {
  const out = [];
  for (const dir of [...new Set(files.map((f) => path.dirname(f)))]) {
    const top = fs.existsSync(dir) && gitRoot(dir);
    if (!top || sameDir(top, root) || out.some((r) => sameDir(r.root, top)) || (rec.repos || []).some((r) => sameDir(r.root, top)) || !fs.existsSync(projectHome(top).memory)) continue;
    const mine = files.filter((f) => !path.relative(top, f).startsWith('..') && !path.isAbsolute(path.relative(top, f))).map((f) => path.relative(top, f).replace(/\\/g, '/'));
    out.push({ root: top, record: { kind: 'touched', task: rec.id, from: slug, agent: rec.agent || null, at: rec.at, session: rec.session, cwd: top, files: mine.slice(0, 30), ...(aprendidoOf(rec.cierre || '') ? { learned: aprendidoOf(rec.cierre).slice(0, 300) } : {}) } });
  }
  return out;
}

// The repos the Pedido names ("Repos: a, b"), lower-cased, from the turn's texts; and the repos a task changed that neither it nor the user's
// answers in the window name (docs/adr/0046). Files inside the session's own repo are never judged.
export const namedRepos = (texts) => [...String(texts.join('\n')).replace(/\*\*|__/g, '').matchAll(/(?:^|·)[ \t]*(?:[-*]\s*)?Repos?:[ \t]*([^\n·]+)/gim)].flatMap((m) => m[1].split(/[,;]|\sy\s|\sand\s/)).map((s) => s.trim().toLowerCase()).filter(Boolean);
export function reposNotNamed(changed, root, named, answers = '') {
  const out = new Set();
  for (const f of changed || []) {
    const top = nearestRepo(f);
    if (!top || (root && sameDir(top, root))) continue;
    const name = path.basename(top);
    if (!nameIn(name, named.join('\n')) && !nameIn(name, answers)) out.add(name);
  }
  return [...out];
}

// A reply that pauses the task: no Cierre, and it ends asking the user with options (transcript.mjs closingQuestions).
export const pausedReply = (reply) => !CIERRE_HEAD.test(String(reply || '').replace(/\*\*|__/g, '')) && closingQuestions(reply).length > 0;

// The facts an Evidencia cites: `backticks`, and outside them 84/84, exit 0, a commit or blob hash. A chain of three or
// more numbers (29/86/326/15/1: counts, a date) is not a pass/total.
export function evidenceFacts(text) {
  // what the user is told to check for themselves ("(check: …)") is no claim of the agent
  const s = String(text || '').replace(/\(\s*check:[^)\n]*\)/gi, ' ').replace(/\bcheck:[^\n]*/gi, ' '), out = [...s.matchAll(/`([^`\n]{2,160})`/g)].map((m) => m[1].trim());
  for (const m of s.replace(/`[^`\n]*`/g, ' ').matchAll(/\b(?<!\/)\d+\/\d+\b(?!\/)|\bexit(?: code)? \d+\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/gi)) out.push(m[0]);
  return [...new Set(out)];
}

// The turn, observed: what the agent ran and changed, the gates, the files. Computed, never declared.
function observeTurn(S) {
  const { allTools, changed, ctx, denied, reply, turn } = S;

  // ---- Observed (computed, never declared) ----
  const where = (t) => `${t.input.file_path || ''} ${t.input.path || ''} ${t.input.pattern || ''} ${t.input.command || ''}${shell(t) ? cdPaths(t.input.command) : ''}`;
  const base = allTools.length - turn.tools.filter((t) => !t.input.slash).length;
  const gitCode = (ctx.gitChanged || []).some((f) => !exempt(f) && !NOT_CODE.test(f)); // a shell command changed code only if git saw it
  const shellChange = (t) => shell(t) && changesProject(t.input.command) && gitCode;
  const isChange = (t) => (EDITS.test(t.name) && !exempt(fileOf(t))) || shellChange(t);
  const firstChange = allTools.findIndex((t, i) => i >= base && isChange(t));
  const before = (pred) => allTools.some((t, i) => pred(t) && (firstChange < 0 || i < firstChange));
  // The owner is a department the agent invoked, not one its text only names: a re-route call (args "L<n>") wins, then
  // the first dept-* invoked in this turn, then the routing line's department when it was invoked earlier in the session
  // (a department loads once per session, docs/adr/0015), then the last one of the session, then the open task's.
  // Earlier in the session = these lines or this session's earlier records (ctx.sessionDepts).
  const deptCalls = (tools) => tools.filter((t) => t.name === 'Skill' && /^dept-/.test(String(t.input.skill || ''))).map((t) => String(t.input.skill));
  const rerouted = turn.tools.filter((t) => t.name === 'Skill' && /^dept-/.test(String(t.input.skill || '')) && /^\s*L[0-3]\b/i.test(String(t.input.args || ''))).pop();
  const invoked = [...new Set([...(ctx.sessionDepts || []), ...deptCalls(allTools)])];
  const lineDept = routedDept(turn.texts, turn.tools);
  const dept = { declared: (rerouted && String(rerouted.input.skill)) || deptCalls(turn.tools)[0] || (invoked.includes(lineDept) ? lineDept : null) || deptCalls(allTools).pop() || ctx.inherited?.dept || null, invoked };
  const procRe = dept.declared ? new RegExp(`${dept.declared}[\\\\/]procedures\\.md`) : /procedures\.md/;
  const procReads = allTools.filter((t) => /procedures\.md/.test(where(t)) && readSomething(t));
  const lastIdx = (pred) => { for (let i = turn.tools.length - 1; i >= 0; i--) if (pred(turn.tools[i])) return i; return -1; };
  const lastCode = lastIdx((t) => codeEdit(t) || shellChange(t));
  const lastSpec = lastIdx((t) => EDITS.test(t.name) && SPEC.test(path.basename(fileOf(t))));
  const lastChange = lastIdx(isChange);
  const result = (t) => turn.results?.[t.id];
  // the procedure counts as read first only before the first change that happened (an edit the gate denied changed nothing)
  const firstRealChange = allTools.findIndex((t, i) => i >= base && isChange(t) && !(result(t)?.error || t.error));
  // the hook hands the owner's procedures.md at the first change (tool-hook.mjs): a delivery is a read, and it came before the change
  const procHanded = !!dept.declared && (ctx.procDelivered || []).includes(dept.declared);
  const procBeforeChange = procHanded || allTools.some((t, i) => procRe.test(where(t)) && readSomething(t) && (firstRealChange < 0 || i < firstRealChange));
  const secs = (t) => (result(t)?.at && t.at ? Math.max(0, (result(t).at - t.at) / 1000) : null);
  // Each part of a chained command (&&, ;, |) is judged alone, by its executable (provenance.mjs shellRuns): "npx tsc
  // --noEmit && grep T1 .waymark/memory.md" is a gate, `git commit -m "fix build"` is none. A part that writes Waymark's
  // own memory, or runs after a `cd` into a .waymark folder, is no gate even when its text says "build" or "tests".
  const parsed = new Map(), runsAll = (t) => { const c = cmdOf(t); if (!parsed.has(c)) parsed.set(c, shellRuns(c)); return parsed.get(c); }; // each command parsed once
  const runsOf = (t) => (shell(t) ? runsAll(t).filter((p) => !/\.waymark([\\/]|$)/.test(String(p.cd || '').replace(/["']/g, '')) && !/\.waymark[\\/]/.test(p.text)) : []);
  const gateCmd = (t) => runsOf(t).some((p) => p.gate);
  const testCmd = (t) => runsOf(t).some((p) => p.test);
  const output = (t) => String(result(t)?.text || t.out || '');
  // The exit of a shell call belongs to its last part of a kind when only '&&' follows it (a 0 exit passed it) or when it
  // is the last part (a non-0 exit is its own). → true (passed) / false (failed) / null (another part's exit: a pipe, a
  // `;`), and then a failure in its output decides.
  const exitFor = (t, kind) => {
    const all = runsAll(t), i = all.map((p) => p[kind]).lastIndexOf(true);
    if (i < 0) return null;
    return result(t)?.error || t.error ? (i === all.length - 1 ? false : null) : all.slice(i, -1).every((p) => p.sep === '&&') ? true : null;
  };
  const failedRun = (t, kind) => { const own = exitFor(t, kind); return own === false || (own === null && failOut(output(t))); };
  // The clean copies (git worktree) the task made, and the calls that run in one (runs.mjs): a run there shows a failure is
  // not this task's, or a spec red first; it is never the task's gate.
  const copies = copyPaths(allTools.filter(shell).map(cmdOf));
  const inCopy = (t) => shell(t) && inCopyCmd(cmdOf(t), copies);
  // Also apart: a gate or test run from a temp folder or from a place the hook cannot tell (runs.mjs): recorded, never held
  // against the task (an open failure: only evidence the hook can read counts).
  const apart = (t) => shell(t) && apartCmd(cmdOf(t), copies);
  // Test-first, per spec: a spec that adds cases (a new spec, or a new it()/test() in one) runs before the next code edit
  // after it was written; with code changed before it, that run must fail. A spec that only adjusts setup or mocks (a
  // refactor) only has to pass. A spec the shell wrote (cat > x.spec.ts <<EOF … && npm test) counts as written there.
  // Config, scaffolding made by commands (`ng new`, installs) and the spec itself are not the code it tests.
  const specEditable = (t) => !denied(t) && codeEdit(t) && !SPEC.test(path.basename(fileOf(t))) && !isBarrel(t); // a barrel is no behavior: no spec fails before it
  const cases = (s) => (String(s || '').match(CASES) || []).length;
  const shellSpecs = (t) => (shell(t) ? [...cmdOf(t).matchAll(/(?:>>?|\btee(?:\s+-a)?)\s*["']?([^\s"'<>|;&]+)/g)].map((m) => m[1]).filter((f) => SPEC.test(path.basename(f))) : []);
  const specWrites = new Map(); // spec basename → { at: first write, adds: cases added }
  let casesRemoved = 0; // cases an edit took out of a spec: a spec that only moved them adds nothing new
  allTools.forEach((t, i) => {
    if (i < base || denied(t)) return;
    const add = (f, n) => { const k = path.basename(f).toLowerCase(), w = specWrites.get(k) || { at: i, adds: 0 }; w.adds += n; specWrites.set(k, w); };
    if (EDITS.test(t.name) && SPEC.test(path.basename(fileOf(t)))) {
      const inp = t.input || {}; // a new file, or an edit whose text is unknown, counts as adding cases
      casesRemoved += (inp.edits || [inp]).reduce((n, e) => n + (e.old_string === undefined ? 0 : Math.max(0, cases(e.old_string) - cases(e.new_string))), 0);
      add(fileOf(t), t.name === 'Write' ? cases(inp.content) || 1 : (inp.edits || [inp]).reduce((n, e) => n + (e.new_string === undefined ? 1 : Math.max(0, cases(e.new_string) - cases(e.old_string))), 0));
    } else for (const f of shellSpecs(t)) add(f, cases(cmdOf(t)) || 1);
  });
  const ranRed = (w) => {
    const next = allTools.findIndex((t, i) => i > w.at && specEditable(t)), codeFirst = allTools.some((t, i) => i >= base && i < w.at && specEditable(t));
    return allTools.some((t, i) => i >= w.at && testCmd(t) && (next < 0 || i < next) && (!codeFirst || failedRun(t, 'test')));
  };
  const inWorktree = allTools.some((t, i) => i >= base && testCmd(t) && inCopy(t));
  // red-first is for new behavior: not for a spec that only moved its cases, nor for one an earlier turn of the task already changed
  const earlierSpecs = new Set((ctx.taskTools || []).filter((t) => !turn.tools.some((x) => x.id === t.id) && EDITS.test(t.name) && SPEC.test(path.basename(fileOf(t)))).map((t) => path.basename(fileOf(t)).toLowerCase()));
  const movedOnly = casesRemoved > 0 && [...specWrites.values()].reduce((n, w) => n + w.adds, 0) <= casesRemoved;
  const notRed = inWorktree || movedOnly ? [] : [...new Set(changed.filter((f) => SPEC.test(path.basename(f))).map((f) => path.basename(f)))]
    .filter((b) => { const w = specWrites.get(b.toLowerCase()); return !earlierSpecs.has(b.toLowerCase()) && (!w || (w.adds > 0 && !ranRed(w))); });
  // A failure of the environment (the command is not found), not of the code: no attempt, no failed gate.
  // A run that never happened: the tool is not installed, or the command was refused (a permission denied, a hook that stopped it).
  const envFail = (t) => /is not recognized as an internal or external command|command not found|not recognized as the name of a cmdlet|spawn \S+ ENOENT|permission to use .{1,40} (?:has been )?denied|doesn't want to proceed|hook error:|not allowed in this sandboxed run/i.test(String(result(t)?.text || t.out || ''));
  // Docs: the same gate or test failing twice is retried only after consulting the docs (a docs call after the second
  // failure, before the next run of that command); retrying blind is how a wrong direction repeats.
  const cmdKey = (t) => cmdOf(t).replace(/\s+/g, ' ').trim();
  // An attempt is a run after a code change since the previous run of the same command; a first red run of a new spec,
  // a rerun with nothing changed and a failure of the environment are no failed attempts.
  const failedRuns = new Map(), lastRun = new Map();
  turn.tools.forEach((t, i) => {
    if (!runsOf(t).some((p) => p.gate || p.test)) return;
    const key = cmdKey(t), from = lastRun.has(key) ? lastRun.get(key) : -1;
    lastRun.set(key, i);
    const attempt = turn.tools.slice(from + 1, i).some((x) => specEditable(x) || shellChange(x));
    if (attempt && result(t)?.error && !envFail(t)) failedRuns.set(key, [...(failedRuns.get(key) || []), i]);
  });
  const retried = [...failedRuns].filter(([, at]) => at.length >= 2).map(([cmd, at]) => {
    const next = turn.tools.findIndex((t, i) => i > at[1] && shell(t) && cmdKey(t) === cmd);
    return { cmd, docs: turn.tools.some((t, i) => i > at[1] && (next < 0 || i < next) && DOCS(t)), late: next >= 0 };
  });
  const gatesAfter = turn.tools.slice(Math.max(lastChange, lastCode) + 1).filter((t) => runsOf(t).some((p) => p.gate || p.test));
  // UI: templates and styles, `.component.ts`, and a `.ts` with a sibling `.html` (Angular 20+ names drop the suffix)
  const ui = changed.some((f) => UI.test(f) || (/\.ts$/i.test(f) && !SPEC.test(path.basename(f)) && fs.existsSync(f.replace(/\.ts$/i, '.html'))));
  // a file touched only by comment-only edits (and by no shell change) is no code for the gate, the spec and the build
  const touched = new Map();
  for (const t of turn.tools) if (EDITS.test(t.name) && !exempt(fileOf(t))) touched.set(norm(fileOf(t)), (touched.get(norm(fileOf(t))) ?? true) && commentOnlyEdit(t));
  const shellTouched = turn.tools.some((t) => shell(t) && changesProject(t.input.command));
  const code = changed.filter((f) => !NOT_CODE.test(f) && !(touched.get(norm(f)) === true && !shellTouched));
  // the code files no review covered, in this turn or earlier in the same task (a follow-up that applies the review's
  // findings needs no second review)
  const turnLeft = unreviewed(turn.tools, code, (t) => !!(result(t)?.error || t.error));
  const taskLeft = turnLeft.length ? unreviewed(ctx.taskTools || [], code) : [];
  const reviewLeft = turnLeft.filter((f) => taskLeft.includes(f));
  // "build | none" holds for the project that declares it: code changed in another repo still needs its build
  const noBuild = !!ctx.noBuild && (!ctx.root || code.every((f) => norm(f).startsWith(norm(ctx.root).replace(/\/$/, '') + '/')));
  // The choice window waiting for the user is the user's time, not the agent's (a question left open overnight would
  // make a 2-minute turn read hours): kept apart as userWait, out of minutes and the slowest step.
  const ASK = (t) => t.name === 'AskUserQuestion';
  const timed = turn.tools.filter((t) => secs(t) !== null && !ASK(t));
  const userWait = turn.tools.filter((t) => ASK(t) && secs(t) !== null).reduce((a, t) => a + secs(t), 0);
  const slowest = [...timed].sort((a, b) => secs(b) - secs(a))[0];
  // Minutes of work: the gaps between the turn's events, each capped (a session left idle for hours is not hours of work), without the choice window's.
  const IDLE_GAP = 10 * 60000;
  const workMs = !turn.startedAt ? null : (() => {
    const asks = turn.tools.filter((t) => ASK(t) && secs(t) !== null).map((t) => [t.at, result(t).at]);
    const stamps = [turn.startedAt, ...turn.tools.flatMap((t) => [t.at, result(t)?.at]).filter(Boolean), Date.now()].sort((a, b) => a - b);
    let ms = 0;
    for (let i = 1; i < stamps.length; i++) if (!asks.some(([x, y]) => x <= stamps[i - 1] && y >= stamps[i])) ms += Math.min(stamps[i] - stamps[i - 1], IDLE_GAP);
    return ms;
  })();
  const observed = {
    memory: {
      // Waymark's own memory (pack, memory, tasks, or reading .waymark/memory.md) or engram's search, if the user has it
      // or the hook handed the pack over at the first edit (docs/adr/0015)
      searched: (ctx.packed || 0) > 0 || before((t) => /mcp__engram__mem_(search|context)/.test(t.name) || waymarkCmd(t, 'pack|memory|tasks') || (t.name === 'Read' && /[\\/]\.waymark[\\/](memory|tasks)\.md$/.test(String(t.input.file_path || '')))),
      // searched only after the first change (the pack the block asks for): it no longer blocks, recorded late
      late: firstChange >= 0 && allTools.some((t, i) => i > firstChange && (/mcp__engram__mem_(search|context)/.test(t.name) || waymarkCmd(t, 'pack|memory|tasks'))),
      opened: before((t) => t.name === 'Read' && /[\\/]\.waymark[\\/]/.test(String(t.input.file_path || ''))),
      // by Edit/Write, or by any tool (a script run through the shell): memory.md changed during the turn and holds the
      // task ID of the Cierre heading
      written: turn.tools.some((t) => EDITS.test(t.name) && MEMORY_FILE.test(fileOf(t))) || memoryHolds(ctx.memoryFile, turn.startedAt, reply.match(/^[ \t]*##\s*Cierre\s*·\s*(.+)/m)?.[1]?.match(ID)?.[0]),
      saved: turn.tools.some((t) => /mem_(save|update|session_summary)/.test(t.name)),
      indexed: turn.tools.some((t) => /mem_(save|update)$/.test(t.name) && /^waymark\/tasks\//.test(String(t.input.topic_key || ''))),
    },
    procedure: { owner: dept.declared, read: [...new Set(procReads.map((t) => (where(t).match(/[\w.-]+[\\/]procedures\.md/) || ['procedures.md'])[0].replace(/\\/g, '/')).concat(procHanded ? [`${dept.declared}/procedures.md`] : []))], readBeforeChange: procBeforeChange, ...(procHanded ? { handed: true } : {}) },
    gates: gatesAfter.map((t) => ({ ...keepCmd(cmdOf(t)), s: secs(t) === null ? null : Math.round(secs(t)), error: !!result(t)?.error, ...(envFail(t) ? { env: true } : {}), ...(apart(t) ? { apart: true } : {}) })),
    tests: {
      specsChanged: changed.filter((f) => SPEC.test(path.basename(f))).map((f) => path.basename(f)), ranAfterLastSpec: lastSpec < 0 ? null : turn.tools.slice(lastSpec + 1).some(testCmd),
      // red: every spec that adds cases ran before the code after it, or a run in a clean copy (git worktree add … && … test)
      red: !notRed.length, ...(notRed.length ? { notRed } : {}),
    },
    build: noBuild ? { none: ctx.noBuild } : null, // the project declares no build (memory.md Quality gates)
    gate: null, // the gate testigo's run: { by: agent | testigo, cmd, ok, s, from?, timedOut? }
    // testigo "sin secretos": the memory, the task's diff and commits (ctx.scanSecrets, testigos.mjs) and its mem_save calls;
    // where and which kind only, never the value
    secrets: secretHits([...(ctx.scanSecrets ? ctx.scanSecrets(changed) : []), ...turn.tools.filter((t) => /mem_(save|update)$/.test(t.name)).map((t) => ({ where: 'mem_save', text: `${t.input.title || ''}\n${t.input.content || ''}` }))]),
    // what reached the agent although no hook stopped it (docs/adr/0037): a sensitive path read, edited or named by a command, a secret in a result
    // the first choice window of an L2+ task judged on its options' attributes: risk, files or cost, one marked (docs/adr/0038)
    options: optionsLint(ctx.decisions, S.level),
    guarded: detectGuarded(turn.tools, { cwd: ctx.cwd, cfg: loadRisk(ctx.root, { session: ctx.session }), outputOf: output, denied }),
    chain: ctx.chain ? ctx.chain.ok : null,
    browser: { ui, tried: turn.tools.filter((t) => (t.name === 'Skill' && /^(browser-verify|run)$/.test(String(t.input.skill || ''))) || /browser|playwright|chrome/i.test(t.name)).map((t) => t.name === 'Skill' ? t.input.skill : t.name).slice(0, 5) },
    // in this turn, or earlier in the same task: a follow-up that applies the review's findings needs no second review
    review: !reviewLeft.length,
    docs: turn.tools.filter(DOCS).length,
    retried: retried.map((r) => keepCmd(r.cmd).cmd), // commands that failed twice (the docs testigo)
    worktree: turn.tools.some(inCopy),
    branches: ctx.branches || {},
    evidence: null, // the Evidencia testigo: { claim, checkedAfter, cited, unbacked }
    time: { minutes: workMs === null ? null : Math.round(workMs / 6000) / 10, userWait: Math.round(userWait / 6) / 10, toolMinutes: Math.round(timed.reduce((a, t) => a + secs(t), 0) / 6) / 10, slowest: slowest ? { tool: slowest.name, what: (cmdOf(slowest) || fileOf(slowest) || String(slowest.input.skill || '')).replace(/\s+/g, ' ').slice(0, 100), s: Math.round(secs(slowest)) } : null },
  };
  return { shellChange, dept, procRe, lastIdx, lastCode, lastSpec, lastChange, result, firstRealChange, secs, runsOf, gateCmd, testCmd, output, exitFor, failedRun, apart, envFail, cmdKey, retried, ui, code, reviewLeft, noBuild, ASK, observed };
}

// Testigo build: a build that passed in the repo of each changed code file, after the last code change in that repo.
function observeBuild(S) {
  const { apart, code, ctx, exitFor, last, lastCode, lastIdx, output, runsOf, shellChange, turn } = S;
  // a stylesheet or a template with no binding is no logic: no spec can see it (jsdom does not compute layout), so none is asked for
  const logic = code.filter((f) => !styleOnly(f, turn.tools)), near = logic.length ? specsNear(logic) : null;
  // the last change a build has to follow: a spec edited after a passing build needs the spec run and the typecheck, not a new build
  const lastBuilt = lastIdx((t) => (codeEdit(t) && !SPEC.test(path.basename(fileOf(t)))) || shellChange(t));
  const committed = turn.tools.some((t) => shell(t) && /\bgit\b[^|;&\n]*\scommit\b/.test(bare(t)));
  // Testigo build: a build that passed (exit 0, or no failure in its output when its exit is another part's) in the repo of
  // each changed code file, after the last code change in that repo. Repos are known only for files and folders on disk:
  // an unknown one matches any build; a code change by shell names no repo and counts for every repo.
  const repoAt = ctx.repoOf || repoOf;
  const builds = lastCode < 0 ? [] : turn.tools.map((t, i) => [t, i]).filter(([t]) => !apart(t) && runsOf(t).some((p) => p.build) && (exitFor(t, 'build') ?? !failOut(output(t))))
    .map(([t, i]) => { const cd = runsOf(t).filter((p) => p.build).pop()?.cd; return { i, repo: repoAt(cd && ctx.cwd ? path.resolve(ctx.cwd, winPath(cd)) : ctx.cwd) }; });
  const codeRepos = [...new Set(code.map((f) => repoAt(path.dirname(f))))];
  const lastIn = (r) => lastIdx((t) => shellChange(t) || (codeEdit(t) && !SPEC.test(path.basename(fileOf(t))) && repoAt(path.dirname(fileOf(t))) === r));
  const builtAfter = (r) => { const last = lastIn(r); return builds.some((b) => b.i > (last < 0 ? lastBuilt : last) && (!b.repo || !r || b.repo === r)); };
  const buildAfter = lastCode >= 0 && (codeRepos.length ? codeRepos.every(builtAfter) : builds.some((b) => b.i > lastBuilt));
  return { near, committed, buildAfter };
}

// Testigo evidence (docs/adr/0025, 0026): an Evidencia "observada" needs a check after the last change, and each fact it cites is looked up in the tool calls.
function observeEvidence(S) {
  const { changed, ctx, denied, lastChange, observed, output, reply, result, runsOf, turn } = S;
  const hasCierre = CIERRE.test(reply);
  // Testigo evidence (docs/adr/0025): an Evidencia "observada" needs a check after the last change (a read, a search, a
  // run; a commit, a push, a question or a skill load checks nothing), and each fact it cites (`backticks`, 84/84, exit 0,
  // a hash) is looked up in the task's tool calls since the last close. A fact no call shows is "sin respaldo": scored,
  // never blocking (an honest paraphrase may not match).
  const evidText = hasCierre ? field(reply, 'Evidencia') || '' : '';
  const claim = /^\s*observad/i.test(evidText) ? 'observada' : /^\s*inferid/i.test(evidText) ? 'inferida' : null;
  const onlyGit = (t) => runsOf(t).length > 0 && runsOf(t).every((p) => /^git\s+(add|commit|push|tag)\b/.test(p.text.trim()));
  // a failing run is a check too (it saw the state); a call a hook or the user's permission stopped saw nothing
  const stopped = (t) => denied(t) && /hook error|PreToolUse:|doesn't want to proceed|user (?:denied|rejected)|Permission to use \S+ (?:has been|was) denied/i.test(output(t));
  const checks = (t) => !/^(AskUserQuestion|Skill|TodoWrite|ToolSearch|EnterPlanMode|ExitPlanMode)$/.test(t.name) && !EDITS.test(t.name) && !stopped(t) && !(shell(t) && onlyGit(t));
  const cited = evidenceFacts(evidText);
  // where a fact can be backed: the calls' inputs and outputs, never the text the agent wrote itself (its edits)
  const flat = (x) => String(x || '').toLowerCase().replace(/\\/g, '/').replace(/\s+/g, ' ');
  const calls = cited.length ? [...turn.tools, ...(ctx.stretchTools || [])].filter((t) => !EDITS.test(t.name)).map((t) => ({ name: String(t.name || ''), input: flat(Object.values(t.input || {}).filter((v) => typeof v === 'string').join(' ')), out: String(result(t)?.raw || result(t)?.text || t.out || '') })) : [];
  const hay = calls.map((c) => `${c.input} ${flat(c.out)}`).join('\n');
  const shellRan = (bad) => turn.tools.slice(lastChange + 1).some((t) => shell(t) && !stopped(t) && !!(result(t)?.error || t.error) === bad); // exit codes: after the last change
  // file:line is also backed by a call that named the file and printed that line without the file's name: grep -n of one
  // file ("45:"), its context lines ("45-") and Read ("45→", "45\t")
  const lineShown = (f) => {
    const m = f.match(/^(?:.*[\\/])?([^\\/\s:]+\.\w+):(\d+)$/);
    if (!m) return false;
    const at = new RegExp(`(?:^|\\n)\\s*${m[2]}(?:[:\\t→-])`);
    const named = new RegExp(`(?:^|[\\s/"'=])${esc(m[1].toLowerCase())}(?![\\w.-])`); // login.ts, never auth-login.ts
    return calls.some((c) => named.test(c.input) && at.test(c.out));
  };
  // a path is also backed by a call whose command named its folder and whose output printed its name (ls dir | tail -1)
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pathShown = (f) => {
    const m = flat(f).match(/^(.+)\/([^/\s]{3,})$/);
    if (!m) return false;
    const name = new RegExp(`(?:^|[\\s/"'=])${esc(m[2])}(?![\\w.-])`);
    return calls.some((c) => c.input.includes(m[1]) && name.test(flat(c.out)));
  };
  // Open failure (docs/adr/0026): a fact the hook cannot find in the literal form it was cited is looked up in the forms a
  // person writes it: a command with its quoted path ("waymark.mjs" check), a phrase whose words one call holds together
  // (the tool's name, its input and its output), pass/total (84/84) from "tests 84 … pass 84", a file name whose stem a
  // call printed (bf28ce5b.jsonl, the stem listed).
  const unquoted = (s) => flat(s).replace(/["'`\\]/g, ''); // a result stored as JSON has its quotes escaped
  const unquotedHay = unquoted(hay);
  const wordsTogether = (f) => {
    const words = unquoted(f).toLowerCase().split(/[\s:,;]+/).filter((w) => w.length > 1);
    return words.length >= 2 && words.length <= 6 && calls.some((c) => { const h = unquoted(`${c.name} ${c.input} ${c.out}`).toLowerCase(); return words.every((w) => new RegExp(`(?<![\\w.-])${esc(w)}(?![\\w-])`).test(h)); });
  };
  const ratioShown = (f) => {
    const m = f.match(/^(\d+)\/(\d+)$/);
    if (m && calls.some((c) => new RegExp(`Executed\\s+${m[1]}\\s+of\\s+${m[2]}\\b`, 'i').test(c.out))) return true; // Karma: "Executed 5 of 5 SUCCESS"
    if (m && m[1] === m[2] && calls.some((c) => new RegExp(`\\b${m[1]}\\s+(?:pass(?:ed)?|✓)`, 'i').test(c.out))) return true; // all of them passed: "8 passed" says 8/8
    return !!m && calls.some((c) => new RegExp(`(?:pass(?:ed)?|✓|ok)\\D{0,8}${m[1]}\\b|\\b${m[1]}\\s+(?:pass(?:ed)?|✓)`, 'i').test(c.out) && new RegExp(`(?:tests?|total)\\D{0,8}${m[2]}\\b|\\b${m[2]}\\s+(?:tests?|total)`, 'i').test(c.out));
  };
  const stemShown = (f) => { const m = flat(f).match(/^(?:.*\/)?([\w-]{7,})\.\w{1,6}$/); return !!m && hay.includes(m[1]); };
  // A command is looked up as a person writes it: W for the waymark script, with or without npx / pnpm exec / pnpm run, or as the package script that holds it
  // (`ng build` is what `pnpm run build` ran). An identifier (a route, a CSS variable, a host, a file name, a parameter, a permission key) is no command: it is
  // checked against what the task wrote and the files it changed, not against what a command printed.
  const COMMANDISH = /^(?:W|node|npx|pnpm|npm|yarn|bun|bunx|git|tsc|eslint|vitest|jest|ng|nest|python3?|pytest|cargo|go|dotnet|mvn|gradle|make|docker|curl|ls|cat|grep|rg|sed|awk|find|echo|cd|rm|cp|mv|mkdir|bash|sh|pwsh|powershell|php|bundle|rake|rails|terraform|kubectl|gh)\b/;
  const scripts = (() => { try { return JSON.parse(fs.readFileSync(path.join(ctx.root || '', 'package.json'), 'utf8')).scripts || {}; } catch { return {}; } })();
  const editsText = flat(turn.tools.filter((t) => EDITS.test(t.name)).map((t) => [t.input?.content, t.input?.new_string, ...(t.input?.edits || []).map((e) => e.new_string)].filter(Boolean).join(' ')).join(' '));
  const names = new Set(changed.map((f) => path.basename(f).toLowerCase()));
  const viaScript = (f) => Object.entries(scripts).some(([n, body]) => String(body).includes(f) && new RegExp(`(?:run|npm|pnpm|yarn)\\s+${esc(n)}\\b`).test(hay));
  const variants = (f) => [f.replace(/^W\s+/, 'waymark.mjs '), f.replace(/^(?:pnpm|npm|yarn|bun)\s+(?:exec\s+|run\s+|dlx\s+)?/, ''), f.replace(/^(?:npx|bunx|pnpm exec)\s+/, '')].filter((v) => v !== f);
  const identifier = (f) => !COMMANDISH.test(f) && !/^(?:\d+\/\d+|exit(?: code)? \d+|[0-9a-f]{7,40})$/i.test(f);
  const backedId = (f) => editsText.includes(flat(f)) || names.has(path.basename(f).toLowerCase());
  const backed = (f) => { const e = f.match(/^exit(?: code)? (\d+)$/i); return e ? (e[1] === '0' ? shellRan(false) : shellRan(true) || hay.includes(`exit code ${e[1]}`)) : hay.includes(flat(f)) || unquotedHay.includes(unquoted(f)) || lineShown(f) || pathShown(f) || wordsTogether(f) || ratioShown(f) || stemShown(f) || variants(f).some((v) => hay.includes(flat(v)) || unquotedHay.includes(unquoted(v))) || viaScript(f) || (identifier(f) && backedId(f)); };
  observed.evidence = claim && { claim, checkedAfter: turn.tools.slice(lastChange + 1).some(checks), cited: cited.length, unbacked: cited.filter((f) => !backed(f)).slice(0, 5) };
  return { hasCierre };
}

// The skips the user quoted (Tests, Review), validated against their own words.
function readSkips(S) {
  const { ctx, prompts, reply } = S;

  // ---- Each step of the routine contract (waymark/routine.json): does it apply, did it pass, why not ----
  const chosenLabels = (ctx.decisions || []).flatMap((x) => String(x.chosen).split(',')).map(plain).filter(Boolean);
  const skip = {}, extras = [];
  for (const f of ['Tests', 'Review']) {
    const s = userSkip(reply, f, prompts, chosenLabels);
    if (s === 'ok') skip[f] = true;
    else if (s?.short) extras.push(`${f}: skip quoted as the user's ("${s.quote}") is too short: quote at least 3 of their words`);
    else if (s) extras.push(`${f}: skip quoted as the user's ("${s.quote}") but those words are not in the user's messages nor an option they picked`);
  }
  return { skip, extras };
}

// The exception lines a reply writes after a block (docs/adr/0012).
function readExceptions(S) {
  const { ctx, reply } = S;
  // The exception lines (Tests: no, Build: no, no comprobado, Secretos: no) answer a block: written before the hook
  // blocked, a preventive one would cancel a real block. Read only in the reply that follows the block (stop_hook_active).
  const exc = ctx.blocked ? reply : '';
  // The exception lines (docs/adr/0012): written after a block, they let the step pass as ⚠ "excepción declarada", never
  // as ✔ (nothing ran to prove it). → the line, or undefined.
  const excLine = (re) => exc.match(re)?.[0]?.trim().slice(0, 160);
  const noComp = excLine(/no comprobado \(.{3,}\)/i), testsNo = excLine(/Tests:\s*no \(.{3,}\)/i), buildNo = excLine(/Build:\s*no \(.{3,}\)/i), secretsNo = excLine(/Secretos:\s*no \(.{3,}\)/i);
  const excepted = {};
  return { noComp, testsNo, buildNo, secretsNo, excepted };
}

// Testigo decision: the user's answer in the choice window came before the first change.
function decisionWitness(S) {
  const { ASK, allTools, ctx } = S;
  // Testigo decision: the user's answer in the choice window, never the agent's restatement of it. ✔ when the first
  // answered question of the task came before its first change; each answer is recorded with its position, and a later
  // question does not count against it. An edit the gate denied changed nothing. Measured on the stretch since the last
  // close (a follow-up's own question is not measured against its parent's first change); the review still counts
  // across the whole task.
  const taskTools = ctx.stretchTools?.length ? ctx.stretchTools : ctx.taskTools?.length ? ctx.taskTools : allTools;
  const changedFile = (t) => !t.error && ((EDITS.test(t.name) && !exempt(fileOf(t))) || (shell(t) && changesProject(t.input.command)));
  const firstTaskChange = taskTools.findIndex(changedFile);
  const firstAsk = taskTools.findIndex((t) => ASK(t) && !t.error);
  for (const x of ctx.decisions || []) {
    const i = x.callId ? taskTools.findIndex((t) => t.id === x.callId) : -1;
    if (i >= 0) x.position = firstTaskChange >= 0 && i > firstTaskChange ? 'after' : 'before';
  }
  const decision = [];
  let lateDecision = false;
  if (ctx.decisions && !ctx.decisions.length) decision.push('no choice-window answer in this task: ask the user now (AskUserQuestion) with the optimal options and every decision that shapes the work, then apply their pick');
  else if (ctx.decisions && firstAsk >= 0 && firstTaskChange >= 0 && firstAsk > firstTaskChange) lateDecision = true;
  return { decision, lateDecision };
}

// Testigo gate: the exit of the agent's last gate after its last code change, and the tests that failed after it.
function gateWitness(S) {
  const { apart, cmdKey, code, ctx, envFail, excepted, exitFor, failedRun, gateCmd, lastCode, lastSpec, noComp, observed, output, secs, testCmd, turn } = S;
  // Testigo gate: the exit of the agent's last gate after its last code change; with none, the repo typecheck the hook
  // re-runs (ctx.rerun, testigos.mjs: 40 s, never the full build). A test that failed after the last code change (and did
  // not pass in a later run) leaves it ✘ too, whatever ran after it. A failing gate blocks once; "no comprobado (<why>)"
  // says the failure is not this task's.
  const gate = [];
  const redTests = [];
  if (lastCode >= 0) {
    const mine = turn.tools.slice(lastCode + 1).filter((t) => gateCmd(t) && !envFail(t) && !apart(t)).pop(); // a gate that never ran checked nothing; a run in the clean copy is not the task's
    const rerun = () => { const r = ctx.rerun ? ctx.rerun(code) : null; return r && { by: 'testigo', ...r }; };
    // The exit is the gate's only when nothing but '&&' follows it, or it is the last part: "build | grep -i error" exits 1
    // on a clean build and "tsc; echo done" exits 0 on a red one. Otherwise a failure in its output decides, then the
    // hook's own typecheck (none: not held against it).
    const own = mine ? exitFor(mine, 'gate') : null;
    const agentRun = mine && { by: 'agent', ...keepCmd(cmdOf(mine)), ok: own ?? true, s: secs(mine) === null ? null : Math.round(secs(mine)) };
    // a repo with no typecheck the hook can run (Rails, plain JS): a test that passed after the last code change is its gate
    const greenTest = () => { const t = turn.tools.slice(lastCode + 1).filter((x) => testCmd(x) && !envFail(x) && !apart(x)).pop(); return t && !failedRun(t, 'test') ? { by: 'agent', test: true, ...keepCmd(cmdOf(t)), ok: true, s: secs(t) === null ? null : Math.round(secs(t)) } : null; };
    const run = !mine ? rerun() || greenTest() : own !== null ? agentRun : failOut(output(mine)) ? { ...agentRun, ok: false } : rerun() || { ...agentRun, exitNotTheGate: true };
    observed.gate = run || null;
    // a run in a clean copy (git worktree) is meant to fail: it shows a failure is not this task's, or a spec red first
    const after = turn.tools.map((t, i) => [t, i]).filter(([t, i]) => i > lastCode && testCmd(t) && !envFail(t) && !apart(t));
    for (const [t, i] of after) if (failedRun(t, 'test') && !after.some(([x, j]) => j > i && (cmdKey(x) === cmdKey(t) || testCovers(testTargets(cmdOf(x)), testTargets(cmdOf(t)))) && !failedRun(x, 'test'))) redTests.push(keepCmd(cmdKey(t)).cmd);
    observed.tests.failed = redTests;
    const none = 'no typecheck, lint or build ran after the last code change';
    // a gate the agent tried and the machine could not run (the tool is not installed): not a failure of the code, and not "nothing ran"
    const tried = turn.tools.slice(lastCode + 1).filter((t) => gateCmd(t) && envFail(t) && !apart(t)).pop();
    const missing = run?.unavailable || (!run && tried ? (cmdKey(tried).split(/\s+/)[0] || 'the tool') : null);
    const cannot = (cmd) => `the gate could not run here (${cmd}; ${missing} is not available or the run was refused): write "no comprobado (<why>)" and say what to run where it is installed, or install it and run it`;
    // the reply that follows the block already says the task is incomplete and why (`Resultado: parcial (<why>)`): that is the exception
    const partial = ctx.blocked ? String(S.reply || '').match(/Resultado:\s*(?:parcial|bloqueado)\s*\((.{3,}?)\)/i)?.[0] : null;
    if (missing) { if (noComp || partial) excepted.gate = noComp || partial; else gate.push(cannot(run?.cmd || cmdKey(tried).slice(0, 100))); }
    else if (!run) gate.push(`${none}${ctx.rerun ? ' and the repo has no typecheck the hook can run (memory.md Quality gates, package.json, tsconfig)' : ''}: run the project's gate once now (the full one at the end, per repo)`);
    else if (run.timedOut) gate.push(`${none} and the repo typecheck (${run.cmd}) took over 40 s: run the project's gate yourself once now`);
    else if (!run.ok && noComp) excepted.gate = noComp;
    else if (!run.ok) gate.push(`the gate after the last code change failed (${(run.by === 'agent' && failingPart(run.cmd, output(mine))) || run.cmd}${run.by === 'testigo' ? ', re-run by the hook' : ''}): fix it and run it again, or write "no comprobado (<why>)" if the failure is not this task's`);
    if (redTests.length && noComp) excepted.gate = noComp;
    else if (redTests.length) gate.push(`a test after the last code change failed (${redTests.join(' | ').slice(0, 700)}): fix it and run it again, or write "no comprobado (<why>)" if the failure is not this task's`);
  }
  if (lastSpec >= 0 && !observed.tests.ranAfterLastSpec) gate.push('a spec changed after the last test run: run that spec again');
  return { gate, redTests };
}

// Testigo cierre: the Cierre block, its fields and its task ID.
function cierreWitness(S) {
  const { changed, ctx, hasCierre, reply } = S;
  const cierre = [];
  let renamed = null;
  if (!hasCierre) cierre.push('the "## Cierre · <task ID>" block (Resultado · Evidencia · Aprendido)');
  else {
    if (!field(reply, 'Resultado')) cierre.push('Resultado: hecho | parcial (<what is missing>) | bloqueado (<why>)');
    if (!field(reply, 'Evidencia')) cierre.push('Evidencia: observada <what you saw> | inferida de <source> (check: <one line for the user>)');
    if (!field(reply, 'Aprendido') || /^ninguno/i.test(field(reply, 'Aprendido'))) cierre.push('Aprendido: <the task\'s line for the next session, ≤200 characters line> (never "ninguno")');
    if (ctx.ids) {
      const id = reply.match(/^[ \t]*##\s*Cierre\s*·\s*(.+)/m)?.[1]?.match(ID)?.[0];
      const offer = `${ctx.ids.next} for a new task${ctx.ids.followUp ? `, ${ctx.ids.followUp} for a follow-up of ${ctx.ids.last}` : ''}`;
      if (!id) cierre.push(`the task ID in the heading: "## Cierre · <id>" (${offer})`);
      else if (!validId(id, ctx.ids)) cierre.push(`the heading's task ID ${id} is already recorded or was never offered: use ${offer}`);
      // a follow-up ID whose task's files this turn never touches is a new task: recorded under the new ID, not blocked
      else if (!followUpShares(id, changed, ctx)) renamed = { from: id, to: ctx.ids.next };
    }
    // L2+: the ask kept as numbered items (the Pedido line, ctx.pedido); the Cierre answers each one, and "hecho" cannot stand over a ✘ (docs/adr/0038)
    if (Number(S.level) >= 2 && ctx.pedido?.length >= 2) cierre.push(...askedGaps(ctx.pedido, pedidoAnswers(reply), field(reply, 'Resultado').match(/^\p{L}+/u)?.[0]));
  }
  return { cierre, renamed };
}

// The conditions routine.json names in `when`, from what ran, never from words.
function whenOf(S) {
  const { changed, code, committed, ctx, level, near, noBuild, observed, redTests, retried, shellChange, skip, turn, ui } = S;
  // review proportional to risk (routine.json risk, docs/adr/0027): L3, a sensitive path, or a big change blocks; a small one is recorded as omitted
  const risk = reviewRisk({ code, changed, level, lines: editedLines(turn.tools, shellChange), cfg: loadRisk(ctx.root) });
  const when = {
    riskyCode: risk.review,
    engram: !!ctx.engram, code: code.length > 0, build: code.length > 0 && !noBuild, ui, specNear: !!near && !skip.Tests, commit: committed && !!ctx.commits,
    // from what ran, never from words: a gate failed twice, the judged gate failed, a spec and code changed
    repeatedFailure: retried.length > 0, gateFailed: observed.gate?.ok === false || redTests.length > 0,
    specAndCode: observed.tests.specsChanged.length > 0 && code.some((f) => !SPEC.test(path.basename(f))),
    push: false, // the notes testigo is judged after the record, when the hook pushes them (notesBlock)
  };
  return { when, risk };
}

// Testigo procedure: the owner department loaded and its procedures.md read.
function procedureWitness(S) {
  const { ctx, dept, observed, procRe, routed } = S;
  const procedure = [];
  if (routed === 'Q') procedure.push('routed as a question (Q) but changed project files');
  if (!dept.declared) procedure.push('no owner department was invoked: invoke the owner dept-* skill (its SKILL.md) first');
  else if (!dept.invoked.includes(dept.declared)) procedure.push(`${dept.declared} owns the open task but was never invoked`);
  else if (!observed.procedure.read.some((p) => procRe.test(p))) procedure.push(`${dept.declared}/procedures.md never read (a search with no match does not count)`);
  // a Node repo's clean copy installs its own modules from the store (copyInstall, stack.mjs), never through a link
  const copyStep = ctx.copyInstall ? ` → in the copy: ${ctx.copyInstall}, with CI=true in its environment (from the store, no network, no prompt; never a junction to the repo's node_modules: the package manager can purge it through the link)` : '';
  return { procedure, copyStep };
}

// One function per testigo: what it says is missing. routine.json decides which apply at the level and which block.
const WITNESS = {
  decision: (S) => S.decision,
  gate: (S) => S.gate,
  cierre: (S) => S.cierre,
  evidence: (S) => {
    const { observed } = S;
    return observed.evidence?.claim === 'observada' && !observed.evidence.checkedAfter ? ['Evidencia says "observada" but no tool call checked the state after the last change (a commit, a push or a question checks nothing): check it now (run, read or test what changed), or write it as "inferida de <source> (check: <one line for the user>)"'] : [];
  },
  memory: (S) => {
    const { observed } = S;
    return observed.memory.searched || observed.memory.late ? [] : [`the project memory was not searched before the first change: run ${WAYMARK_CMD} pack <the changed files> now (what earlier tasks did there), or mem_search if you use engram`];
  },
  review: (S) => {
    const { ctx, observed, reviewLeft, skip } = S;
    // a batch that only applies the findings of a review the user asked to fix needs one review of what that batch changed, not another whole round
    const delta = (ctx.decisions || []).some((d) => d.source === 'prompt') ? ' — one delta review of only the files this batch changed: the findings were already reviewed' : '';
    return skip.Review || observed.review ? [] : [`code changed and no review ran: run code-review after the code change, or ${WAYMARK_CMD} review <files> where the agent has no code-review, naming the code files not reviewed yet (${reviewLeft.slice(0, 4).map((f) => path.basename(f)).join(', ')}${reviewLeft.length > 4 ? '…' : ''})${delta}`];
  },
  build: (S) => {
    const { buildAfter, buildNo, excepted } = S;
    return buildAfter ? [] : buildNo ? (excepted.build = buildNo, []) : ['L2+ with code: run the build once now, after the last change, in the repo of the changed code (or write Build: no (<why>) if the project has none)'];
  },
  docs: (S) => {
    const { retried } = S;
    return retried.filter((r) => !r.docs && !r.late).map((r) => `the same command failed twice (${r.cmd.slice(0, 80)}): consult the docs (library-docs, or the installed package's types/source) before running it again`);
  },
  procedure: (S) => S.procedure,
  spec: (S) => {
    const { excepted, near, observed, testsNo } = S;
    return observed.tests.specsChanged.length ? [] : testsNo ? (excepted.spec = testsNo, []) : [`${near} sits next to the changed code and no spec was added or changed: add or update it and run it, or write Tests: no (<why no spec can cover it>)`];
  },
  red: (S) => {
    const { copyStep, excepted, observed, testsNo } = S;
    return observed.tests.red ? [] : testsNo ? (excepted.red = testsNo, []) : [`a spec that adds cases (${observed.tests.notRed.slice(0, 4).join(', ')}) never ran before the code it tests: show it red now in a clean copy (${WAYMARK_CMD} copy HEAD${copyStep} → copy the changed spec there → run it; it must fail → ${WAYMARK_CMD} copy --remove <path>), or write "Tests: no (<why it cannot fail first>)"`];
  },
  preexisting: (S) => {
    const { copyStep, excepted, noComp, observed } = S;
    return observed.worktree ? [] : noComp ? (excepted.preexisting = noComp, []) : [`the gate after the last change failed: if it is not this task's, show the same failure in a clean copy now (${WAYMARK_CMD} copy HEAD${copyStep} → rerun the failing command there → ${WAYMARK_CMD} copy --remove <path>), or write "no comprobado (<why>)"`];
  },
  trailer: (S) => {
    const { ctx } = S;
    return ctx.commits?.length || ctx.trailered?.length ? [] : ['a commit made this turn without the trailer "Waymark-Task: <task ID>"'];
  },
  secrets: (S) => {
    const { excepted, observed, secretsNo } = S;
    return !observed.secrets.length ? [] : secretsNo ? (excepted.secrets = secretsNo, []) : [`a secret-like value in ${observed.secrets.slice(0, 3).map((h) => `${h.where}${h.line ? `:${h.line}` : ''} (${h.kind})`).join(', ')}: remove it (and rotate it if it is real), or write "Secretos: no (<why>)" when it is a fake value in a test or fixture`];
  },
  chain: (S) => {
    const { ctx } = S;
    return ctx.chain && !ctx.chain.ok ? [`provenance.jsonl chain broken at record ${ctx.chain.at + 1}: ${ctx.chain.note ? 'its git note is missing or was edited (a rebase or amend leaves the note on the old commit)' : ctx.chain.anchor ? `the log no longer holds a line anchored in git (refs/notes/waymark-anchor): it was rewritten or cut; a removal the user asks for goes through ${WAYMARK_CMD} forget` : 'an earlier record was edited or deleted'} (check: ${WAYMARK_CMD} testigos)`] : [];
  },
};
function failsOf(S) {
  return { fails: Object.fromEntries(Object.entries(WITNESS).map(([id, witness]) => [id, witness(S)])) };
}

// The steps of the routine contract (waymark/routine.json): does each apply, did it pass, why not.
function composeSteps(S) {
  const { askedRepos, changed, ctx, dept, excepted, extras, fails, firstRealChange, lateDecision, level, observed, outsideRepos, renamed, reply, retried, risk, when, win } = S;
  const steps = ROUTINE.testigos.map((s) => {
    const lacked = (ctx.lacks || []).includes(s.id); // the agent has no capability for it (docs/adr/0009): not applicable
    // a task that changed no project file (a push, a commit, an install the user asked for): the user's order is the
    // decision, so the choice window does not apply, and with no first edit there is no pack to hand over (docs/adr/0017);
    // the pre-tool gate still stops file changes first
    const ordered = (s.id === 'decision' || s.id === 'memory') && !changed.length;
    const applies = s.levels.includes(level) && (!s.when || when[s.when]) && !lacked && !ordered;
    const why = applies ? fails[s.id] || [] : [];
    return { id: s.id, label: s.label, enforce: s.enforce, applies, pass: applies ? !why.length : null, why, ...(applies && !why.length && excepted[s.id] ? { exception: excepted[s.id] } : {}), ...(lacked ? { na: ctx.agent || 'agent' } : {}) };
  });
  const missing = steps.filter((s) => s.applies && s.enforce === 'block').flatMap((s) => s.why);
  const findings = [...steps.filter((s) => s.applies && s.enforce !== 'block').flatMap((s) => s.why), ...extras];
  const dec = steps.find((s) => s.id === 'decision');
  if (lateDecision && dec?.applies) { // cannot be undone, so it does not block; the evaluation keeps it
    const why = 'the first choice-window question came after the task\'s first change';
    dec.pass = false; dec.why = [...dec.why, why]; findings.push(why);
  }
  const ev = steps.find((s) => s.id === 'evidence');
  if (ev?.applies && ev.pass && observed.evidence?.unbacked.length) { // a fact no tool call shows: a ⚠, never blocked
    const why = `Evidencia cites what no tool call of the task shows (sin respaldo): ${observed.evidence.unbacked.join(' · ').slice(0, 160)}`;
    ev.warn = why; findings.push(why);
  }
  const docsStep = steps.find((s) => s.id === 'docs'), blind = retried.filter((r) => !r.docs && r.late);
  if (docsStep?.applies && blind.length) { // already retried without docs: too late to undo, so recorded, not blocked
    const why = blind.map((r) => `the same command failed twice and ran again without docs (${r.cmd.slice(0, 80)})`);
    docsStep.pass = false; docsStep.why = [...docsStep.why, ...why]; findings.push(...why);
  }
  const mem = steps.find((s) => s.id === 'memory');
  if (mem?.applies && mem.pass && !observed.memory.searched && observed.memory.late) { // too late to inform the change: recorded, not blocked
    const why = 'the project memory was searched after the task\'s first change';
    mem.pass = false; mem.why = [why]; findings.push(why);
  }
  const proc = steps.find((s) => s.id === 'procedure');
  if (proc?.applies && proc.pass && firstRealChange >= 0 && !observed.procedure.readBeforeChange) { // read only once blocked: too late to guide the change
    const why = 'the owner\'s procedures.md section was read after the task\'s first change';
    proc.pass = false; proc.why = [why]; findings.push(why);
  }
  if (win?.unanswered.length) findings.push(`the Cierre does not answer what the user chose in the window (recorded, not blocked): ${win.unanswered.slice(0, 3).map((x) => `"${x.slice(0, 60)}"`).join(' · ')}`);
  if (win?.failed.length) findings.push(`the Cierre marks ✘ what the user chose in the window: ${win.failed.slice(0, 3).map((x) => `"${x.slice(0, 60)}"`).join(' · ')}`);
  if (win?.twoActions.length) findings.push(`a label the user chose holds two actions (apply and run, delete and deploy…): the Cierre must say which of them was done: ${win.twoActions.slice(0, 3).map((x) => `"${x.slice(0, 60)}"`).join(' · ')}`);
  if (outsideRepos.length) findings.push(`changed a repository the Pedido does not name (Repos:): ${outsideRepos.slice(0, 3).join(', ')}`);
  if (observed.options?.missing.length) findings.push(`the first choice window's options lack their attributes (recorded, not blocked): ${observed.options.missing.slice(0, 3).join(' · ')}`);
  if (observed.guarded?.length) findings.push(guardedLine(observed.guarded)); // detected after the fact: recorded in the chain, never blocked
  if (ROUTINE.fallback) findings.push('waymark/routine.json missing or invalid: checked with the minimal catalog (decision, gate, Cierre)');
  const otherFailed = observed.gates.filter((g) => g.error && !g.env && !g.apart && g.cmd !== observed.gate?.cmd); // the judged gate is the gate testigo's
  if (otherFailed.length) findings.push(`a command after the last change failed: ${otherFailed.map((g) => g.cmd.slice(0, 60)).join(' | ')}`);
  const omitted = omittedOf(S, steps);
  return { level, changed, reply, missing, findings, steps, dept, observed, renamed, win, askedRepos, ...(omitted ? { omitted } : {}) };
}

// The review a small, plain change skips is recorded with its reason, so the record says why nothing blocked.
function omittedOf(S, steps) {
  const r = steps.find((s) => s.id === 'review');
  return r && !r.applies && S.code.length && S.level >= 2 && !r.na ? { Review: `riesgo bajo (${S.risk.reason})` } : null;
}

// → null (no project files changed, L0) or { level, changed, reply, missing[] (blocks), findings[] (recorded), dept, observed }.
// The turn is observed once (observeTurn); each testigo is a function of what was observed (S) and routine.json says which
// apply at the level and which block (docs/adr/0026).
// A shell call that changes files and then runs a gate in the same command is two calls, in order: the change and the check after it (runs.mjs
// splitAtChange). The second keeps the call's id, so its result and exit are the check's; the first has none.
export function splitShellCalls(tools) {
  return (tools || []).flatMap((t) => {
    const s = shell(t) ? splitAtChange(cmdOf(t)) : null;
    return s ? [{ ...t, id: `${t.id}#change`, input: { ...t.input, command: s[0] } }, { ...t, input: { ...t.input, command: s[1] } }] : [t];
  });
}

export function cierreGaps(turn, last, allTools = turn.tools, prompts = [turn.prompt], ctx = {}) {
  const sameTools = allTools === turn.tools;
  turn = { ...turn, tools: splitShellCalls(turn.tools) };
  allTools = sameTools ? turn.tools : splitShellCalls(allTools);
  ctx = { ...ctx, ...(ctx.taskTools ? { taskTools: splitShellCalls(ctx.taskTools) } : {}), ...(ctx.stretchTools ? { stretchTools: splitShellCalls(ctx.stretchTools) } : {}) };
  projectRoot = ctx.cwd || '';
  const byKey = new Map();
  for (const f of [...turn.tools.filter((t) => EDITS.test(t.name)).map(fileOf), ...(ctx.gitChanged || [])]) if (f && !exempt(f) && !byKey.has(norm(f))) byKey.set(norm(f), f);
  const changed = [...byKey.values()];
  // A task with a Cierre whose changes are all outside the project (install, cleanup) is recorded too (ctx.outside):
  // a Cierre heading at the start of a line, in a turn routed L1–L3 — never a Q turn.
  const lastText = String(last || '').replace(/\*\*|__/g, '');
  const earlyLevel = routedLevel([...turn.texts, lastText], turn.tools) || ctx.inherited?.level || 0;
  // A turn no prompt of its own started (a notification after the close) or an empty one, and changed nothing, is no task:
  // its Cierre would be a ghost row (the notification's turn carries the original prompt).
  // A courtesy ("gracias", "ok") or a turn that only wrote the routine's own files (memory, notes) with no command that acts, is none either.
  if (!changed.length && (ctx.resumed || !String(turn.prompt || '').trim() || COURTESY.test(String(turn.prompt)) || (turn.tools.some((t) => EDITS.test(t.name)) && !turn.tools.some(acting)))) return null;
  if (!changed.length && !(ctx.outside && CIERRE.test(lastText) && typeof earlyLevel === 'number' && earlyLevel > 0)) return null;
  const full = String(last || turn.texts[turn.texts.length - 1] || '').replace(/\*\*|__/g, ''); // **Campo:** reads as Campo:
  // Fields and claims are read from the Cierre block only: the prose above it ("la decisión: tuya…", "fallos previos")
  // is not a field (found when the hook read a bullet of the reply as Decisión).
  const reply = full.match(/^[ \t]*##\s*Cierre[\s\S]*/m)?.[0] || full;
  const routed = routedLevel([...turn.texts, full], turn.tools) || ctx.inherited?.level || 0; // an unrouted reply inside an open task
  // The level judged comes from what the agent changed, with the declared one as a floor: 1–2 files → L1, more → L2. L3
  // only when declared; an explicit L0 keeps its skip for a single file; a Q turn that changed files is judged as L2.
  const denied = (t) => !!(turn.results?.[t.id]?.error || t.error); // an edit the gate denied changed nothing
  const agentFiles = new Set(turn.tools.filter((t) => EDITS.test(t.name) && !denied(t) && !exempt(fileOf(t))).map((t) => norm(fileOf(t))));
  if (turn.tools.some((t) => shell(t) && changesProject(t.input.command))) for (const f of ctx.gitChanged || []) if (!exempt(f)) agentFiles.add(norm(f));
  const byFiles = agentFiles.size > 2 ? 2 : agentFiles.size ? 1 : 0;
  const explicitL0 = /^[ \t]*Waymark →\s*L0\b(?!\s*(?:\||or)\s*Q)/m.test([...turn.texts, full].join('\n'));
  const declared = routed === 'Q' ? 2 : routed || (CIERRE.test(reply) ? 1 : 0);
  const level = declared === 3 ? 3 : explicitL0 && agentFiles.size <= 1 ? 0 : Math.max(declared, byFiles);
  if (!level) return null;
  // what the user chose in the window is an item the Cierre answers (recorded, never blocked), and the repos the Pedido names against the ones changed (docs/adr/0046)
  const win = Number(level) >= 2 ? windowCheck(ctx.decisions, reply) : null;
  const askedRepos = namedRepos(turn.texts), outsideRepos = reposNotNamed(changed, ctx.root, askedRepos, (ctx.decisions || []).map((d) => d.chosen).join(' '));
  const S = { turn, last, allTools, prompts, ctx, byKey, changed, lastText, earlyLevel, full, reply, routed, denied, agentFiles, byFiles, explicitL0, declared, level, win, askedRepos, outsideRepos };
  Object.assign(S, observeTurn(S));
  Object.assign(S, observeBuild(S));
  Object.assign(S, observeEvidence(S));
  Object.assign(S, readSkips(S));
  Object.assign(S, readExceptions(S));
  Object.assign(S, decisionWitness(S));
  Object.assign(S, gateWitness(S));
  Object.assign(S, cierreWitness(S));
  Object.assign(S, whenOf(S));
  Object.assign(S, procedureWitness(S));
  Object.assign(S, failsOf(S));
  return composeSteps(S);
}


// Automatic evaluation from the routine contract: ✔/✘ per step that applied (a label with several steps passes only if
// all pass), the score over the applicable steps, tokens and the quota: measured by the status line when there is a
// clean reading (statusline.mjs, { pct, shared }), else estimated.
// A step that passed on a declared exception is 'exception' (⚠): not a ✘, never counted as a ✔ in the score. A step that
// passed with a warning (an Evidencia fact sin respaldo) is 'warn' (⚠): counted as passed, shown so it is looked at.
export function evaluate(gaps, usage, model = null, measured = null, links = null) {
  const steps = {};
  const rank = (v) => (v === false ? 0 : v === 'exception' ? 1 : v === 'warn' ? 2 : 3);
  const worst = (a, b) => (rank(a) <= rank(b) ? a : b);
  for (const s of gaps.steps.filter((x) => x.applies)) steps[s.label] = worst(steps[s.label] ?? true, s.pass === false ? false : s.exception ? 'exception' : s.warn ? 'warn' : true);
  const ok = Object.values(steps).filter((v) => v === true || v === 'warn').length, exceptions = Object.values(steps).filter((v) => v === 'exception').length;
  const marks = exceptions + Object.values(steps).filter((v) => v === 'warn').length;
  const est = estimate(usage, model); // the user's own pairs per model (calibrate.mjs); none → no %
  const split = usage?.cacheRead !== undefined ? { usage: { input: usage.input, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead, output: usage.output } } : {};
  // shared with another session: quotaOwn is this session's part, prorated by cost (an estimate, never a pair)
  const quota = measured ? { quotaPct: measured.pct, quotaBy: measured.shared ? 'measured:shared' : 'measured', quotaEst: est.pct, ...(measured.shared && measured.own !== undefined ? { quotaOwn: measured.own } : {}) } : { quotaPct: est.pct, quotaBy: est.by };
  return { steps, score: `${ok}/${Object.keys(steps).length}${marks ? ` · ${marks} ⚠` : ''}`, ...(exceptions ? { exceptions } : {}), ...(gaps.omitted ? { omitted: gaps.omitted } : {}), tokens: usage?.total || 0, ...split, ...(links ? { links } : {}), model, ...quota };
}

// Branch of the repo that holds each changed file (null when not a repo), so the record shows where the work went.
export function branchesOf(files) {
  const out = {};
  for (const dir of [...new Set(files.map((f) => path.dirname(f)))]) {
    if (!fs.existsSync(dir)) continue;
    const top = spawnSync('git', ['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8', timeout: 1000 });
    const [root, branch] = top.status === 0 ? top.stdout.trim().split('\n') : [];
    if (root && !(root in out)) out[root] = branch;
  }
  return out;
}

// The provenance record of a closed turn: what was observed, what the agent said, the evaluation and what stayed open.
export const RECORD_SCHEMA = RECORD_V2; // v1 records stay valid and are read as they are (docs/adr/0030)
// The Resultado as a label. An L2+ task whose Cierre left an item of the ask unanswered or marked ✘ never reads "hecho" (docs/adr/0038): the
// record says "parcial" and keeps what the Cierre said and why.
// A step the user owns (their deploy, their PR) never leaves a task parcial: when the Cierre's only gap is that step, and the
// project's Conventions say it is the user's, the result is hecho with the step named (`userOwned`). A parcial for a cause
// outside the work (the quota, a provider) carries `cause: 'external'`: the next ask is a new task unless the user says it continues.
const STEP_WORDS = { deploy: /despleg|desplieg|deploy|release|publica|publish/i, pr: /\bPRs?\b|pull requests?/i, merge: /merge|fusi[oó]n|fusionar/i, push: /\bpush(?:es)?\b|subir al remoto/i };
const EXTERNAL = /usage limit|l[ií]mite de uso|se agot[oó] la cuota|cuota (?:agotada|del plan|de uso)|quota (?:exceeded|reached)|rate.?limit|sin conexi[oó]n|connection (?:lost|refused)|proveedor (?:ca[ií]do|no responde)|servicio (?:externo|ca[ií]do)/i;
const STEP_KEY = /^(?:the )?(?:deploys?|despliegues?|releases?|prs?|pull requests?|merges?|push(?:es)?)$/i;
export function ownedSteps(text) {
  const owned = new Set();
  for (const m of String(text || '').replace(/<!--[\s\S]*?-->/g, '').matchAll(/^[ \t]*[-*]?[ \t]*([^:\n]{2,40}):[ \t]*(?:el usuario|usuario|the user|user|yo|me|manual|a mano|by hand)\b/gim)) for (const [step, re] of Object.entries(STEP_WORDS)) if (re.test(m[1]) && STEP_KEY.test(m[1].trim())) owned.add(step); // the key names the step and nothing else ("Push notifications" is no rule)
  return owned;
}
export function outcome(reply, items, answers, level, owned = new Set(), win = null) {
  const said = (reply.match(/^[ \t]*Resultado:[ \t]*(\p{L}+)/imu)?.[1] || '').toLowerCase() || null;
  const gaps = Number(level) >= 2 ? askedGaps(items, answers, said || '') : [];
  if (said === 'hecho' && gaps.length) return { result: 'parcial', said, why: 'an item of the ask is unanswered or marked ✘' };
  if (said === 'hecho' && (win?.unanswered.length || win?.failed.length)) return { result: 'parcial', said, why: 'a choice of the window is not answered in the Cierre or is marked ✘' };
  if (said === 'parcial') {
    const line = reply.match(/^[ \t]*Resultado:[^\n]*/im)?.[0] || '';
    const mine = [...owned].filter((s) => STEP_WORDS[s].test(line));
    const undone = (answers || []).filter((a) => !a.ok && ![...owned].some((s) => STEP_WORDS[s].test(a.note || ''))); // an item ✘ for another reason keeps it parcial
    if (mine.length && !gaps.length && !undone.length) return { result: 'hecho', said, userOwned: mine, why: `the only step left is the user's (${mine.join(', ')})` };
    if (EXTERNAL.test(line)) return { result: said, cause: 'external' };
  }
  return { result: said };
}
export function provenanceRecord(turn, gaps, ctx, meta = {}) {
  const answers = Number(gaps.level) >= 2 && ctx.pedido?.length >= 2 ? pedidoAnswers(gaps.reply).filter((a) => a.n >= 1 && a.n <= ctx.pedido.length).slice(0, 12) : [];
  const claimed =gaps.reply.match(/^[ \t]*##\s*Cierre\s*·\s*(.+)/m)?.[1]?.match(ID)?.[0];
  const ok = claimed && validId(claimed, ctx.ids) && followUpShares(claimed, gaps.changed, ctx);
  return deepMask({ // every string: the strong secret formats masked (testigo "sin secretos")
    schema: RECORD_SCHEMA, // the shape of this record: a later reader (a verifier, a model trained on the records) knows which fields to expect
    id: ok ? claimed : ctx.ids.next, ...(ok ? {} : { idBy: 'hook', ...(claimed ? { claimed } : {}) }), agent: meta.agent || null, at: new Date().toISOString(), session: meta.session, cwd: meta.cwd,
    // Never a secret in the chained record (it cannot be edited later): picked labels only, no free-text answer, and
    // passwords, tokens and keys masked in what is kept as text.
    level: gaps.level, department: gaps.dept, prompt: maskSecrets(String(turn.prompt || '').slice(0, 600)), decisions: recordedDecisions(ctx.decisions),
    files: [...new Set(gaps.changed)],
    ...v2Fields({ prompt: turn.prompt, files: gaps.changed, level: gaps.level, records: ctx.records, self: ok ? claimed : ctx.ids.next, norm, pedido: Number(gaps.level) >= 2 ? ctx.pedido || [] : [] }), // schema v2: taskType, asked, reworks, reworkFiles
    ...(answers.length ? { answered: answers } : {}), // what the Cierre's Pedido line says of each item
    ...(meta.cost ? { cost: meta.cost } : {}),
    observed: gaps.observed,
    evaluation: meta.evaluation,
    commands: turn.tools.filter(shell).map((t) => maskSecrets(cmdOf(t).slice(0, 200))).slice(0, 30),
    skills: [...new Set(turn.tools.filter((t) => t.name === 'Skill').map((t) => String(t.input.skill || '')))],
    inputs: ctx.inputs, commits: ctx.commits || [],
    cierre: maskSecrets((gaps.reply.match(/^[ \t]*##\s*Cierre[\s\S]*/m)?.[0] || '').slice(0, 2000)),
    outcome: outcome(gaps.reply, ctx.pedido, answers, gaps.level, ctx.owned, gaps.win), // hecho | parcial | bloqueado, as a label
    ...(gaps.win && (gaps.win.unanswered.length || gaps.win.failed.length || gaps.win.twoActions.length) ? { window: gaps.win } : {}), // what the user chose in the window and the Cierre left out (docs/adr/0046)
    ...(gaps.askedRepos?.length ? { askedRepos: gaps.askedRepos.slice(0, 6) } : {}),
    unresolved: gaps.missing.map(maskSecrets),
    findings: gaps.findings.map(maskSecrets),
  });
}

// The record of a turn routed Q that changed nothing, or null: no task ID, so it never shifts T<n> or the follow-up offered.
// A reply that ends with an "Aprendido:" line keeps it as `learned` (the hook saves it to engram, marked Q). `answer` is
// what tasks.md shows of it: the Aprendido, or else the start of the final reply as one line (no routing line, no
// markdown), so a question that ran a review is not taken for still pending; `skills` are the ones it ran besides its
// department.
export function questionRecord(turn, meta = {}) {
  if (!turn.found || routedLevel(turn.texts, turn.tools) !== 'Q') return null;
  // the agent's last message as the hook was given it: the transcript can lag the reply by a moment, and the answer is what the record keeps
  const texts = meta.last && turn.texts[turn.texts.length - 1] !== meta.last ? [...turn.texts, meta.last] : turn.texts;
  const tail = String(texts[texts.length - 1] || '').replace(/\*\*|__/g, '').trimEnd().split('\n').slice(-3).join('\n');
  const learned = /^\s*Aprendido:/im.test(tail) ? maskSecrets(aprendidoOf(tail)).slice(0, 600) : '';
  const oneLine = (t) => String(t).split('\n').filter((l) => !/^\s*Waymark\s*→/.test(l))
    .map((l) => l.replace(/\*\*|__|`/g, '').replace(/^\s*(?:#{1,6}|[-*+]|\d+\.)\s+/, '').trim()).filter(Boolean).join(' · ');
  // the last block with substance: a closing line of its own ("¿Con cuál seguimos?") is not the answer
  const blocks = [...texts].reverse().map(oneLine).filter(Boolean);
  const final = blocks.find((b) => b.length >= 60) || blocks[0] || '';
  const answer = maskSecrets(learned || final).slice(0, 300);
  const skills = [...new Set(turn.tools.filter((t) => t.name === 'Skill').map((t) => String(t.input.skill || '')).filter((s) => s && !/^dept-/.test(s)))];
  return { kind: 'Q', agent: meta.agent || null, at: new Date().toISOString(), session: meta.session, cwd: meta.cwd, department: routedDept(turn.texts, turn.tools), prompt: maskSecrets(String(turn.prompt || '').slice(0, 600)),
    ...(skills.length ? { skills } : {}), ...(answer ? { answer } : {}), ...(learned ? { learned } : {}) };
}

// The record of a turn the hook crashed on: no task ID (it is no task, like a Q), the cause, nothing judged.
export const unevaluatedRecord = (err, meta = {}) => ({ kind: 'unevaluated', cause: `unevaluated:${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 160)}`, agent: meta.agent || null, at: new Date().toISOString(), session: meta.session, cwd: meta.cwd });

// The files a turn wrote inside an agent's own memory folder (~/.claude/projects/<project>/memory/): a rule of the user kept there is
// invisible to every other agent, so the notice says where it belongs (docs/adr/0043).
const NATIVE_MEMORY = /[\\/]\.claude[\\/]projects[\\/][^\\/]+[\\/]memory[\\/]/;
export const nativeMemoryWrites = (tools) => [...new Set(tools.filter((t) => /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(t.name)).map((t) => String(t.input?.file_path || '')).filter((p) => NATIVE_MEMORY.test(p)))];
export const nativeMemoryNote = (files) => files.length ? ` · ⚠ escribió en la memoria nativa del agente (${files.length} archivo${files.length > 1 ? 's' : ''}): una regla tuya va a ~/.waymark/preferences.md (vale en todo proyecto) o a .waymark/memory.md → Conventions (del proyecto), con fecha y tu frase` : '';

// The question at the end of a task that said hecho: a bare "sí" closes it for good (the per-prompt hook runs `done`); any other
// message continues it. Shown to the user, never added to the model's context.
export const confirmAsk = (rec) => (rec?.outcome?.result === 'hecho' ? ' · ¿Se completó lo que pediste? Responde «sí» y la tarea queda confirmada; otra cosa la continúa como seguimiento' : '');

// One line for the user (systemMessage: shown in the UI, not added to the model's context).
// A measured % is never asked. Otherwise, while the model has fewer than 3 calibration pairs (no fit yet), it asks the
// user for the real %. Past NEW_SESSION
// tokens of context, it says the next task is cheaper in a new session: every response re-reads the whole context, and
// the context card resumes the work there.
export const NEW_SESSION = 200000;
export function summaryLine(id, ev, context = 0, { ask: asking = true } = {}) {
  const s = Object.entries(ev.steps).map(([k, v]) => `${k} ${v === 'exception' || v === 'warn' ? '⚠' : v ? '✔' : '✘'}`).join(' · ');
  const ask = asking && /^(none|default|pairs:[12]|family:.+)$/.test(String(ev.quotaBy || ''))
    ? ` · ¿qué % marcó tu cuota en esta tarea? node "${path.join(path.dirname(fileURLToPath(import.meta.url)), 'calibrate.mjs').replace(/\\/g, '/')}" "${id}" <pct>` : '';
  const fresh = context > NEW_SESSION ? ` · contexto ~${Math.round(context / 1000)}k: la próxima tarea, en una sesión nueva (la tarjeta la retoma)` : '';
  const by = String(ev.quotaBy);
  const own = ev.quotaOwn !== undefined ? `; esta sesión ${ev.quotaOwn > 0 && ev.quotaOwn < 1 ? '<1' : `≈ ${ev.quotaOwn}`}%, prorrateado por costo` : '';
  const how = by === 'measured' ? 'medido' : by === 'measured:shared' ? `medido, con otra sesión activa${own}` : by.startsWith('family:') ? `sin calibrar, factor de ${by.slice(7)}` : 'estimado';
  const pct = by.startsWith('measured') && ev.quotaPct === 0 ? '<1%' : `≈ ${ev.quotaPct}%`; // below the reading's resolution
  return `Waymark ${id} · ${s} · ${ev.score} · ${(ev.tokens / 1e6).toFixed(2)}M tokens${ev.quotaPct !== null && ev.quotaPct !== undefined ? ` ${pct} de la cuota (${how})` : ''}${fresh}${ask}`;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const run = () => {
    if (done) return;
    done = true;
    let parsed = null;
    try {
      const h = parseHook(input, agent);
      if (!h) return; // Claude Code's hook run by Cursor: Cursor's own hook does the work
      parsed = h;
      if (h.waymark_probe) { process.stdout.write(PROBE_OK); return; } // waymark.mjs check: this hook runs from where it is registered
      // a session with no status line (the desktop app): what it spent, so the quota's rises are split with it too
      try { if (agent.name === 'claude') recordSpend(h.session_id, h.transcript_path); } catch (e) { logHookError('stop-hook spend', e); }
      const cwd = h.cwd || process.cwd(), home = projectHome(cwd);
      try { loadKnownValues(home.root); } catch {} // what the project's .env files hold is masked in everything this hook writes (docs/adr/0045)
      // read back to the task's start (its first prompt), so a task of many prompts or megabytes keeps its start in view
      const lines = readTurns((bytes) => agent.read(h, bytes), 3, 4 * 1024 * 1024, undefined, taskStart(readRecords(home.log), h.session_id));
      const prompts = lines.filter(isPrompt).map(promptText).slice(-3); // this task: the current prompt and the two before it
      // A turn counts from its prompt, or from this session's last close when that is later (a background notification
      // resumed the session after the close).
      const since = Date.parse(readRecords(home.log).filter((r) => r.session === h.session_id).pop()?.at || '') || 0;
      // A skill or agent still running in the background: the turn is not over (no block, no record); it closes in the
      // notification's turn, which reads the whole stretch from the task's prompt. A reply that already carries its
      // Cierre is the end of the task: judged now.
      h.last_assistant_message ??= h.prompt_response; // Gemini CLI's AfterAgent names the last reply prompt_response
      if (pendingBackground(lines, since).length && !CIERRE_HEAD.test(String(h.last_assistant_message || '').replace(/\*\*|__/g, ''))) return;
      h.last_assistant_message = effectiveReply(currentTurn(lines, since).texts, h.last_assistant_message); // one Cierre per task
      const claimed = String(h.last_assistant_message || '').replace(/\*\*|__/g, '').match(/^[ \t]*##\s*Cierre\s*·\s*(.+)/m)?.[1]?.match(ID)?.[0];
      // the stretch since this session's last close holds the decisions; a follow-up's task reaches back to its start
      const records = readRecords(home.log);
      const stretch = taskLines(lines, { since: taskStart(records, h.session_id) }), task = taskLines(lines, { since: taskStart(records, h.session_id, claimed) });
      const turn = currentTurn(lines, since), ctx = { ids: taskIds(cwd), resumed: since > 0 && turn.startedAt <= since, decisions: decisionsIn(stretch), taskFiles: (id) => new Set(taskFiles(records, id).map(norm)), records, memoryFile: home.memory.replace(/\\/g, '/'), slug: home.slug, session: h.session_id, lacks: agent.lacks, agent: agent.name, outside: true, blocked: !!h.stop_hook_active, cwd };
      ctx.commits = commitsFor(cwd, claimed);
      try { ctx.trailered = turnCommits(turn.tools, cwd, claimed, ctx.ids, turn.startedAt || 0); } catch {} // another repo, an earlier task's ID
      try { ctx.packed = packedFiles(h.session_id, taskStart(records, h.session_id)).size; } catch {} // Recordar handed over by the pre/after-tool hook
      try { ctx.procDelivered = [...procDelivered(h.session_id, taskStart(records, h.session_id))]; } catch {} // the owner's procedures.md, handed over the same way
      ctx.sessionDepts = records.filter((r) => r.session === h.session_id).flatMap((r) => r.department?.invoked || []); // loaded earlier in this session
      ctx.pedido = pedidoItems(task); // the numbered items of the Pedido line the agent wrote (L2+): what the Cierre owes an answer to
      ctx.inputs = turnInputs(taskLines(lines, { prompts: 1 }), cwd, agent.instructions);
      try { const e = engramInput(); if (e) ctx.inputs.engram = e; } catch {} // the learned layer's version (docs/adr/0036); a record without engram keeps its old shape
      ctx.gitChanged = turnChanged(h.session_id, cwd); // from the per-prompt snapshot, and other repos' from the pre-tool hook
      ctx.inherited = inheritedRoute(lines); // an unrouted reply inside an open task keeps its routing
      ctx.engram = lines.some((d) => JSON.stringify(d.attachment || '').includes('mcp__engram__') || (d.message?.content || []).some?.((c) => c.type === 'tool_use' && String(c.name).startsWith('mcp__engram__')));
      const all = sessionTools(lines);
      ctx.taskTools = sessionTools(task); // the task's tool calls (review)
      ctx.stretchTools = sessionTools(stretch); // since the last close (decision)
      // testigos that execute (testigos.mjs): the repo typecheck when the agent ran no gate, secrets in what the task
      // wrote, and the chain (with its notes) as it stands before this record
      let rerun = null;
      ctx.rerun = (files) => (rerun ??= rerunGate(files, home)); // once per close, even when the turn is judged twice
      ctx.noBuild = buildNone(home.memory);
      try { ctx.owned = ownedSteps([home.memory, path.join(waymarkHome(), 'preferences.md')].map((f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n')); } catch {} // the user's own steps: their words, written in Conventions
      try { ctx.copyInstall = copyInstall(stackOf(home.root)); } catch {}
      ctx.root = home.root;
      // every commit of the turn, with or without a trailer and in any repo it committed in, besides the task's own
      let turnAll = [];
      try { if (turn.startedAt) turnAll = turnCommitsAll(turn.tools, cwd, turn.startedAt); } catch (e) { logHookError('stop-hook commits', e); }
      ctx.scanSecrets = (files) => secretSources(files, [...ctx.commits.filter((c) => !turnAll.some((x) => x.h === c)), ...turnAll], cwd, home.memory, turn.startedAt);
      ctx.chain = verifyChain(records, records.some(gitNote) ? readNotes(cwd) : null, anchorsFor(cwd));
      let gaps = cierreGaps(turn, h.last_assistant_message, all, prompts, ctx);
      if (gaps?.renamed) { // a new task after all: judged over its own stretch, not the claimed task's
        ctx.taskTools = ctx.stretchTools;
        gaps = cierreGaps(turn, h.last_assistant_message, all, prompts, ctx);
      }
      const meta = { agent: agent.name, session: h.session_id, cwd };
      // a question opens no task and takes no ID: a "## Cierre · <ID>" in its answer names a task that is not recorded, and the next turn then guesses
      // another ID for it. Sent back once, to answer without it.
      if (!gaps && claimed && !h.stop_hook_active && routedLevel(turn.texts, turn.tools) === 'Q') {
        answer(agent, agent.out.block(`Waymark: this turn was routed as a question (Q): it opens no task and has no ID, so "Cierre · ${claimed}" names a task that is not recorded. Answer again without the Cierre block (an "Aprendido:" line at the end is saved).`));
        return;
      }
      if (!gaps) { // the turn ended: no longer open; a question leaves its short record where the project has memory
        const q = fs.existsSync(home.memory) ? questionRecord(turn, { ...meta, last: h.last_assistant_message }) : null;
        // the next task counts from its own prompt: a question, an L0 or an unrouted turn ended with no task (a routed task
        // that stopped before its first change keeps its start)
        const lvl = routedLevel(turn.texts, turn.tools) || ctx.inherited?.level;
        try { if (q) appendRecord(cwd, q); if (q || !(typeof lvl === 'number' && lvl > 0)) { clearStart(h.session_id); clearTaskStart(h.session_id); } } catch (e) { logHookError('stop-hook question', e); }
        try { if (q?.learned && home.dir && !home.legacy) saveQuestion(home, q); } catch (e) { logHookError('stop-hook engram', e); }
        try { refreshTasks(home, closeOpen(home, h.session_id) || !!q); } catch {}
        try { const n = notesChecked(h.session_id); if (n) answer(agent, agent.out.notice(n)); } catch (e) { logHookError('stop-hook notes check', e); } // after a notes block
        return;
      }
      // a reply with no Cierre that ends asking the user, with options: the task is in progress (a pause, not an end); the
      // next prompt keeps this turn's snapshot and the task's start, and the turn that ends it is judged
      if (pausedReply(h.last_assistant_message)) { try { markPaused(h.session_id); } catch {} return; }
      if (gaps.missing.length && !h.stop_hook_active) {
        answer(agent, agent.out.block(blockReason(gaps)));
        return;
      }
      gaps.observed.branches = branchesOf(gaps.changed);
      // the turn's tokens plus those of the subagents it launched (a background code-review)
      // the % measured by Claude Code's status line (the quota it reads is Claude's: never another agent's task)
      let measured = null;
      try { if (agent.name === 'claude') measured = measure(h.session_id); } catch {}
      const evaluation = evaluate(gaps, withSubagents(turnUsage(lines, since), subagentUsage(h.transcript_path, turn.startedAt)), ctx.inputs?.model || null, measured, turnLinks(lines, since));
      const rec = provenanceRecord(turn, gaps, ctx, { ...meta, evaluation, cost: { v: 1, byCall: costByCall(lines, since) } });
      try { rec.pinned = pinnedRules({ dept: gaps.dept?.declared, root: home.root, reads: all.map((t) => String(t.input?.file_path || t.input?.command || '')) }); } catch (e) { logHookError('stop-hook pinned', e); } // the rules that governed the task, by hash
      try { const p = takePrecedent(h.session_id); if (p) { rec.precedent = { task: p.task, score: p.score, chars: p.chars, files: p.files.length, used: usedOf(p, turn) }; keepPrecedent(h.session_id, null); } } catch (e) { logHookError('stop-hook precedent', e); } // what the first prompt was handed, and whether the task used it
      try { const den = deniedSince(h.session_id, turn.startedAt || 0); if (den.length) rec.denied = den.map((d) => ({ tool: d.tool, path: d.path, at: new Date(d.at).toISOString() })); } catch (e) { logHookError('stop-hook denied', e); } // what the sensitive-path guard stopped
      try { if (ctx.commits?.length) rec.signatures = commitSignatures(home.root, ctx.commits.slice(0, 10)); } catch (e) { logHookError('stop-hook signatures', e); } // git's verdict on each commit: signed, untrusted, bad, unsigned
      try { const repos = taskRepos(ctx.taskTools, cwd, home.root, rec.id); if (repos.length) rec.repos = repos; } catch (e) { logHookError('stop-hook repos', e); } // its note goes in each
      try { if (home.dir && !home.legacy) ensureLocal(home); } catch {} // excluded from git before anything is written there
      // a clean copy never outlives its task: the ones this task made in Waymark's root are removed now and the removal is checked
      let copiesNote = '';
      try { const c = closeCopies(taskStart(records, h.session_id, claimed) || turn.startedAt || Date.now() - 6 * 3600000, cwd); if (c.removed.length || c.left.length) copiesNote = ` · copias limpias: ${c.removed.length} retirada${c.removed.length === 1 ? '' : 's'}${c.left.length ? `, ${c.left.length} sin poder retirar (${c.left.map((p) => path.basename(p)).join(', ')}: \`waymark.mjs copy --clean\`)` : ''}`; } catch (e) { logHookError('stop-hook copies', e); }
      try { appendRecord(cwd, rec); clearStart(h.session_id); clearTaskStart(h.session_id); } catch (e) { logHookError('stop-hook record', e); }
      try { for (const { root, record } of touchedRepos(gaps.changed, home.root, rec, home.slug)) { appendRecord(root, record); refreshTasks(projectHome(root), true); } } catch (e) { logHookError('stop-hook touched', e); } // each other project it changed files in hears of it
      try { expireGrants(rec.id); } catch (e) { logHookError('stop-hook grants', e); } // a permission given for this task ends with it (docs/adr/0045)
      try { // a clean measure calibrates the estimate (Codex, OpenCode, a session without the status line)
        const u = evaluation.usage;
        if (measured && !measured.shared && measured.pct > 0 && evaluation.tokens) appendPair({ task: rec.id, project: home.slug, model: evaluation.model, agent: ctx.inputs?.agent || null, pct: measured.pct, total: evaluation.tokens, ...(u ? { fresh: (u.input || 0) + (u.cacheWrite || 0) + (u.output || 0), cacheRead: u.cacheRead } : {}), by: 'measured' });
      } catch {}
      // a commit this turn may carry an earlier task's trailer (its work committed now): that record becomes its note
      try { if (turn.tools.some((t) => shell(t) && /\bgit\b[^|;&\n]*\scommit\b/.test(bare(t)))) noteLateCommits(home.root, readRecords(home.log)); } catch {}
      try { if (home.dir && !home.legacy) saveLearned(home, rec); } catch (e) { logHookError('stop-hook engram', e); } // the learned layer: engram, written here, never by the agent
      // the agent pushed (the user asked): in each repo it pushed whose project the user said yes for (`Notes push:`,
      // docs/adr/0035, 0042), the notes the remote lacks go to the same remote, this task's included; with no yes they stay
      // local. A push the hook's process cannot make blocks once, after the record (testigo "notes")
      let pushed = '';
      const failed = [];
      try {
        for (const { root, remote } of pushedRepos(turn.tools, turn.results, cwd)) {
          if (pushPref(projectHome(root).slug) !== 'yes' || !shouldPushNotes(root, remote)) continue;
          const r = pushNotes(root, remote), where = sameDir(root, home.root) ? '' : ` (${path.basename(root)})`;
          if (r.ok) pushed += ` · notas subidas a ${remote}${where}`;
          else failed.push({ root, remote, output: gitError(r.output) });
        }
      } catch (e) { logHookError('stop-hook notes push', e); }
      // the user said yes for this project (docs/adr/0035): its notes go to origin at every close, with no prompt, never blocking
      try { if (home.dir && !home.legacy) { const a = autoPushNotes(home.root, home.slug); if (a.state === 'pushed') pushed += ` · notas subidas a ${a.remote}`; else if (a.state === 'failed') pushed += ` · notas sin subir (${gitError(a.output).slice(0, 60)}): se reintenta en el próximo cierre`; } } catch (e) { logHookError('stop-hook notes auto push', e); }
      let notesStop = '';
      if (failed.length) {
        pushed += ` · notas sin subir: ${failed.map((f) => path.basename(f.root)).join(', ')}`;
        const all = readPending();
        if (all[h.session_id]?.id !== rec.id) { all[h.session_id] = { id: rec.id, repos: failed.map(({ root, remote }) => ({ root, remote })) }; writePending(all); notesStop = notesBlock(failed); }
      }
      try { writeTaskLine(home, rec); } catch (e) { logHookError('stop-hook memory', e); } // the task's Work in progress line, from its Aprendido
      try { if (home.dir && !home.legacy) learn(home, rec, readTaskRecords(home)); } catch (e) { logHookError('stop-hook learn', e); } // what it observed: gates, areas, procedures (docs/adr/0023)
      try { if (home.dir && !home.legacy) syncIdentity(home.memory, stackOf(home.root)); } catch {} // Identity names the repo's package manager
      try { saveSnapshot(h.session_id, cwd); } catch {} // a turn resumed without a prompt diffs from this close, not the last prompt
      try { closeOpen(home, h.session_id, rec.id); } catch {}
      try { refreshTasks(home, true); } catch (e) { logHookError('stop-hook tasks', e); } // tasks.md: where the work stands, for any agent (docs/adr/0007)
      let context = 0;
      try { context = sessionState(lines).context; } catch {}
      const moved = gaps.renamed ? ` · registrada como ${rec.id}: ${gaps.renamed.from} no toca archivos de ${gaps.renamed.from.replace(/[a-z]$/, '')}` : '';
      let ask = true; // a Claude session the status line watches is measured: the close never asks its %
      try { ask = !(agent.name === 'claude' && watched(h.session_id)); } catch {}
      answer(agent, notesStop ? agent.out.block(notesStop) : agent.out.notice(summaryLine(rec.id, evaluation, context, { ask }) + moved + pushed + nativeMemoryNote(nativeMemoryWrites(turn.tools)) + copiesNote + confirmAsk(rec)));
    } catch (e) {
      logHookError('stop-hook', e);
      // a turn the hook could not judge leaves a record that says so, and the user sees it: never silence
      try {
        const cwd = parsed?.cwd || process.cwd();
        if (parsed && fs.existsSync(projectHome(cwd).memory)) appendRecord(cwd, unevaluatedRecord(e, { agent: agent.name, session: parsed.session_id, cwd }));
        if (parsed) answer(agent, agent.out.notice(`Waymark: este turno no se evaluó (${String(e?.message || e).slice(0, 80)}); la causa está en ~/.waymark/hook-errors.log`));
      } catch (e2) { logHookError('stop-hook unevaluated', e2); }
    }
  };
  readStdin((text) => { input = text; run(); });
}
