#!/usr/bin/env node
// Waymark · end-of-turn record and evaluation, the last link of the chain. Registered by install-hooks.mjs as an
// end-of-turn hook (Claude Code: Stop; another agent: same script with `--agent <name>`, docs/adr/0008).
// Runs locally (0 model tokens unless it blocks). Supply chain of the agent's work (docs/adr/0001–0005):
// - What can be observed is COMPUTED from the transcript and git, never declared by the agent (memory, procedure,
//   gates after the last change with time and failure, tests, browser, code-review, docs, branches, time, tokens).
// - The agent writes only `## Cierre · <task ID>`: Resultado · Decisión · Sub-decisiones · Evidencia · Aprendido.
// - What blocks (once, decision "block") and what is only recorded and scored is defined in ONE place: the routine
//   contract waymark/routine.json (docs/adr/0006). Each step has the levels and the condition where it applies; this
//   file only computes whether it passed and why not. The instructions block quotes each block step (tests check it).
// - Then the record is appended to <project>/.waymark/provenance.jsonl (docs/adr/0007; tasks.md regenerated) with an automatic evaluation (routine ✔/✘, score,
//   tokens, estimated quota) and the user sees a one-line summary (systemMessage, 0 model tokens). The record names
//   the agent that did the work.
// - A turn routed Q (analysis only, no change) in a project with memory gets a short record {kind: "Q"} with no task ID
//   (user's choice, 2026-10-03 · T2g): it leaves a trace without taking a T<n>.
// It never blocks twice in a row (stop_hook_active). Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentTurn, routedLevel, routedDept, inheritedRoute, readTurns, isPrompt, promptText, sessionTools, readSomething, turnUsage } from './transcript.mjs';
import { estimate } from './calibrate.mjs';
import { agentFrom } from './agents/index.mjs';
import { ID, taskIds, validId, taskLines, decisionsIn, appendRecord, turnInputs, commitsFor, changesProject, gitSnapshot, snapshotDiff, loadSnapshot, saveSnapshot, projectHome, refreshTasks, ensureLocal, closeOpen, readRecords, maskSecrets, recordedDecisions } from './provenance.mjs';

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
const PRE = /(pre-?existente|preexist|pre-existing|ya (fallaba|exist[ií]a)|fallos? previos?|en c[oó]digo que no cambi)/i;
const MEMORY_FILE = /[\\/]\.waymark[\\/](projects[\\/][^\\/]+\.md|memory\.md)$/i; // <project>/.waymark/memory.md or the pre-0007 ~/.waymark/projects/<slug>.md (tasks.md is generated)
const BUILD = /\b(ng build|vite build|next build|nuxt build|astro build|(npm|pnpm|yarn|bun)( run)? build|go build|cargo build|dotnet build|mvn (package|verify)|gradle build|tsc -b)\b/i;
// The routine contract: what blocks and what is recorded and scored (waymark/routine.json, docs/adr/0006).
// A missing or invalid contract never disables the hook: a minimal contract keeps the chain (decision, gate, Cierre) and
// the record says the contract could not be read.
const FALLBACK = { tokensPerQuotaPct: 1350000, fallback: true, steps: [
  { id: 'decision', label: 'Decision', levels: [1, 2, 3], enforce: 'block' }, { id: 'gate', label: 'Verificar', levels: [1, 2, 3], enforce: 'block' },
  { id: 'cierre', label: 'Cierre', levels: [1, 2, 3], enforce: 'block' }, { id: 'learned', label: 'Aprender', levels: [1, 2, 3], enforce: 'block' }] };
const ROUTINE = (() => { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'routine.json'), 'utf8')); } catch { return FALLBACK; } })();
const DOCS = (t) => (t.name === 'Skill' && /library-docs/.test(String(t.input.skill || ''))) || /^(WebFetch|WebSearch)$/.test(t.name) || /context7|docs?/i.test(t.name) || (t.name === 'Read' && /node_modules|\.d\.ts$/.test(String(t.input.file_path || '')));
const fileOf = (t) => t.input.file_path || t.input.notebook_path || '';
const shell = (t) => /^(Bash|PowerShell)$/.test(t.name);
const cmdOf = (t) => String(t.input.command || '');
const skillCalled = (tools, re) => tools.some((t) => t.name === 'Skill' && re.test(String(t.input.skill || '')));

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
// The git branch is the user's, never an agent sub-decision (3c): an item that starts with it is ignored ("rama develop",
// "work on branch x"); a code branch ("error branch del formulario") is still a decision.
const BRANCH = /^\W*(?:(?:la|en la|work on|on|the)\s+)?(?:rama|branch)\b/i;

// Splits on `sep` outside parentheses and quotes ("a (x; y) → preguntada; b → no preguntada" is two items).
export function splitTop(s, sep = ';') {
  const out = [];
  let depth = 0, quote = '', cur = '';
  for (const ch of String(s || '')) {
    if (quote) { if (ch === quote || (quote === '“' && ch === '”')) quote = ''; }
    else if (ch === '"' || ch === '“') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}

// A Cierre field: its line; a value that ends with ":" continues on the next lines up to the next field (3c test A:
// "Decisión: del usuario, elegida en el choice window:" with the picks below it). An empty field never takes the next line.
const FIELD = /^\s*(?:[-*]\s*)?(?:Resultado|Decisi[oó]n|Sub-?decisiones|Evidencia|Aprendido|Tests|Review|Build|Navegador)\s*:/i;
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
  const gaps = cierreGaps(turn, last, allTools, prompts, ctx);
  if (!gaps?.missing.length) return null;
  return `Waymark: this L${gaps.level} turn changed files and is missing: ${gaps.missing.map((m, i) => `${i + 1}) ${m}`).join(' ')}. Do what is missing (or correct the field), then reply with the completed Cierre only.`;
}

// → null (no project files changed, L0) or { level, changed, reply, missing[] (blocks), findings[] (recorded), dept, observed }.
export function cierreGaps(turn, last, allTools = turn.tools, prompts = [turn.prompt], ctx = {}) {
  const byKey = new Map();
  for (const f of [...turn.tools.filter((t) => EDITS.test(t.name)).map(fileOf), ...(ctx.gitChanged || [])]) if (f && !exempt(f) && !byKey.has(norm(f))) byKey.set(norm(f), f);
  const changed = [...byKey.values()];
  // A task with a Cierre whose changes are all outside the project (install, cleanup) is recorded too (ctx.outside, 3c).
  if (!changed.length && !(ctx.outside && /##\s*Cierre/.test(String(last || '').replace(/\*\*|__/g, '')))) return null;
  const full = String(last || turn.texts[turn.texts.length - 1] || '').replace(/\*\*|__/g, ''); // **Campo:** reads as Campo:
  // Fields and claims are read from the Cierre block only: the prose above it ("la decisión: tuya…", "fallos previos")
  // is not a field (found when the hook read a bullet of the reply as Decisión).
  const reply = full.match(/##\s*Cierre[\s\S]*/)?.[0] || full;
  const routed = routedLevel([...turn.texts, full], turn.tools) || ctx.inherited?.level || 0; // an unrouted reply inside an open task (3c)
  const level = routed === 'Q' ? 2 : routed || (/##\s*Cierre/.test(reply) ? 1 : 0);
  if (!level) return null;

  // ---- Observed (computed, never declared) ----
  const where = (t) => `${t.input.file_path || ''} ${t.input.path || ''} ${t.input.pattern || ''} ${t.input.command || ''}`;
  const base = allTools.length - turn.tools.filter((t) => !t.input.slash).length;
  const gitCode = (ctx.gitChanged || []).some((f) => !exempt(f) && !NOT_CODE.test(f)); // a shell command changed code only if git saw it
  const shellChange = (t) => shell(t) && changesProject(t.input.command) && gitCode;
  const isChange = (t) => (EDITS.test(t.name) && !exempt(fileOf(t))) || shellChange(t);
  const firstChange = allTools.findIndex((t, i) => i >= base && isChange(t));
  const before = (pred) => allTools.some((t, i) => pred(t) && (firstChange < 0 || i < firstChange));
  const dept = { declared: routedDept([...turn.texts, full], turn.tools) || ctx.inherited?.dept || null, invoked: [...new Set(allTools.filter((t) => t.name === 'Skill' && /^dept-/.test(String(t.input.skill || ''))).map((t) => String(t.input.skill)))] };
  const procRe = dept.declared ? new RegExp(`${dept.declared}[\\\\/]procedures\\.md`) : /procedures\.md/;
  const procReads = allTools.filter((t) => /procedures\.md/.test(where(t)) && readSomething(t));
  const lastIdx = (pred) => { for (let i = turn.tools.length - 1; i >= 0; i--) if (pred(turn.tools[i])) return i; return -1; };
  const lastCode = lastIdx((t) => (EDITS.test(t.name) && !exempt(fileOf(t)) && !NOT_CODE.test(fileOf(t))) || shellChange(t));
  const lastSpec = lastIdx((t) => EDITS.test(t.name) && SPEC.test(path.basename(fileOf(t))));
  const lastChange = lastIdx(isChange);
  const result = (t) => turn.results?.[t.id];
  const secs = (t) => (result(t)?.at && t.at ? Math.max(0, (result(t).at - t.at) / 1000) : null);
  const gatesAfter = turn.tools.slice(Math.max(lastChange, lastCode) + 1).filter((t) => shell(t) && (GATE.test(cmdOf(t)) || TEST.test(cmdOf(t))));
  // UI: templates and styles, `.component.ts`, and a `.ts` with a sibling `.html` (Angular 20+ names drop the suffix)
  const ui = changed.some((f) => UI.test(f) || (/\.ts$/i.test(f) && !SPEC.test(path.basename(f)) && fs.existsSync(f.replace(/\.ts$/i, '.html'))));
  const code = changed.filter((f) => !NOT_CODE.test(f));
  // The choice window waiting for the user is the user's time, not the agent's (2026-10-03 · T2m: a question left open
  // overnight made a 2-minute turn read 432 minutes): kept apart as userWait, out of minutes and the slowest step.
  const ASK = (t) => t.name === 'AskUserQuestion';
  const timed = turn.tools.filter((t) => secs(t) !== null && !ASK(t));
  const userWait = turn.tools.filter((t) => ASK(t) && secs(t) !== null).reduce((a, t) => a + secs(t), 0);
  const slowest = [...timed].sort((a, b) => secs(b) - secs(a))[0];
  const observed = {
    memory: {
      searched: before((t) => /mcp__engram__mem_(search|context)/.test(t.name)),
      opened: before((t) => t.name === 'Read' && /[\\/]\.waymark[\\/]/.test(String(t.input.file_path || ''))),
      // by Edit/Write, or by any tool (a script run through the shell, 3c test A): memory.md changed during the turn and
      // holds the task ID of the Cierre heading
      written: turn.tools.some((t) => EDITS.test(t.name) && MEMORY_FILE.test(fileOf(t))) || memoryHolds(ctx.memoryFile, turn.startedAt, reply.match(/##\s*Cierre\s*·\s*(.+)/)?.[1]?.match(ID)?.[0]),
      saved: turn.tools.some((t) => /mem_(save|update|session_summary)/.test(t.name)),
      indexed: turn.tools.some((t) => /mem_(save|update)$/.test(t.name) && /^waymark\/tasks\//.test(String(t.input.topic_key || ''))),
    },
    procedure: { owner: dept.declared, read: [...new Set(procReads.map((t) => (where(t).match(/[\w.-]+[\\/]procedures\.md/) || ['procedures.md'])[0].replace(/\\/g, '/')))], readBeforeChange: before((t) => procRe.test(where(t)) && readSomething(t)) },
    gates: gatesAfter.map((t) => ({ cmd: cmdOf(t).replace(/\s+/g, ' ').slice(0, 140), s: secs(t) === null ? null : Math.round(secs(t)), error: !!result(t)?.error })),
    tests: {
      specsChanged: changed.filter((f) => SPEC.test(path.basename(f))).map((f) => path.basename(f)), ranAfterLastSpec: lastSpec < 0 ? null : turn.tools.slice(lastSpec + 1).some((t) => shell(t) && TEST.test(cmdOf(t))),
      // red: a test run before the first code change, or in a clean copy (git worktree add … && … test)
      red: allTools.some((t, i) => i >= base && shell(t) && TEST.test(cmdOf(t)) && ((firstChange >= 0 && i < firstChange) || /git\s+worktree\s+add/.test(cmdOf(t)))),
    },
    asked: { afterFirstChange: firstChange >= 0 && allTools.some((t, i) => i > firstChange && t.name === 'AskUserQuestion') },
    browser: { ui, tried: turn.tools.filter((t) => (t.name === 'Skill' && /^(browser-verify|run)$/.test(String(t.input.skill || ''))) || /browser|playwright|chrome/i.test(t.name)).map((t) => t.name === 'Skill' ? t.input.skill : t.name).slice(0, 5) },
    // in this turn, or earlier in the same task: a follow-up that applies the review's findings needs no second review
    // (user's choice, 2026-10-03 · T2l)
    review: skillCalled(turn.tools, /(^|:)code-review$/) || skillCalled(ctx.taskTools || [], /(^|:)code-review$/),
    docs: turn.tools.filter(DOCS).length,
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
  const hasCierre = /##\s*Cierre/.test(reply);
  const d = field(reply, 'Decisi[oó]n');
  // Every quoted text of "del usuario …" ("del usuario (\"…\")" or "del usuario, elegida …: \"…\"").
  const quotes = /^del usuario/i.test(d) ? [...d.matchAll(/[“"«]([^”"»]{3,400})[”"»]/g)].map((m) => m[1]) : [];
  const chosenFull = (ctx.decisions || []).map((x) => plain(x.chosen));
  // the quote is the user's words, (part of) a picked label, or a whole multi-select answer "A, B, C" (3c test A)
  const usersWords = (q) => q && (prompts.some((p) => plain(p).includes(plain(q))) || chosenLabels.some((l) => l.includes(plain(q))) || chosenFull.some((c) => c.includes(plain(q)))
    || (q.includes(',') && q.split(',').every((part) => plain(part).length < 3 || chosenLabels.some((l) => l.includes(plain(part))))));
  const decision = [], late = [];
  if (hasCierre) {
    if (!d) decision.push('Decisión: elegida <option> · descartadas <options> (the user\'s pick in the choice window) | del usuario ("<their words>") | única (<why>)');
    else if (/^elegida/i.test(d) && ctx.decisions && !ctx.decisions.length) decision.push('Decisión says "elegida" but no choice-window answer exists in this task: ask with the optimal options (AskUserQuestion), or write del usuario ("<their words>") / única (<why>)');
    else if (/^del usuario/i.test(d) && !quotes.some(usersWords)) decision.push('Decisión: del usuario needs the user\'s own words (or the option they picked) in quotes');
    else if (/^[uú]nica/i.test(d) && !/^[uú]nica \(.{3,}\)/i.test(d)) decision.push('Decisión: única (<why there is only one real option>)');
    else if (!/^(elegida|del usuario|[uú]nica)/i.test(d)) decision.push('Decisión: elegida … · descartadas … | del usuario ("<their words>") | única (<why>)');
    const sub = field(reply, 'Sub-?decisiones');
    if (!sub) decision.push('Sub-decisiones: <each decision taken during the task> → preguntada | del usuario ("<their words>") | no preguntada; … — or "ninguna"');
    else if (!/^ninguna\b/i.test(sub)) {
      // items split on ";" — or on " · " when one part holds several "→" (3c test A: six items read as one)
      const items = splitTop(sub, ';').flatMap((s) => ((s.match(/→/g) || []).length > 1 ? splitTop(s, '·') : [s]))
        .filter((s) => !BRANCH.test(s.split('→')[0])); // the branch is the user's: not counted (3c)
      const alone = items.filter((s) => /→\s*no preguntada/i.test(s));
      // asked after the change it decides: passes, Decision ✘. A later question that only confirms is "confirmada" and passes (3c).
      late.push(...items.filter((s) => /→\s*preguntada tarde/i.test(s)));
      // "→ única (<why>)": a technical step with one real way (fixing the bug it found) is not the user's decision (3c test A)
      const single = items.filter((s) => /→\s*[uú]nica \(.{3,}\)/i.test(s));
      const bad = items.filter((s) => !/→\s*(preguntada|confirmada|del usuario \(|no preguntada|[uú]nica \(.{3,}\))/i.test(s));
      const asked = items.length - alone.length - bad.length - single.length - items.filter((s) => /→\s*del usuario \(/i.test(s)).length + (/^elegida/i.test(d) ? 1 : 0);
      // The block names the three honest ways out (2026-10-03 · T2m: the agent wrote "→ del usuario" for a choice-window
      // answer and "no preguntada" for two technical limits).
      const ways = 'answered by the user in the choice window → preguntada; only one real way (a technical limit, or the fix of a bug you found) → única (<why>); otherwise ask it now with the options (AskUserQuestion), apply the pick and mark it preguntada';
      if (bad.length) decision.push(`Sub-decisiones: each item ends with one marker — "→ preguntada", "→ confirmada", "→ del usuario (\\"<their words>\\")", "→ única (<why there is one real way>)" or "→ no preguntada" — e.g. "texto del botón → preguntada; panel en la esquina → única (un widget no entra en el NodeView)". Fix: ${bad.slice(0, 2).join(' | ')}. For each: ${ways}`);
      if (alone.length) decision.push(`Sub-decisiones taken without asking (${alone.slice(0, 3).join(' | ')}): the user decides every real decision. For each: ${ways}`);
      if (ctx.decisions && asked > ctx.decisions.length) decision.push(`Sub-decisiones and Decisión claim ${asked} decisions asked but the choice window answered ${ctx.decisions.length} in this task: ask the missing ones or mark them honestly`);
    }
  }
  const gate = [];
  if (lastCode >= 0 && !turn.tools.slice(lastCode + 1).some((t) => shell(t) && GATE.test(cmdOf(t)))) gate.push('no typecheck, lint or build ran after the last code change: run the project\'s gate once now (the full one at the end, per repo)');
  if (lastSpec >= 0 && !observed.tests.ranAfterLastSpec) gate.push('a spec changed after the last test run: run that spec again');
  const cierre = [];
  if (!hasCierre) cierre.push('the "## Cierre · <task ID>" block (Resultado · Decisión · Sub-decisiones · Evidencia · Aprendido)');
  else {
    if (!field(reply, 'Resultado')) cierre.push('Resultado: hecho | parcial (<what is missing>) | bloqueado (<why>)');
    if (!field(reply, 'Evidencia')) cierre.push('Evidencia: observada <what you saw> | inferida de <source> (check: <one line for the user>)');
    if (!field(reply, 'Aprendido') || /^ninguno/i.test(field(reply, 'Aprendido'))) cierre.push('Aprendido: <your rewritten Work in progress line> (never "ninguno")');
    if (ctx.ids) {
      const id = reply.match(/##\s*Cierre\s*·\s*(.+)/)?.[1]?.match(ID)?.[0];
      const offer = `${ctx.ids.next} for a new task${ctx.ids.followUp ? `, ${ctx.ids.followUp} for a follow-up of ${ctx.ids.last}` : ''}`;
      if (!id) cierre.push(`the task ID in the heading: "## Cierre · <id>" (${offer})`);
      else if (!validId(id, ctx.ids)) cierre.push(`the heading's task ID ${id} is already recorded or was never offered: use ${offer}`);
    }
  }
  const ev = field(reply, 'Evidencia');
  const redText = `${ev} ${field(reply, 'Tests')}`;
  // about a spec only ("spec en rojo", "rojo→verde", "el test habría fallado"), not a red button
  const redClaim = /\b(specs?|tests?|prueba|suite)\b[^.;\n]{0,80}(\brojo\b|habr[ií]a fallado|\bfallaba\b)|\brojo\s*(→|->|a|y luego)\s*verde/i.test(redText) && !/inferid[ao]/i.test(redText);
  const near = code.length ? specsNear(code) : null;
  const committed = turn.tools.some((t) => shell(t) && /\bgit\b[^|;&\n]*\scommit\b/.test(cmdOf(t)));
  const buildAfter = lastCode >= 0 && turn.tools.slice(lastCode + 1).some((t) => shell(t) && BUILD.test(cmdOf(t)));
  const when = {
    engram: !!ctx.engram, code: code.length > 0, ui, specNear: !!near && !skip.Tests, commit: committed && !!ctx.commits,
    inferredFromDocs: /inferida/i.test(ev) && /(doc|documentaci|documentation|oficial|official|specification|especificaci|spec de)/i.test(ev), preClaim: PRE.test(reply), redClaim,
  };
  const procedure = [];
  if (routed === 'Q') procedure.push('routed as a question (Q) but changed project files');
  if (!dept.declared) procedure.push('the routing line names no owner department');
  else if (!dept.invoked.includes(dept.declared)) procedure.push(`${dept.declared} named in the routing line but never invoked`);
  else if (!observed.procedure.read.some((p) => procRe.test(p))) procedure.push(`${dept.declared}/procedures.md never read (a search with no match does not count)`);
  const fails = {
    decision, gate, cierre,
    learned: hasCierre && field(reply, 'Aprendido') && !observed.memory.written ? [`Aprendido is not in the project memory: write it as the task's Work in progress line (${ctx.memoryFile || '<project>/.waymark/memory.md'}) — the next session, or another agent, resumes from there`] : [],
    memory: observed.memory.searched ? [] : ['L2+: no mem_search before the first change: search engram for past decisions and rejected paths of this area now'],
    index: observed.memory.indexed ? [] : [`engram task index not saved: mem_save the task's line with topic_key waymark/tasks/${ctx.slug || '<slug>'}`],
    review: skip.Review || observed.review ? [] : [`code changed and code-review did not run: run it on the task's files (${code.slice(0, 4).map((f) => path.basename(f)).join(', ')}${code.length > 4 ? '…' : ''})`],
    build: buildAfter || /Build:\s*no \(.{3,}\)/i.test(reply) ? [] : ['L2+ with code: run the build once now, after the last change (or write Build: no (<why>) if the project has none)'],
    docs: observed.docs ? [] : ['Evidencia is inferred from docs but no docs were consulted: consult them (library-docs, or the installed package\'s types/source) and confirm or correct the change'],
    procedure,
    spec: observed.tests.specsChanged.length || /Tests:\s*no \(/i.test(reply) ? [] : [`${near} sits next to the changed code and no spec was added or changed: add or update it and run it, or write Tests: no (<why no spec can cover it>)`],
    red: observed.tests.red ? [] : ['a red claim (rojo / habría fallado) with no test run before the first code change or in a clean worktree: run it there, or write it as inferida'],
    preexisting: observed.worktree || /no comprobado/i.test(reply) ? [] : ['a failure called pre-existing without a clean-copy check: check it now (git worktree add <tmp> HEAD → rerun the failing command there → git worktree remove <tmp>), or write "no comprobado (<why>)"'],
    trailer: ctx.commits?.length ? [] : ['a commit made this turn without the trailer "Waymark-Task: <task ID>"'],
  };
  const steps = ROUTINE.steps.map((s) => {
    const lacked = (ctx.lacks || []).includes(s.id); // the agent has no capability for it (docs/adr/0009): not applicable
    const applies = s.levels.includes(level) && (!s.when || when[s.when]) && !lacked;
    const why = applies ? fails[s.id] || [] : [];
    return { id: s.id, label: s.label, enforce: s.enforce, applies, pass: applies ? !why.length : null, why, ...(lacked ? { na: ctx.agent || 'agent' } : {}) };
  });
  const missing = steps.filter((s) => s.applies && s.enforce === 'block').flatMap((s) => s.why);
  const findings = [...steps.filter((s) => s.applies && s.enforce !== 'block').flatMap((s) => s.why), ...extras];
  const dec = steps.find((s) => s.id === 'decision');
  if (late.length && dec?.applies) { // cannot be undone, so it does not block; the evaluation keeps it
    const why = `preguntada tarde (asked after the change it decides): ${late.slice(0, 3).join(' | ')}`;
    dec.pass = false; dec.why = [...dec.why, why]; findings.push(why);
  } else if (observed.asked.afterFirstChange && hasCierre && !/→\s*confirmada/i.test(field(reply, 'Sub-?decisiones'))) findings.push('a choice-window question came after the first change and no sub-decision says "confirmada" or "preguntada tarde": check it was asked before applying what it decided');
  if (ROUTINE.fallback) findings.push('waymark/routine.json missing or invalid: checked with the minimal contract (decision, gate, Cierre)');
  if (observed.gates.some((g) => g.error)) findings.push(`a gate after the last change failed: ${observed.gates.filter((g) => g.error).map((g) => g.cmd.slice(0, 60)).join(' | ')}`);
  return { level, changed, reply, missing, findings, steps, dept, observed };
}

// Automatic evaluation from the routine contract: ✔/✘ per step that applied (a label with several steps passes only if
// all pass), the score over the applicable steps, tokens and the estimated quota.
export function evaluate(gaps, usage, model = null) {
  const steps = {};
  for (const s of gaps.steps.filter((x) => x.applies)) steps[s.label] = (steps[s.label] ?? true) && s.pass;
  const ok = Object.values(steps).filter(Boolean).length;
  const est = estimate(usage, model, ROUTINE.tokensPerQuotaPct || 1350000); // the user's own pairs per model (calibrate.mjs)
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
  const claimed = gaps.reply.match(/##\s*Cierre\s*·\s*(.+)/)?.[1]?.match(ID)?.[0];
  const ok = claimed && validId(claimed, ctx.ids);
  return {
    id: ok ? claimed : ctx.ids.next, ...(ok ? {} : { idBy: 'hook' }), agent: meta.agent || null, at: new Date().toISOString(), session: meta.session, cwd: meta.cwd,
    // Never a secret in the chained log (it cannot be edited later, 3c test A): picked labels only, no free-text answer,
    // and passwords, tokens and keys masked in what is kept as text.
    level: gaps.level, department: gaps.dept, prompt: maskSecrets(String(turn.prompt || '').slice(0, 600)), decisions: recordedDecisions(ctx.decisions),
    files: [...new Set(gaps.changed)],
    observed: gaps.observed,
    evaluation: meta.evaluation,
    commands: turn.tools.filter(shell).map((t) => maskSecrets(cmdOf(t).slice(0, 200))).slice(0, 30),
    skills: [...new Set(turn.tools.filter((t) => t.name === 'Skill').map((t) => String(t.input.skill || '')))],
    inputs: ctx.inputs, commits: ctx.commits || [],
    cierre: maskSecrets((gaps.reply.match(/##\s*Cierre[\s\S]*/)?.[0] || '').slice(0, 2000)),
    unresolved: gaps.missing.map(maskSecrets),
    findings: gaps.findings.map(maskSecrets),
  };
}

// The record of a turn routed Q that changed nothing, or null: no task ID, so it never shifts T<n> or the follow-up offered.
export function questionRecord(turn, meta = {}) {
  if (!turn.found || routedLevel(turn.texts, turn.tools) !== 'Q') return null;
  return { kind: 'Q', agent: meta.agent || null, at: new Date().toISOString(), session: meta.session, cwd: meta.cwd, department: routedDept(turn.texts, turn.tools), prompt: maskSecrets(String(turn.prompt || '').slice(0, 600)) };
}

// One line for the user (systemMessage: shown in the UI, not added to the model's context).
// While the model has fewer than 3 calibration pairs (no fit yet), it asks the user for the real % (user's choice, 3c).
export function summaryLine(id, ev) {
  const s = Object.entries(ev.steps).map(([k, v]) => `${k} ${v ? '✔' : '✘'}`).join(' · ');
  const ask = ev.quotaPct !== null && /^(default|pairs:[12])$/.test(String(ev.quotaBy || ''))
    ? ` · ¿qué % marcó tu cuota en esta tarea? node "${path.join(path.dirname(fileURLToPath(import.meta.url)), 'calibrate.mjs').replace(/\\/g, '/')}" "${id}" <pct>` : '';
  return `Waymark ${id} · ${s} · ${ev.score} · ${(ev.tokens / 1e6).toFixed(2)}M tokens${ev.quotaPct !== null ? ` ≈ ${ev.quotaPct}% de la cuota de 5 h (estimado)` : ''}${ask}`;
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
      const turn = currentTurn(lines, since), ctx = { ids: taskIds(cwd), decisions: decisionsIn(taskLines(lines)), memoryFile: home.memory.replace(/\\/g, '/'), slug: home.slug, lacks: agent.lacks, agent: agent.name, outside: true };
      const claimed = String(h.last_assistant_message || '').replace(/\*\*|__/g, '').match(/##\s*Cierre\s*·\s*(.+)/)?.[1]?.match(ID)?.[0];
      ctx.commits = commitsFor(cwd, claimed);
      ctx.inputs = turnInputs(taskLines(lines, 1), cwd, agent.instructions);
      ctx.gitChanged = snapshotDiff(loadSnapshot(h.session_id), gitSnapshot(cwd)); // taken by the per-prompt hook
      ctx.inherited = inheritedRoute(lines); // an unrouted reply inside an open task keeps its routing (3c)
      ctx.engram = lines.some((d) => JSON.stringify(d.attachment || '').includes('mcp__engram__') || (d.message?.content || []).some?.((c) => c.type === 'tool_use' && String(c.name).startsWith('mcp__engram__')));
      const all = sessionTools(lines);
      ctx.taskTools = sessionTools(taskLines(lines)); // the task's tool calls (its prompt and two follow-ups)
      const gaps = cierreGaps(turn, h.last_assistant_message, all, prompts, ctx);
      const meta = { agent: agent.name, session: h.session_id, cwd };
      if (!gaps) { // the turn ended: no longer open; a question leaves its short record where the project has memory
        const q = fs.existsSync(home.memory) ? questionRecord(turn, meta) : null;
        try { if (q) appendRecord(cwd, q); } catch {}
        try { refreshTasks(home, closeOpen(home, h.session_id) || !!q); } catch {}
        return;
      }
      if (gaps.missing.length && !h.stop_hook_active) {
        process.stdout.write(JSON.stringify(agent.out.block(checkCierre(turn, h.last_assistant_message, all, prompts, ctx))));
        return;
      }
      gaps.observed.branches = branchesOf(gaps.changed);
      const evaluation = evaluate(gaps, turnUsage(lines, since), ctx.inputs?.model || null);
      const rec = provenanceRecord(turn, gaps, ctx, { ...meta, evaluation });
      try { if (home.dir && !home.legacy) ensureLocal(home); } catch {} // excluded from git before anything is written there
      try { appendRecord(cwd, rec); } catch {}
      try { saveSnapshot(h.session_id, cwd); } catch {} // a turn resumed without a prompt diffs from this close, not the last prompt
      try { closeOpen(home, h.session_id, rec.id); } catch {}
      try { refreshTasks(home, true); } catch {} // tasks.md: where the work stands, for any agent (docs/adr/0007)
      process.stdout.write(JSON.stringify(agent.out.notice(summaryLine(rec.id, evaluation))));
    } catch {}
  };
  process.stdin.on('data', (d) => { input += d; });
  process.stdin.on('end', run);
  process.stdin.resume();
  setTimeout(run, 1000).unref();
}
