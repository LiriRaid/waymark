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
//   it leaves a trace without taking a T<n>.
// It never blocks twice in a row (stop_hook_active). Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CIERRE, pendingBackground, subagentUsage, withSubagents, currentTurn, routedLevel, routedDept, inheritedRoute, readTurns, isPrompt, promptText, sessionTools, readSomething, turnUsage, sessionState } from './transcript.mjs';
import { estimate } from './calibrate.mjs';
import { agentFrom } from './agents/index.mjs';
import { ID, taskIds, validId, taskLines, taskStart, taskFiles, decisionsIn, appendRecord, turnInputs, commitsFor, changesProject, shellSkeleton, gitSnapshot, snapshotDiff, loadSnapshot, saveSnapshot, projectHome, refreshTasks, ensureLocal, closeOpen, readRecords, maskSecrets, recordedDecisions, deepMask, verifyChain, readNotes, writeTaskLine, gitNote } from './provenance.mjs';
import { rerunGate, secretSources, secretHits, buildNone } from './testigos.mjs';
import { stackOf, syncIdentity } from './stack.mjs';
import { pushNotes, noteLateCommits } from './notes.mjs';
import { saveLearned } from './engram.mjs';
import { packedFiles } from './tool-hook.mjs';

const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
const exempt = (file) => {
  const f = norm(file), home = norm(os.homedir());
  return f.startsWith(`${home}/.waymark/`) || f.includes('/.waymark/') || f.includes('/.claude/projects/') || f.includes('/appdata/local/temp/') || f.startsWith('/tmp/') || f.includes('/scratchpad/');
};
const EDITS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
const UI = /\.(html|css|scss|sass|less|tsx|jsx|vue|svelte|astro)$|\.component\.ts$/i;
const NOT_CODE = /\.(md|mdx|txt|json|ya?ml|toml|ini|env|lock|csv|svg|png|jpe?g|gif)$/i;
const SPEC = /\.(spec|test)\.[cm]?[jt]sx?$|_spec\.rb$|_test\.(go|py)$|^test_.*\.py$/i;
const TEST = /\b(test|tests|vitest|jest|karma|mocha|pytest|rspec|go test|dotnet test|mvn test|gradle test)\b/i;
const GATE = /\b(tsc|typecheck|type-check|lint|eslint|ng build|build|go vet|mypy|ruff|rubocop|cargo (check|clippy)|node --check)\b/i;
const MEMORY_FILE = /[\\/]\.waymark[\\/](projects[\\/][^\\/]+\.md|memory\.md)$/i; // <project>/.waymark/memory.md or the pre-0007 ~/.waymark/projects/<slug>.md (tasks.md is generated)
const BUILD = /\b(ng build|vite build|next build|nuxt build|astro build|(npm|pnpm|yarn|bun)( run)? build|go build|cargo build|dotnet build|mvn (package|verify)|gradle build|tsc -b)\b/i;
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
// The command as the shell runs it: heredoc bodies and here-strings blanked, so a spec written through `cat > x.spec.ts <<'EOF'`
// is not a test or gate run.
const bare = (t) => shellSkeleton(cmdOf(t), { quotes: false });
// A follow-up ID (with a letter) holds only when the turn changes a file its task already changed, so an unrelated task
// never inherits another task's answers. Not checked without records or without changes.
const followUpShares = (id, changed, ctx) => !/[a-z]$/.test(id) || !ctx.taskFiles || !changed.length || (() => { const own = ctx.taskFiles(id); return changed.some((f) => own.has(norm(f))); })();
const skillCalled = (tools, re) => tools.some((t) => t.name === 'Skill' && re.test(String(t.input.skill || '')));
// The review: the code-review skill, or `waymark.mjs review <files>` where the agent has none (Codex, Gemini CLI, OpenCode).
const reviewed = (tools) => skillCalled(tools, /(^|:)code-review$/) || tools.some((t) => shell(t) && /waymark\.mjs["']?\s+review\s+\S/.test(cmdOf(t)));

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
// "<Field>: omitido (usuario: "<words>")": the words are in the user's messages or are a whole option they picked (a
// fragment of the option that accepted the check, e.g. "navegador", does not count).
function userSkip(reply, field, prompts, labels = []) {
  const m = reply.match(new RegExp(`${field}:\\s*omitido \\(usuario:\\s*[“"«]([^”"»]{3,200})[”"»]`, 'i'));
  if (!m) return null;
  const q = plain(m[1]);
  return prompts.some((p) => plain(p).includes(q)) || labels.some((l) => l === q || l.replace(/\s*\(recomendad[oa]\)$/, '') === q) ? 'ok' : m[1];
}
// A Cierre field: its line; a value that ends with ":" continues on the next lines up to the next field ("Evidencia:"
// with what was seen below it). An empty field never takes the next line. Decisión and Sub-decisiones are not read but
// still end a field an older Cierre spreads over several lines.
const FIELD = /^\s*(?:[-*]\s*)?(?:Resultado|Decisi[oó]n|Sub-?decisiones|Evidencia|Aprendido|Tests|Review|Build|Secretos)\s*:/i;
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
  return `Waymark: this L${gaps.level} turn changed files and is missing: ${gaps.missing.map((m, i) => `${i + 1}) ${m}`).join(' ')}. Do what is missing (or correct the field), then reply with the completed Cierre only.`;
}

// → null (no project files changed, L0) or { level, changed, reply, missing[] (blocks), findings[] (recorded), dept, observed }.
export function cierreGaps(turn, last, allTools = turn.tools, prompts = [turn.prompt], ctx = {}) {
  const byKey = new Map();
  for (const f of [...turn.tools.filter((t) => EDITS.test(t.name)).map(fileOf), ...(ctx.gitChanged || [])]) if (f && !exempt(f) && !byKey.has(norm(f))) byKey.set(norm(f), f);
  const changed = [...byKey.values()];
  // A task with a Cierre whose changes are all outside the project (install, cleanup) is recorded too (ctx.outside):
  // a Cierre heading at the start of a line, in a turn routed L1–L3 — never a Q turn.
  const lastText = String(last || '').replace(/\*\*|__/g, '');
  const earlyLevel = routedLevel([...turn.texts, lastText], turn.tools) || ctx.inherited?.level || 0;
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
  const lastCode = lastIdx((t) => (EDITS.test(t.name) && !exempt(fileOf(t)) && !NOT_CODE.test(fileOf(t))) || shellChange(t));
  const lastSpec = lastIdx((t) => EDITS.test(t.name) && SPEC.test(path.basename(fileOf(t))));
  const lastChange = lastIdx(isChange);
  const result = (t) => turn.results?.[t.id];
  // the procedure counts as read first only before the first change that happened (an edit the gate denied changed nothing)
  const firstRealChange = allTools.findIndex((t, i) => i >= base && isChange(t) && !(result(t)?.error || t.error));
  const procBeforeChange = allTools.some((t, i) => procRe.test(where(t)) && readSomething(t) && (firstRealChange < 0 || i < firstRealChange));
  const secs = (t) => (result(t)?.at && t.at ? Math.max(0, (result(t).at - t.at) / 1000) : null);
  // A command that writes Waymark's own memory is not a gate, even when its text says "build" or "tests".
  // Each part of a chained command (&&, ;, |) is judged alone: "npx tsc --noEmit && grep T1 .waymark/memory.md" is a gate.
  // A part after a `cd` into a .waymark folder runs in Waymark's own memory, so it is no gate either.
  const parts = (t) => {
    const all = bare(t).split(/&&|\|\||[;|\n]/), inside = all.findIndex((p) => /^\s*cd\s+["']?[^"'\s]*\.waymark(?=["'\s\\/]|$)/.test(p));
    return (inside >= 0 ? all.slice(0, inside) : all).filter((p) => !/\.waymark[\\/]/.test(p));
  };
  const gateCmd = (t) => shell(t) && parts(t).some((p) => GATE.test(p));
  // Test-first, measured from the spec: the spec written first, run (red) before the next edit of code. Config, scaffolding
  // made by commands (`ng new`, installs) and the spec itself are not the code it tests.
  const codeEdit = (t) => EDITS.test(t.name) && !denied(t) && !exempt(fileOf(t)) && !NOT_CODE.test(fileOf(t)) && !SPEC.test(path.basename(fileOf(t)));
  const firstSpecEdit = allTools.findIndex((t, i) => i >= base && EDITS.test(t.name) && !denied(t) && SPEC.test(path.basename(fileOf(t))));
  const codeBeforeSpec = firstSpecEdit >= 0 && allTools.some((t, i) => i >= base && i < firstSpecEdit && codeEdit(t));
  const codeAfterSpec = firstSpecEdit < 0 ? -1 : allTools.findIndex((t, i) => i > firstSpecEdit && codeEdit(t));
  // A failure of the environment (the command is not found), not of the code: no attempt, no failed gate.
  const envFail = (t) => /is not recognized as an internal or external command|command not found|not recognized as the name of a cmdlet|spawn \S+ ENOENT/i.test(String(result(t)?.text || t.out || ''));
  // Docs: the same gate or test failing twice is retried only after consulting the docs (a docs call after the second
  // failure, before the next run of that command); retrying blind is how a wrong direction repeats.
  const cmdKey = (t) => cmdOf(t).replace(/\s+/g, ' ').trim();
  // An attempt is a run after a code change since the previous run of the same command; a first red run of a new spec,
  // a rerun with nothing changed and a failure of the environment are no failed attempts.
  const failedRuns = new Map(), lastRun = new Map();
  turn.tools.forEach((t, i) => {
    if (!shell(t) || !parts(t).some((p) => GATE.test(p) || TEST.test(p))) return;
    const key = cmdKey(t), from = lastRun.has(key) ? lastRun.get(key) : -1;
    lastRun.set(key, i);
    const attempt = turn.tools.slice(from + 1, i).some((x) => codeEdit(x) || shellChange(x));
    if (attempt && result(t)?.error && !envFail(t)) failedRuns.set(key, [...(failedRuns.get(key) || []), i]);
  });
  const retried = [...failedRuns].filter(([, at]) => at.length >= 2).map(([cmd, at]) => {
    const next = turn.tools.findIndex((t, i) => i > at[1] && shell(t) && cmdKey(t) === cmd);
    return { cmd, docs: turn.tools.some((t, i) => i > at[1] && (next < 0 || i < next) && DOCS(t)), late: next >= 0 };
  });
  const gatesAfter = turn.tools.slice(Math.max(lastChange, lastCode) + 1).filter((t) => shell(t) && parts(t).some((p) => GATE.test(p) || TEST.test(p)));
  // UI: templates and styles, `.component.ts`, and a `.ts` with a sibling `.html` (Angular 20+ names drop the suffix)
  const ui = changed.some((f) => UI.test(f) || (/\.ts$/i.test(f) && !SPEC.test(path.basename(f)) && fs.existsSync(f.replace(/\.ts$/i, '.html'))));
  const code = changed.filter((f) => !NOT_CODE.test(f));
  // "build | none" holds for the project that declares it: code changed in another repo still needs its build
  const noBuild = !!ctx.noBuild && (!ctx.root || code.every((f) => norm(f).startsWith(norm(ctx.root).replace(/\/$/, '') + '/')));
  // The choice window waiting for the user is the user's time, not the agent's (a question left open overnight would
  // make a 2-minute turn read hours): kept apart as userWait, out of minutes and the slowest step.
  const ASK = (t) => t.name === 'AskUserQuestion';
  const timed = turn.tools.filter((t) => secs(t) !== null && !ASK(t));
  const userWait = turn.tools.filter((t) => ASK(t) && secs(t) !== null).reduce((a, t) => a + secs(t), 0);
  const slowest = [...timed].sort((a, b) => secs(b) - secs(a))[0];
  const observed = {
    memory: {
      // Waymark's own memory (pack, memory, tasks, or reading .waymark/memory.md) or engram's search, if the user has it
      // or the hook handed the pack over at the first edit (docs/adr/0015)
      searched: (ctx.packed || 0) > 0 || before((t) => /mcp__engram__mem_(search|context)/.test(t.name) || (shell(t) && /waymark\.mjs["']?\s+(pack|memory|tasks)\b/.test(cmdOf(t))) || (t.name === 'Read' && /[\\/]\.waymark[\\/](memory|tasks)\.md$/.test(String(t.input.file_path || '')))),
      opened: before((t) => t.name === 'Read' && /[\\/]\.waymark[\\/]/.test(String(t.input.file_path || ''))),
      // by Edit/Write, or by any tool (a script run through the shell): memory.md changed during the turn and holds the
      // task ID of the Cierre heading
      written: turn.tools.some((t) => EDITS.test(t.name) && MEMORY_FILE.test(fileOf(t))) || memoryHolds(ctx.memoryFile, turn.startedAt, reply.match(/^[ \t]*##\s*Cierre\s*·\s*(.+)/m)?.[1]?.match(ID)?.[0]),
      saved: turn.tools.some((t) => /mem_(save|update|session_summary)/.test(t.name)),
      indexed: turn.tools.some((t) => /mem_(save|update)$/.test(t.name) && /^waymark\/tasks\//.test(String(t.input.topic_key || ''))),
    },
    procedure: { owner: dept.declared, read: [...new Set(procReads.map((t) => (where(t).match(/[\w.-]+[\\/]procedures\.md/) || ['procedures.md'])[0].replace(/\\/g, '/')))], readBeforeChange: procBeforeChange },
    gates: gatesAfter.map((t) => ({ cmd: cmdOf(t).replace(/\s+/g, ' ').slice(0, 140), s: secs(t) === null ? null : Math.round(secs(t)), error: !!result(t)?.error, ...(envFail(t) ? { env: true } : {}) })),
    tests: {
      specsChanged: changed.filter((f) => SPEC.test(path.basename(f))).map((f) => path.basename(f)), ranAfterLastSpec: lastSpec < 0 ? null : turn.tools.slice(lastSpec + 1).some((t) => shell(t) && TEST.test(bare(t))),
      // red: a test run before the first code change, or in a clean copy (git worktree add … && … test)
      red: allTools.some((t, i) => i >= base && shell(t) && TEST.test(bare(t)) && (/git\s+worktree\s+add/.test(cmdOf(t)) || (firstSpecEdit >= 0 && !codeBeforeSpec && i > firstSpecEdit && (codeAfterSpec < 0 || i < codeAfterSpec)))),
    },
    build: noBuild ? { none: ctx.noBuild } : null, // the project declares no build (memory.md Quality gates)
    gate: null, // the gate testigo's run: { by: agent | testigo, cmd, ok, s, from?, timedOut? }
    // testigo "sin secretos": the memory, the task's diff and commits (ctx.scanSecrets, testigos.mjs) and its mem_save calls;
    // where and which kind only, never the value
    secrets: secretHits([...(ctx.scanSecrets ? ctx.scanSecrets(changed) : []), ...turn.tools.filter((t) => /mem_(save|update)$/.test(t.name)).map((t) => ({ where: 'mem_save', text: `${t.input.title || ''}\n${t.input.content || ''}` }))]),
    chain: ctx.chain ? ctx.chain.ok : null,
    browser: { ui, tried: turn.tools.filter((t) => (t.name === 'Skill' && /^(browser-verify|run)$/.test(String(t.input.skill || ''))) || /browser|playwright|chrome/i.test(t.name)).map((t) => t.name === 'Skill' ? t.input.skill : t.name).slice(0, 5) },
    // in this turn, or earlier in the same task: a follow-up that applies the review's findings needs no second review
    review: reviewed(turn.tools) || reviewed(ctx.taskTools || []),
    docs: turn.tools.filter(DOCS).length,
    retried: retried.map((r) => r.cmd.slice(0, 140)), // commands that failed twice (the docs testigo)
    worktree: turn.tools.some((t) => shell(t) && /git\s+worktree\s+add/.test(cmdOf(t))),
    branches: ctx.branches || {},
    time: { minutes: turn.startedAt ? Math.round(Math.max(0, Date.now() - turn.startedAt - userWait * 1000) / 6000) / 10 : null, userWait: Math.round(userWait / 6) / 10, toolMinutes: Math.round(timed.reduce((a, t) => a + secs(t), 0) / 6) / 10, slowest: slowest ? { tool: slowest.name, what: (cmdOf(slowest) || fileOf(slowest) || String(slowest.input.skill || '')).replace(/\s+/g, ' ').slice(0, 100), s: Math.round(secs(slowest)) } : null },
  };

  // ---- Each step of the routine contract (waymark/routine.json): does it apply, did it pass, why not ----
  const chosenLabels = (ctx.decisions || []).flatMap((x) => String(x.chosen).split(',')).map(plain).filter(Boolean);
  const skip = {}, extras = [];
  for (const f of ['Tests', 'Review']) {
    const s = userSkip(reply, f, prompts, chosenLabels);
    if (s === 'ok') skip[f] = true;
    else if (s) extras.push(`${f}: skip quoted as the user's ("${s}") but those words are not in the user's messages nor an option they picked`);
  }
  const hasCierre = CIERRE.test(reply);
  // The exception lines (Tests: no, Build: no, no comprobado, Secretos: no) answer a block: written before the hook
  // blocked, a preventive one would cancel a real block. Read only in the reply that follows the block (stop_hook_active).
  const exc = ctx.blocked ? reply : '';
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
  // Testigo gate: the exit of the agent's last gate after its last code change; with none, the repo typecheck the hook
  // re-runs (ctx.rerun, testigos.mjs: 40 s, never the full build). A failing gate blocks once; "no comprobado (<why>)"
  // says the failure is not this task's.
  const gate = [];
  if (lastCode >= 0) {
    const mine = turn.tools.slice(lastCode + 1).filter((t) => gateCmd(t) && !envFail(t)).pop(); // a gate that never ran checked nothing
    const rerun = () => { const r = ctx.rerun ? ctx.rerun(code) : null; return r && { by: 'testigo', ...r }; };
    // The exit belongs to the gate only when the gate is the command's last part: "build | grep -i error" exits 1 on a
    // clean build. A failure the gate may not own is decided by the hook's own typecheck (none: not held against it).
    const tail = (mine ? bare(mine) : '').split(/&&|\|\||[;|\n]/).map((p) => p.trim()).filter(Boolean).pop() || '';
    const agentRun = mine && { by: 'agent', cmd: cmdOf(mine).replace(/\s+/g, ' ').slice(0, 140), ok: !result(mine)?.error, s: secs(mine) === null ? null : Math.round(secs(mine)) };
    const run = !mine ? rerun() : agentRun.ok || GATE.test(tail) ? agentRun : rerun() || { ...agentRun, ok: true, exitNotTheGate: true };
    observed.gate = run || null;
    const none = 'no typecheck, lint or build ran after the last code change';
    if (!run) gate.push(`${none}${ctx.rerun ? ' and the repo has no typecheck the hook can run (memory.md Quality gates, package.json, tsconfig)' : ''}: run the project's gate once now (the full one at the end, per repo)`);
    else if (run.timedOut) gate.push(`${none} and the repo typecheck (${run.cmd}) took over 40 s: run the project's gate yourself once now`);
    else if (!run.ok && !/no comprobado \(.{3,}\)/i.test(exc)) gate.push(`the gate after the last code change failed (${run.cmd}${run.by === 'testigo' ? ', re-run by the hook' : ''}): fix it and run it again, or write "no comprobado (<why>)" if the failure is not this task's`);
  }
  if (lastSpec >= 0 && !observed.tests.ranAfterLastSpec) gate.push('a spec changed after the last test run: run that spec again');
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
  }
  const near = code.length ? specsNear(code) : null;
  const committed = turn.tools.some((t) => shell(t) && /\bgit\b[^|;&\n]*\scommit\b/.test(bare(t)));
  const buildAfter = lastCode >= 0 && turn.tools.slice(lastCode + 1).some((t) => shell(t) && BUILD.test(bare(t)));
  const when = {
    engram: !!ctx.engram, code: code.length > 0, build: code.length > 0 && !noBuild, ui, specNear: !!near && !skip.Tests, commit: committed && !!ctx.commits,
    // from what ran, never from words: a gate failed twice, the judged gate failed, a spec and code changed
    repeatedFailure: retried.length > 0, gateFailed: observed.gate?.ok === false,
    specAndCode: observed.tests.specsChanged.length > 0 && code.some((f) => !SPEC.test(path.basename(f))),
  };
  const procedure = [];
  if (routed === 'Q') procedure.push('routed as a question (Q) but changed project files');
  if (!dept.declared) procedure.push('no owner department was invoked: invoke the owner dept-* skill (its SKILL.md) first');
  else if (!dept.invoked.includes(dept.declared)) procedure.push(`${dept.declared} owns the open task but was never invoked`);
  else if (!observed.procedure.read.some((p) => procRe.test(p))) procedure.push(`${dept.declared}/procedures.md never read (a search with no match does not count)`);
  const fails = {
    decision, gate, cierre,
    memory: observed.memory.searched ? [] : ['the project memory was not searched before the first change: run waymark.mjs pack <the changed files> now (what earlier tasks did there), or mem_search if you use engram'],
    review: skip.Review || observed.review ? [] : [`code changed and no review ran: run code-review, or node waymark.mjs review <files> where the agent has no code-review, on the task's files (${code.slice(0, 4).map((f) => path.basename(f)).join(', ')}${code.length > 4 ? '…' : ''})`],
    build: buildAfter || /Build:\s*no \(.{3,}\)/i.test(exc) ? [] : ['L2+ with code: run the build once now, after the last change (or write Build: no (<why>) if the project has none)'],
    docs: retried.filter((r) => !r.docs && !r.late).map((r) => `the same command failed twice (${r.cmd.slice(0, 80)}): consult the docs (library-docs, or the installed package's types/source) before running it again`),
    procedure,
    spec: observed.tests.specsChanged.length || /Tests:\s*no \(/i.test(exc) ? [] : [`${near} sits next to the changed code and no spec was added or changed: add or update it and run it, or write Tests: no (<why no spec can cover it>)`],
    red: observed.tests.red || /Tests:\s*no \(.{3,}\)/i.test(exc) ? [] : ['a spec and code changed, and the spec never ran before the code it tests: show it red now in a clean copy (git worktree add <tmp> HEAD → copy the changed spec there → run it; it must fail), or write "Tests: no (<why it cannot fail first>)"'],
    preexisting: observed.worktree || /no comprobado \(.{3,}\)/i.test(exc) ? [] : ['the gate after the last change failed: if it is not this task\'s, show the same failure in a clean copy now (git worktree add <tmp> HEAD → rerun the failing command there → git worktree remove <tmp>), or write "no comprobado (<why>)"'],
    trailer: ctx.commits?.length ? [] : ['a commit made this turn without the trailer "Waymark-Task: <task ID>"'],
    secrets: observed.secrets.length && !/Secretos:\s*no \(.{3,}\)/i.test(exc) ? [`a secret-like value in ${observed.secrets.slice(0, 3).map((h) => `${h.where}${h.line ? `:${h.line}` : ''} (${h.kind})`).join(', ')}: remove it (and rotate it if it is real), or write "Secretos: no (<why>)" when it is a fake value in a test or fixture`] : [],
    chain: ctx.chain && !ctx.chain.ok ? [`provenance.jsonl chain broken at record ${ctx.chain.at + 1}: ${ctx.chain.note ? 'its git note is missing or was edited (a rebase or amend leaves the note on the old commit)' : 'an earlier record was edited or deleted'} (check: node waymark.mjs testigos)`] : [],
  };
  const steps = ROUTINE.testigos.map((s) => {
    const lacked = (ctx.lacks || []).includes(s.id); // the agent has no capability for it (docs/adr/0009): not applicable
    const applies = s.levels.includes(level) && (!s.when || when[s.when]) && !lacked;
    const why = applies ? fails[s.id] || [] : [];
    return { id: s.id, label: s.label, enforce: s.enforce, applies, pass: applies ? !why.length : null, why, ...(lacked ? { na: ctx.agent || 'agent' } : {}) };
  });
  const missing = steps.filter((s) => s.applies && s.enforce === 'block').flatMap((s) => s.why);
  const findings = [...steps.filter((s) => s.applies && s.enforce !== 'block').flatMap((s) => s.why), ...extras];
  const dec = steps.find((s) => s.id === 'decision');
  if (lateDecision && dec?.applies) { // cannot be undone, so it does not block; the evaluation keeps it
    const why = 'the first choice-window question came after the task\'s first change';
    dec.pass = false; dec.why = [...dec.why, why]; findings.push(why);
  }
  const docsStep = steps.find((s) => s.id === 'docs'), blind = retried.filter((r) => !r.docs && r.late);
  if (docsStep?.applies && blind.length) { // already retried without docs: too late to undo, so recorded, not blocked
    const why = blind.map((r) => `the same command failed twice and ran again without docs (${r.cmd.slice(0, 80)})`);
    docsStep.pass = false; docsStep.why = [...docsStep.why, ...why]; findings.push(...why);
  }
  const proc = steps.find((s) => s.id === 'procedure');
  if (proc?.applies && proc.pass && firstRealChange >= 0 && !observed.procedure.readBeforeChange) { // read only once blocked: too late to guide the change
    const why = 'the owner\'s procedures.md section was read after the task\'s first change';
    proc.pass = false; proc.why = [why]; findings.push(why);
  }
  if (ROUTINE.fallback) findings.push('waymark/routine.json missing or invalid: checked with the minimal catalog (decision, gate, Cierre)');
  const otherFailed = observed.gates.filter((g) => g.error && !g.env && g.cmd !== observed.gate?.cmd); // the judged gate is the gate testigo's
  if (otherFailed.length) findings.push(`a command after the last change failed: ${otherFailed.map((g) => g.cmd.slice(0, 60)).join(' | ')}`);
  return { level, changed, reply, missing, findings, steps, dept, observed, renamed };
}

// Automatic evaluation from the routine contract: ✔/✘ per step that applied (a label with several steps passes only if
// all pass), the score over the applicable steps, tokens and the estimated quota.
export function evaluate(gaps, usage, model = null) {
  const steps = {};
  for (const s of gaps.steps.filter((x) => x.applies)) steps[s.label] = (steps[s.label] ?? true) && s.pass;
  const ok = Object.values(steps).filter(Boolean).length;
  const est = estimate(usage, model); // the user's own pairs per model (calibrate.mjs); none → no %
  const split = usage?.cacheRead !== undefined ? { usage: { input: usage.input, cacheWrite: usage.cacheWrite, cacheRead: usage.cacheRead, output: usage.output } } : {};
  return { steps, score: `${ok}/${Object.keys(steps).length}`, tokens: usage?.total || 0, ...split, model, quotaPct: est.pct, quotaBy: est.by };
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
export function provenanceRecord(turn, gaps, ctx, meta = {}) {
  const claimed = gaps.reply.match(/^[ \t]*##\s*Cierre\s*·\s*(.+)/m)?.[1]?.match(ID)?.[0];
  const ok = claimed && validId(claimed, ctx.ids) && followUpShares(claimed, gaps.changed, ctx);
  return deepMask({ // every string: the strong secret formats masked (testigo "sin secretos")
    id: ok ? claimed : ctx.ids.next, ...(ok ? {} : { idBy: 'hook', ...(claimed ? { claimed } : {}) }), agent: meta.agent || null, at: new Date().toISOString(), session: meta.session, cwd: meta.cwd,
    // Never a secret in the chained record (it cannot be edited later): picked labels only, no free-text answer, and
    // passwords, tokens and keys masked in what is kept as text.
    level: gaps.level, department: gaps.dept, prompt: maskSecrets(String(turn.prompt || '').slice(0, 600)), decisions: recordedDecisions(ctx.decisions),
    files: [...new Set(gaps.changed)],
    observed: gaps.observed,
    evaluation: meta.evaluation,
    commands: turn.tools.filter(shell).map((t) => maskSecrets(cmdOf(t).slice(0, 200))).slice(0, 30),
    skills: [...new Set(turn.tools.filter((t) => t.name === 'Skill').map((t) => String(t.input.skill || '')))],
    inputs: ctx.inputs, commits: ctx.commits || [],
    cierre: maskSecrets((gaps.reply.match(/^[ \t]*##\s*Cierre[\s\S]*/m)?.[0] || '').slice(0, 2000)),
    unresolved: gaps.missing.map(maskSecrets),
    findings: gaps.findings.map(maskSecrets),
  });
}

// The record of a turn routed Q that changed nothing, or null: no task ID, so it never shifts T<n> or the follow-up offered.
export function questionRecord(turn, meta = {}) {
  if (!turn.found || routedLevel(turn.texts, turn.tools) !== 'Q') return null;
  return { kind: 'Q', agent: meta.agent || null, at: new Date().toISOString(), session: meta.session, cwd: meta.cwd, department: routedDept(turn.texts, turn.tools), prompt: maskSecrets(String(turn.prompt || '').slice(0, 600)) };
}

// One line for the user (systemMessage: shown in the UI, not added to the model's context).
// While the model has fewer than 3 calibration pairs (no fit yet), it asks the user for the real %. Past NEW_SESSION
// tokens of context, it says the next task is cheaper in a new session: every response re-reads the whole context, and
// the context card resumes the work there.
export const NEW_SESSION = 200000;
export function summaryLine(id, ev, context = 0) {
  const s = Object.entries(ev.steps).map(([k, v]) => `${k} ${v ? '✔' : '✘'}`).join(' · ');
  const ask = /^(none|default|pairs:[12]|family:.+)$/.test(String(ev.quotaBy || ''))
    ? ` · ¿qué % marcó tu cuota en esta tarea? node "${path.join(path.dirname(fileURLToPath(import.meta.url)), 'calibrate.mjs').replace(/\\/g, '/')}" "${id}" <pct>` : '';
  const fresh = context > NEW_SESSION ? ` · contexto ~${Math.round(context / 1000)}k: la próxima tarea, en una sesión nueva (la tarjeta la retoma)` : '';
  return `Waymark ${id} · ${s} · ${ev.score} · ${(ev.tokens / 1e6).toFixed(2)}M tokens${ev.quotaPct !== null ? ` ≈ ${ev.quotaPct}% de la cuota (${String(ev.quotaBy).startsWith('family:') ? `sin calibrar, factor de ${ev.quotaBy.slice(7)}` : 'estimado'})` : ''}${fresh}${ask}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const run = () => {
    if (done) return;
    done = true;
    try {
      const h = JSON.parse(input);
      const lines = readTurns((bytes) => agent.read(h, bytes), 3, 4 * 1024 * 1024), cwd = h.cwd || process.cwd();
      const prompts = lines.filter(isPrompt).map(promptText).slice(-3); // this task: the current prompt and the two before it
      const home = projectHome(cwd);
      // A turn counts from its prompt, or from this session's last close when that is later (a background notification
      // resumed the session after the close).
      const since = Date.parse(readRecords(home.log).filter((r) => r.session === h.session_id).pop()?.at || '') || 0;
      // A skill or agent still running in the background: the turn is not over (no block, no record); it closes in the
      // notification's turn.
      if (pendingBackground(lines, since).length) return;
      h.last_assistant_message ??= h.prompt_response; // Gemini CLI's AfterAgent names the last reply prompt_response
      const claimed = String(h.last_assistant_message || '').replace(/\*\*|__/g, '').match(/^[ \t]*##\s*Cierre\s*·\s*(.+)/m)?.[1]?.match(ID)?.[0];
      // the stretch since this session's last close holds the decisions; a follow-up's task reaches back to its start
      const records = readRecords(home.log);
      const stretch = taskLines(lines, { since: taskStart(records, h.session_id) }), task = taskLines(lines, { since: taskStart(records, h.session_id, claimed) });
      const turn = currentTurn(lines, since), ctx = { ids: taskIds(cwd), decisions: decisionsIn(stretch), taskFiles: (id) => new Set(taskFiles(records, id).map(norm)), memoryFile: home.memory.replace(/\\/g, '/'), slug: home.slug, lacks: agent.lacks, agent: agent.name, outside: true, blocked: !!h.stop_hook_active };
      ctx.commits = commitsFor(cwd, claimed);
      try { ctx.packed = packedFiles(h.session_id, taskStart(records, h.session_id)).size; } catch {} // Recordar handed over by the pre/after-tool hook
      ctx.sessionDepts = records.filter((r) => r.session === h.session_id).flatMap((r) => r.department?.invoked || []); // loaded earlier in this session
      ctx.inputs = turnInputs(taskLines(lines, { prompts: 1 }), cwd, agent.instructions);
      ctx.gitChanged = snapshotDiff(loadSnapshot(h.session_id), gitSnapshot(cwd)); // taken by the per-prompt hook
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
      ctx.root = home.root;
      ctx.scanSecrets = (files) => secretSources(files, ctx.commits, cwd, home.memory, turn.startedAt);
      ctx.chain = verifyChain(records, records.some(gitNote) ? readNotes(cwd) : null);
      let gaps = cierreGaps(turn, h.last_assistant_message, all, prompts, ctx);
      if (gaps?.renamed) { // a new task after all: judged over its own stretch, not the claimed task's
        ctx.taskTools = ctx.stretchTools;
        gaps = cierreGaps(turn, h.last_assistant_message, all, prompts, ctx);
      }
      const meta = { agent: agent.name, session: h.session_id, cwd };
      if (!gaps) { // the turn ended: no longer open; a question leaves its short record where the project has memory
        const q = fs.existsSync(home.memory) ? questionRecord(turn, meta) : null;
        try { if (q) appendRecord(cwd, q); } catch {}
        try { refreshTasks(home, closeOpen(home, h.session_id) || !!q); } catch {}
        return;
      }
      if (gaps.missing.length && !h.stop_hook_active) {
        process.stdout.write(JSON.stringify(agent.out.block(blockReason(gaps))));
        return;
      }
      gaps.observed.branches = branchesOf(gaps.changed);
      // the turn's tokens plus those of the subagents it launched (a background code-review)
      const evaluation = evaluate(gaps, withSubagents(turnUsage(lines, since), subagentUsage(h.transcript_path, turn.startedAt)), ctx.inputs?.model || null);
      const rec = provenanceRecord(turn, gaps, ctx, { ...meta, evaluation });
      try { if (home.dir && !home.legacy) ensureLocal(home); } catch {} // excluded from git before anything is written there
      try { appendRecord(cwd, rec); } catch {}
      // a commit this turn may carry an earlier task's trailer (its work committed now): that record becomes its note
      try { if (turn.tools.some((t) => shell(t) && /\bgit\b[^|;&\n]*\scommit\b/.test(bare(t)))) noteLateCommits(home.root, readRecords(home.log)); } catch {}
      try { if (home.dir && !home.legacy) saveLearned(home, rec); } catch {} // the learned layer: engram, written here, never by the agent
      // the agent pushed the task (the user asked): its note goes to the same remote, now that it exists
      let pushed = '';
      try {
        const push = turn.tools.filter((t) => shell(t) && /\bgit\b[^|;&\n]*\spush\b/.test(bare(t)) && !turn.results?.[t.id]?.error && !/refs\/notes/.test(cmdOf(t))).pop();
        if (push && (rec.commits || []).length) {
          const remote = cmdOf(push).match(/\bpush\s+(?:-{1,2}[\w-]+\s+)*([\w.-]+)/)?.[1] || 'origin';
          const r = pushNotes(home.root, remote);
          pushed = r.ok ? ` · notas subidas a ${remote}` : ` · notas sin subir (${(r.output.split('\n').pop() || 'error').slice(0, 80)}): waymark.mjs notes push`;
        }
      } catch {}
      try { writeTaskLine(home, rec); } catch {} // the task's Work in progress line, from its Aprendido
      try { if (home.dir && !home.legacy) syncIdentity(home.memory, stackOf(home.root)); } catch {} // Identity names the repo's package manager
      try { saveSnapshot(h.session_id, cwd); } catch {} // a turn resumed without a prompt diffs from this close, not the last prompt
      try { closeOpen(home, h.session_id, rec.id); } catch {}
      try { refreshTasks(home, true); } catch {} // tasks.md: where the work stands, for any agent (docs/adr/0007)
      let context = 0;
      try { context = sessionState(lines).context; } catch {}
      const moved = gaps.renamed ? ` · registrada como ${rec.id}: ${gaps.renamed.from} no toca archivos de ${gaps.renamed.from.replace(/[a-z]$/, '')}` : '';
      process.stdout.write(JSON.stringify(agent.out.notice(summaryLine(rec.id, evaluation, context) + moved + pushed)));
    } catch {}
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', run);
  process.stdin.resume();
  setTimeout(run, 1000).unref();
}
