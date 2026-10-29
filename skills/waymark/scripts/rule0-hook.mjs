#!/usr/bin/env node
// Waymark · the per-prompt link of the chain (docs/adr/0001, 0002, 0008). Registered by install-hooks.mjs as a
// per-prompt hook (Claude Code: UserPromptSubmit; another agent: same script with `--agent <name>`). Runs locally
// (0 tokens); only this reaches the model:
// - the Rule 0 reminder: full (~70 tokens) when the last reply did not open with "Waymark →", one line (~10) when it did;
// - the repo now: its stack (package manager, versions) and a one-line git status (branch, changed files);
// - the task ID of a new task and of a follow-up of the last recorded one (~25 tokens), from the project's provenance
//   log; the Cierre heading carries it.
// It also takes a git snapshot (the end-of-turn hook diffs against it) and marks the turn open in .waymark/open.json, so
// a turn that never ends (quota, crash) still shows in tasks.md. In Claude Code it also keeps the quota reading the task
// starts from (statusline.mjs), so the end-of-turn hook measures its %. Update checks, session size and offers live in
// `waymark.mjs check` (docs/adr/0008). Remove it from the agent's settings to disable it.
import fs from 'node:fs';
import { readStdin } from './lib/stdin.mjs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sessionState, closingQuestions, inheritedRoute } from './transcript.mjs';
import { taskIds, saveSnapshot, ensureLocal, markOpen, openTurn, confirmTasks, appendRecord, refreshTasks, otherOpen, markTaskStart, taskStartMark, taskOffer, taskInProgress, pinnedCwd, projectHome, workspaceSiblings, aprendidoOf, RELAY_MARK, readRecords, readTaskRecords, logHookError, PROBE_OK } from './provenance.mjs';
import { precedentFor, keepPrecedent } from './precedent.mjs';
import { changesProject } from './runs.mjs';
import { commandFiles } from './tool-hook.mjs';
import { stackLine, directBins } from './stack.mjs';
import { agentFrom, parseHook, answer } from './agents/index.mjs';
import { markStart } from './statusline.mjs';
import { waymarkHome } from './lib/paths.mjs';

const HOME = waymarkHome();
const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // where this install's skills live

// Coexistence mode (~/.waymark/coexistence.md, waymark/references/coexistence.md) decides the reminder.
let mode = '';
try { mode = fs.readFileSync(path.join(HOME, 'coexistence.md'), 'utf8').match(/^Mode:\s*(waymark-leads|guest|other-leads|skills-only)\b/m)?.[1] || ''; } catch {}

// guest / skills-only (and 1.5.0's other-leads): the orchestrator owns the turn, so no reminder at all.
// The rules themselves live in the instructions block; this only points at the steps a new session skips most.
// The rules live once, in the block; the reminder points at the steps a turn skips most (docs/adr/0015, C3).
const full = 'Waymark Rule 0: routing line, dept-*, choice window before changes, "## Cierre · <ID>" after.';
const short = 'Waymark Rule 0 as in your last reply.';
// The repo's state now, so the agent does not spend a response on `git status` (docs/adr/0015, C2). → '' outside git.
export function gitLine(root, max = 2) {
  const r = spawnSync('git', ['status', '--short', '--branch'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  if (r.status !== 0) return '';
  const [head, ...files] = r.stdout.split('\n').filter(Boolean);
  const branch = head.replace(/^##\s*/, '').replace(/\.\.\.\S+/, '').trim();
  const shown = files.slice(0, max).map((l) => `${l.slice(0, 2).trim()} ${path.basename(l.slice(3).replace(/\/$/, '')) || l.slice(3)}`).join(', ');
  return ` Git: ${branch} · ${files.length ? `${files.length} changed: ${shown}${files.length > max ? ', …' : ''}` : 'clean'}.`;
}
// The last thing this session recorded in the project (a task, a question or a confirmation): the log's own lines, which carry the outcome.
function lastOfSession(cwd, session) {
  const home = projectHome(cwd);
  return !home.dir || home.legacy || !fs.existsSync(home.memory) ? null : readRecords(home.log).filter((r) => r.session === session).pop() || null;
}
// A follow-up is only the same request or one that redoes it; a different subject is a new task even on the same files. The
// signs, read from the ask (`\b` sees no edge after «í», so the edges are \p{L}): a verb that continues with no new item after
// it ("sigue", "sigue con lo que quedó"; not "sigue con H4 del plan"), where it stopped or that it was cut, a task's number,
// that what was done is wrong, or the answer to the question this session's last reply ended with.
const END = '(?=$|[^\\p{L}\\p{N}_])';
// "dale", "termina", "acaba" continue only alone or on what was there ("dale, hazlo", "termina lo que…", "acaba T1"); with an
// object they are a new ask ("dale un margen al botón", "termina el formulario")
export const CONTINUES = new RegExp(`^\\s*(?:(?:sigue|contin[uú]a|retoma|seguimos|reanuda|continue|resume|go on)${END}(?!\\s+(?:con|with|el|la|los|las|the|to)\\s+(?!(?:eso|esto|ello|lo|it|that|this)${END}))|(?:dale|termina|acaba|finish)(?=\\s*(?:$|[,.!;:])|\\s+(?:lo|eso|esto|ello|it|that|this)${END}|\\s+T\\d))`, 'iu');
const STOPPED = /(?:se\s+(?:interrumpi[oó]|cort[oó])|por\s+donde\s+(?:qued|ibas|iba)|donde\s+(?:te\s+)?qued|where\s+(?:you|we)\s+left\s+off|(?:was|got)\s+(?:interrupted|cut))/iu;
export const REDO = /(?<![\p{L}\p{N}])(?:no\s+funciona|no\s+sirve|no\s+(?:se\s+)?(?:ve|aplic[oó]|cambi[oó]|guard[oó]|carga)|no\s+(?:era|es)\s+eso|no\s+qued[oó]|sigue\s+(?:fallando|igual|sin|mal|apareciendo|saliendo)|(?:todav[ií]a|a[uú]n)\s+(?:falla|sale|aparece|no\s+(?:funciona|se\s+ve|sale|aparece|cambia))|otra\s+vez|de\s+nuevo|rehaz|deshaz|revi[eé]rte|vuelve\s+a\s+(?:hacer|intentar)|still\s+(?:fails|broken|not)|does\s*n[o']?t\s+work|not\s+working|try\s+again|redo|undo)(?![\p{L}\p{N}])/iu;
const replyText = (lines) => {
  const reply = [...(lines || [])].reverse().find((d) => d.type === 'assistant' && !d.isSidechain && (d.message?.content || []).some((c) => c.type === 'text' && c.text.trim()));
  return (reply?.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
};
// A task's number names it as the ask's subject only when it opens the ask, follows a verb that continues or corrects, or the ask
// already redoes it; "como en T3" or "según T3" cites it and starts a new task.
const TASK_NO = '(T)(\\d+)[a-z]?(?![\\p{L}\\p{N}])';
const OPENS_WITH_TASK = new RegExp(`^\\s*${TASK_NO}`, 'u');
const VERB_THEN_TASK = new RegExp(`(?<![\\p{L}\\p{N}])(?:sigue|contin[uú]a|retoma|reanuda|termina|acaba|finaliza|completa|dale|corrige|arregla|repara|rehaz|reabre|continue|resume|finish|fix|redo|reopen)\\s+(?:(?:con|en|a|de|la|el|lo\\s+de|tarea|task)\\s+)*${TASK_NO}`, 'iu');
// The number of the task the ask is about, or undefined: the one that opens it or follows the verb (a capital T: "t3" is no task), else, when the ask says
// something is not done, the first one cited.
export function subjectTask(text) {
  const opens = text.match(OPENS_WITH_TASK), after = text.match(VERB_THEN_TASK);
  if (opens) return opens[2];
  if (after && after[1] === 'T') return after[2];
  return REDO.test(text) || STOPPED.test(text) ? text.match(/(?<![\p{L}\p{N}])T(\d+)[a-z]?(?![\p{L}\p{N}])/u)?.[1] : undefined;
}
const endsAsking = (text) => !!text && (closingQuestions(text).length > 0 || OFFER.test(text.split('\n').slice(-4).join('\n')));
// The IDs this turn offers: `followUp` only when the ask continues or redoes a task (null otherwise); `reply` is the session's last reply.
export function taskTurn(cwd, now = new Date(), { session = null, prompt = '', reply = '' } = {}) {
  const ids = taskIds(cwd, now), text = String(prompt || ''), bare = (id) => String(id || '').replace(/[a-z]$/, '');
  const n = subjectTask(text);
  const named = n ? [...ids.known].filter((k) => bare(k).endsWith(` · T${n}`)).sort().pop() : null;
  if (named) return { next: ids.next, followUp: ids.follow(named), why: '' };
  if (!ids.followUp) return { next: ids.next, followUp: null, why: '' };
  let last = null;
  try { last = session ? lastOfSession(cwd, session) : null; } catch {}
  const mine = !!last?.id && bare(last.id) === ids.last, external = mine && last.outcome?.cause === 'external';
  const says = CONTINUES.test(text) || STOPPED.test(text) || REDO.test(text) || NO.test(text);
  const unread = !text.trim() && !external; // an agent whose hook does not carry the ask (Antigravity): nothing to judge, both IDs offered
  if (says || unread || (mine && !external && endsAsking(reply))) return { next: ids.next, followUp: ids.followUp, why: '' };
  // a parcial for a cause outside the work (the quota, a provider) is said, so the model knows why no follow-up is offered
  return { next: ids.next, followUp: null, why: external ? ` The last task (${last.id}) is parcial for a cause outside the work: this ask is a new task unless the user says it continues.` : '' };
}
export function taskLine(cwd, now = new Date(), opts = {}) {
  const t = taskTurn(cwd, now, opts);
  return ` ID: new ${t.next}${t.followUp ? `; follow-up ${t.followUp}` : ''}.${t.why}`;
}
// A bare "sí" after a task that said hecho confirms it: the hook runs `done`, so the model never reads it (0 tokens). Not when the
// last reply ended asking something else (the "sí" answers that), nor when the task is not the session's last thing.
export const YES = /^\s*(?:s[ií]|yes|confirmo|confirmado|correcto|completo)\s*[.!¡]*\s*$/i; // go-ahead words (dale, ok, vale) are no confirmation: they answer an offer
const OFFER = /\b(?:si quieres|si prefieres|quieres que|puedo|te parece|want me|shall i|should i|would you|let me know)\b|[¿?]/i;
// "sí T3, T4" names the tasks; "sí a las dos" / "sí a todas" counts back over the session's tasks that said hecho; a bare "no" after a hecho says it is not
// done (the model reads it and continues it as a follow-up; the record keeps the user's word).
const YES_IDS = /^\s*(?:s[ií]|yes|confirmo)(?=[\s,:])[\s,:]*((?:T\d+[a-z]?(?:\s*(?:,|y|and|&)\s*)?)+)\s*[.!]*\s*$/i;
const YES_MANY = /^\s*(?:s[ií]|yes)[\s,]*(?:a\s+)?(?:las|los|both|all)?\s*(dos|tres|cuatro|ambas|ambos|todas|todos|\d+)\s*[.!]*\s*$/i;
const NO = /^\s*no\s*[.!]*\s*$/i;
// the user's free words for "close the rest of them": "cierra las otras tareas también", "close the other tasks too", "marca el resto como hecho"
export const CLOSE_REST = /^\s*(?:s[ií][,.]?\s+)?(?:cierra|cierren|cerrar|marca|close|mark)\b[^.\n]{0,40}?\b(?:otras|otros|dem[aá]s|resto|todas|todos|others?|rest|all)\b[^.\n]{0,30}?\b(?:tareas?|tasks?)\b[^.\n]{0,30}$/iu;
const COUNT = { dos: 2, ambas: 2, ambos: 2, tres: 3, cuatro: 4 };
export function confirmation(hook, agent, cwd) {
  const prompt = String(hook.prompt || '');
  const named = prompt.match(YES_IDS)?.[1], many = prompt.match(YES_MANY)?.[1] || (CLOSE_REST.test(prompt) ? 'todas' : undefined), no = NO.test(prompt);
  if (!YES.test(prompt) && !named && !many && !no) return null;
  const session = hook.session_id || 'unknown';
  if (openTurn(cwd, session)) return null;
  const home = projectHome(cwd);
  if (!home.dir || home.legacy || !fs.existsSync(home.memory)) return null;
  const all = readRecords(home.log).filter((r) => r.session === session), last = all.pop();
  if (!named && !many && (!last?.id || last.kind || last.outcome?.result !== 'hecho')) return null;
  if (endsAsking(replyText(agent.read(hook)))) return null; // the reply ended offering or asking: the yes or the no answers that
  if (no) {
    appendRecord(home.root, { kind: 'confirm', agent: agent.name, at: new Date().toISOString(), session, refuted: [last.id], said: 'no' });
    return { no: last.id };
  }
  const done = new Set(all.concat(last || []).filter((r) => r.kind === 'confirm').flatMap((r) => r.confirmed || []));
  const hecho = all.concat(last || []).filter((r) => r.id && !r.kind && r.outcome?.result === 'hecho');
  let ids;
  if (named) {
    const nums = named.match(/T\d+[a-z]?/gi).map((t) => t.toUpperCase());
    ids = nums.map((t) => [...hecho].reverse().find((r) => String(r.id).match(/T\d+[a-z]?$/i)?.[0].toUpperCase() === t)?.id);
    if (ids.some((x) => !x)) return null; // a number that is no task of the session: an ordinary message
  } else if (many) {
    const open = hecho.filter((r) => !done.has(r.id));
    ids = /^tod/i.test(many) ? open.map((r) => r.id) : open.slice(-(COUNT[many.toLowerCase()] || Number(many))).map((r) => r.id);
    if (!ids.length) return null;
  } else ids = [last.id];
  if (!confirmTasks(home, ids, { note: hook.prompt, agent: agent.name, session, always: true }).length) return null;
  refreshTasks(home, true);
  return { id: ids.join(', '), ids };
}

// A step the user says is theirs ("los PR los abro yo", "yo despliego"), with no Conventions line for it yet: the agent offers the line once, in the user's words
// and dated, and writes it only on their yes (decision 13). → the line for the reminder, or ''.
const OWNED = [['Deploys', /\b(?:yo\s+(?:despliego|hago\s+el\s+deploy|subo\s+a\s+producci[oó]n)|(?:el\s+)?deploy\s+lo\s+hago\s+yo|I\s+deploy)\b/i], ['PRs', /\b(?:los\s+PRs?\s+los\s+abro\s+yo|yo\s+abro\s+(?:los\s+)?(?:PRs?|pull\s+requests?)|I\s+open\s+the\s+PRs?)\b/i],
  ['Commits', /\b(?:los\s+commits?\s+los\s+hago\s+yo|yo\s+hago\s+los\s+commits?)\b/i], ['Migrations', /\b(?:las\s+migraciones\s+las\s+corro\s+yo|yo\s+corro\s+las\s+migraciones)\b/i]];
export function ownedOffer(prompt, memory, now = new Date()) {
  const text = String(prompt || '').trim(), mem = String(memory || '').replace(/<!--[\s\S]*?-->/g, '');
  for (const [key, re] of OWNED) {
    if (!re.test(text) || new RegExp(`^[ \\t]*[-*]?[ \\t]*${key}:`, 'im').test(mem)) continue;
    return ` The user said this step is theirs: offer once, in your choice window, to write "- ${key}: the user (${now.toISOString().slice(0, 10)}: «${text.slice(0, 120)}»)" under Conventions; never write it without their yes.`;
  }
  return '';
}
// Soft cap of a task (docs/adr/0044): past 60 minutes, 150 tool calls or 40 changed files, whichever comes first, the agent is told once to
// offer the user closing it and opening a new task for what remains. A project changes the numbers in memory.md: "Soft cap: 90 min / 200 calls / 60 files".
// Is the session's open turn still unclosed? Its open entry is newer than anything the session recorded, an unevaluated record aside (a crash or a
// deferral is no close: the turn's changes stay in the snapshot until a real close).
export function stillOpen(open, records, session) {
  if (!open) return false;
  const last = records.filter((r) => r.session === session && r.kind !== 'unevaluated').pop();
  return !(last && Date.parse(last.at || 0) > Date.parse(open.at || 0));
}

export const SOFT_CAP ={ minutes: 60, calls: 150, files: 40 };
export function softCap(memory) {
  const m = String(memory || '').match(/^[ \t]*[-*]?[ \t]*Soft cap:[ \t]*(\d+)\s*min\w*\s*\/\s*(\d+)\s*(?:calls|llamadas)\s*\/\s*(\d+)\s*(?:files|archivos)/im);
  return m ? { minutes: Number(m[1]), calls: Number(m[2]), files: Number(m[3]) } : SOFT_CAP;
}
// The size of the task so far: its calls, the files it changed (by an edit or by a command that writes: sed -i, a script), and the minutes worked (a pause
// longer than IDLE between two calls counts as IDLE). `user`: the line for the user at the close of a long turn, in their words, instead of the agent's.
const IDLE = 15 * 60000;
export function softCapLine(hook, agent, cwd, mark, now = Date.now(), stateFile = path.join(HOME, '.soft-cap.json'), lines = null, { user = false, level = 0 } = {}) {
  if (!mark || level >= 2) return ''; // no task in progress: nothing to measure; an L2 or L3 is one task however long, so it is never told to close
  const home = projectHome(cwd), cap = softCap((() => { try { return fs.readFileSync(home.memory, 'utf8'); } catch { return ''; } })());
  const files = new Set();
  let calls = 0, worked = 0, prev = mark;
  for (const d of lines || agent.read(hook)) {
    const t = Date.parse(d.timestamp || '') || 0;
    if (d.type !== 'assistant' || d.isSidechain || t < mark) continue;
    for (const c of d.message?.content || []) {
      if (c.type !== 'tool_use') continue;
      calls++; worked += Math.min(Math.max(0, t - prev), IDLE); prev = Math.max(prev, t);
      if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name) && c.input?.file_path) files.add(String(c.input.file_path));
      else if (/^(Bash|PowerShell)$/.test(c.name) && c.input?.command && changesProject(String(c.input.command))) for (const f of commandFiles(String(c.input.command), cwd)) files.add(f);
    }
  }
  worked += Math.min(Math.max(0, now - prev), IDLE);
  const minutes = Math.round(worked / 60000);
  if (minutes < cap.minutes && calls < cap.calls && files.size < cap.files) return '';
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const key = `${hook.session_id || 'unknown'}:${mark}`;
  if (seen[key]) return ''; // told once per task
  for (const [k, at] of Object.entries(seen)) if (now - at > 7 * 86400000) delete seen[k];
  seen[key] = now;
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return ''; }
  if (user) return ` · tarea grande: ${minutes} min, ${calls} llamadas y ${files.size} archivos cambiados (tope ${cap.minutes} min / ${cap.calls} llamadas / ${cap.files} archivos): conviene cerrarla y abrir otra para lo que falta`;
  return ` Task size: this task has run ${minutes} min, ${calls} calls and ${files.size} changed files (soft cap ${cap.minutes} min / ${cap.calls} calls / ${cap.files} files): offer the user, in your choice window, to close it and open a new task for what remains.`;
}
// Another session of this project has a turn open: two sessions on one repo edit the same files without knowing. The line
// names it so the agent tells the user before editing what the other may be changing.
export function otherSessionLine(cwd, session, now = new Date()) {
  const o = otherOpen(cwd, session, now)[0];
  return o ? ` Another session${o.agent ? ` (${o.agent})` : ''} has a turn open in this project since ${new Date(o.at).toLocaleString('sv').slice(11, 16)} ("${o.prompt}"): if it is still running, tell the user before changing files it may be changing.` : '';
}
// The projects next to this one (an API and its FE) are two sessions that never hear of each other: the card names them once, at the start. From then
// on one line says what a sibling did since this session's previous prompt (a task it closed with its Aprendido, a turn it opened); nothing new says
// nothing, so it costs 0. It arrives with the next prompt: no hook can push to a running session. The previous prompt's time is kept per session in
// ~/.waymark/.siblings.json, because open.json loses its entry when the turn closes. The session's first prompt only notes the time.
export const SIBLINGS_SHOWN = 2, SIBLING_LEARNED = 110;
export function siblingsLine(cwd, session, { now = Date.now(), stateFile = path.join(HOME, '.siblings.json') } = {}) {
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {}; } catch {}
  const key = session || 'unknown', since = seen[key];
  for (const [k, at] of Object.entries(seen)) if (now - at > 7 * 86400000) delete seen[k];
  seen[key] = now;
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return ''; }
  if (!since) return '';
  const news = [];
  for (const h of workspaceSiblings(projectHome(cwd).root)) {
    if (!h.dir || h.legacy) continue;
    const name = path.basename(h.root), said = [];
    if (!readRecords(h.log).some((x) => x.id && !x.kind && Date.parse(x.at || 0) > since)) said.push(...[]); // the log alone says nothing closed: no git read (notes) for the Aprendido
    else for (const r of readTaskRecords(h).filter((x) => x.id && !x.kind && Date.parse(x.at || 0) > since).slice(-2)) {
      const learned = aprendidoOf(String(r.cierre || '').replace(/\*\*|__/g, '')).replace(/\s+/g, ' ').trim();
      said.push(`${r.id.match(/T\d+[a-z]?$/)?.[0] || r.id}${r.agent ? ` (${r.agent})` : ''} closed${learned ? `: ${learned.length > SIBLING_LEARNED ? learned.slice(0, SIBLING_LEARNED - 1) + '…' : learned}` : ''}`);
    }
    const open = otherOpen(h.root, '', new Date(now)).filter((o) => Date.parse(o.at || 0) > since).map((o) => o.next?.match(/T\d+[a-z]?$/)?.[0]).filter(Boolean);
    for (const id of new Set(open)) said.push(`${id} en curso`);
    if (said.length) news.push(`${name}: ${said.join('; ')}`);
  }
  return news.length ? ` Workspace (a sibling project did this since your last prompt; W tasks --workspace has it whole): ${news.slice(0, SIBLINGS_SHOWN).join(' | ')}.` : '';
}
export const REMINDER = { full, short }; // measured by size.mjs
const coexist = ' Coexistence: follow the injected Adopted/Fallback/Resolved rules; never edit the other framework\'s files.';
const silent = ['guest', 'other-leads', 'skills-only'].includes(mode);

// Context brake (docs/adr/0016): every response re-reads the whole session, so a new message to a session past
// BRAKE_TOKENS is stopped before the model (0 tokens), once per BRAKE_STEP the context grows (300k, 400k, 500k…). The
// message is kept in .waymark/next-prompt.md and the next session's card brings it; sending it again here continues
// until the next step. Agents whose prompt hook cannot stop a prompt (no out.blockPrompt) get one line in the reminder
// instead. WAYMARK_BRAKE_TOKENS tunes it (0 = off); WAYMARK_BRAKE_STEP the step (0 = once per session).
// Neither brake holds a message mid-task (no Cierre yet, or cut by the quota): a new session mid-task would rebuild what
// this one holds, so past HARD_TOKENS the agent is told to offer one in its window. A task closed parcial or bloqueado is
// between tasks and brakes like any other (docs/adr/0044).
// Idle brake (docs/adr/0018): the prompt cache lasts about an hour, so the first message to a session idle longer than
// that re-writes its whole context, which costs far more than reading it (431k re-written ≈ 9% of the quota). A session
// past IDLE_TOKENS idle over IDLE_MINUTES is braked the same way, once per idle stretch. WAYMARK_IDLE_TOKENS and
// WAYMARK_IDLE_MINUTES tune it (0 = off).
export const BRAKE_TOKENS = Number(process.env.WAYMARK_BRAKE_TOKENS ?? 300000);
export const BRAKE_STEP = Number(process.env.WAYMARK_BRAKE_STEP ?? 100000);
export const HARD_TOKENS = Number(process.env.WAYMARK_HARD_TOKENS ?? 500000); // mid-task: the agent offers a new session (0 = off)
export const IDLE_TOKENS =Number(process.env.WAYMARK_IDLE_TOKENS ?? 100000);
export const IDLE_MINUTES = Number(process.env.WAYMARK_IDLE_MINUTES ?? 60);
export const NEXT_PROMPT = 'next-prompt.md';
export function brake(hook, agent, st, stateFile = path.join(HOME, '.brake.json'), now = Date.now()) {
  const context = st.context || 0, idleMin = st.lastAt ? (now - st.lastAt) / 60000 : 0;
  const big = BRAKE_TOKENS && context >= BRAKE_TOKENS;
  const idle = IDLE_TOKENS && IDLE_MINUTES && context >= IDLE_TOKENS && idleMin > IDLE_MINUTES;
  if ((!big && !idle) || !String(hook.prompt || '').trim()) return null;
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const session = hook.session_id || 'unknown', k = `${Math.round(context / 1000)}k`;
  if (taskInProgress(hook.cwd || process.cwd(), hook.session_id)) { // mid-task a message is never held: past HARD_TOKENS the agent is told to offer a new session, once per step
    if (!HARD_TOKENS || context < HARD_TOKENS) return null;
    const key = `warn:${session}:${BRAKE_STEP ? Math.floor((context - HARD_TOKENS) / BRAKE_STEP) : 0}`;
    if (seen[key]) return null;
    seen[key] = now;
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return null; }
    return { line: ` Context: this session holds ~${k} tokens and every response re-reads all of it. Offer the user, in your choice window, to close this task and continue in a new session (the card, tasks.md and engram carry the work over).` };
  }
  // the idle stretch is named by the last response before it: a resend (no response since) finds it seen and continues.
  // The size brake is named by its step: the first keeps the bare session id, as before steps existed.
  const step = big && BRAKE_STEP ? Math.floor((context - BRAKE_TOKENS) / BRAKE_STEP) : 0;
  const sizeKey = step ? `${session}:${step}` : session;
  const key = idle ? `${session}:idle:${st.lastAt}` : sizeKey;
  if (seen[key] || (!idle && seen[sizeKey])) { // braked already: the user chose to continue here, so this session's held message is not for a new one
    try {
      const home = projectHome(hook.cwd || process.cwd()), file = path.join(home.dir, NEXT_PROMPT);
      if (home.dir && !home.legacy && fs.readFileSync(file, 'utf8').split('\n')[0].includes(`· session ${session} -->`)) fs.rmSync(file, { force: true });
    } catch {}
    return null;
  }
  for (const [s, at] of Object.entries(seen)) if (now - at > 7 * 86400000) delete seen[s];
  seen[key] = now;
  try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(seen)); } catch { return null; }
  const why = idle
    ? `this session holds ~${k} tokens of context and was idle ${idleMin >= 120 ? `${Math.round(idleMin / 60)} h` : `${Math.round(idleMin)} min`}: its cache expired, so the next response re-writes all of it, which costs far more than a new session.`
    : `this session holds ~${k} tokens of context and every response re-reads all of it.`;
  if (!agent.out.blockPrompt) return { line: ` Context: ${why} Before working, tell the user in one line that a new session is cheaper (the card, tasks.md and engram carry the work over).` };
  const home = projectHome(hook.cwd || process.cwd());
  let kept = '';
  try { if (home.dir && !home.legacy) { // a handoff already in the file follows the held message (the card takes the message, then leaves the handoff)
    let handoff = '';
    try { const t = fs.readFileSync(path.join(home.dir, NEXT_PROMPT), 'utf8'); if (t.startsWith(RELAY_MARK)) handoff = t; } catch {}
    fs.writeFileSync(path.join(home.dir, NEXT_PROMPT), `<!-- ${new Date(now).toISOString()} · held by the context brake (~${k}${idle ? ', idle' : ''}) · session ${session} -->\n${String(hook.prompt).trim()}\n${handoff}`); kept = ` Your message is kept in .waymark/${NEXT_PROMPT}: the new session's card brings it.`; } } catch {}
  return { block: agent.out.blockPrompt(`Waymark: ${why} Open a new session (the card, tasks.md and engram carry the work over).${kept} Send it again here to continue in this session.`) };
}

// A background agent's result reaches the session as a user message (<task-notification>). It is no request: answering it with the full reminder made the
// agent route it as a question and write a second Cierre (it did, in every task that ran a review in the background). It continues the task in progress.
export const NOTIFICATION = /^\s*<task-notification>/;
export const NOTIFICATION_NOTE = 'Waymark: this message is a background task\'s result, not a new request: it continues the task in progress. Do not write a routing line (no "Waymark → Q") and no new Cierre for it; use the result in that task, and apply what it finds as part of it.';

export function reminder(hook, agent) {
  if (silent) return null;
  if (NOTIFICATION.test(String(hook.prompt || ''))) return agent.out.context('UserPromptSubmit', NOTIFICATION_NOTE + agent.note(SKILLS_DIR)); // no snapshot, no open turn, no new task start
  const cwd = pinnedCwd(hook.session_id, hook.cwd || process.cwd()); // the session's project is its first prompt's folder, not where a later `cd` left the shell
  let yes = null;
  try { yes = confirmation(hook, agent, cwd); } catch (e) { logHookError('rule0-hook confirmation', e); }
  const plural = yes?.ids?.length > 1;
  if (yes?.ids) return agent.out.blockPrompt ? agent.out.blockPrompt(`Waymark: ${yes.id} ${plural ? 'confirmadas como hechas' : 'confirmada como hecha'} (tu «sí»); no queda nada por hacer en ${plural ? 'ellas' : 'ella'}.`) : agent.out.context('UserPromptSubmit', `Waymark: the user's "sí" confirmed ${yes.id} as done and the hook closed ${plural ? 'them' : 'it'}. Answer in one line: no routing line, no Cierre.${agent.note(SKILLS_DIR)}`);
  const refuted = yes?.no ? ` The user said "no" to ${yes.no}: it is not done. Continue it as its follow-up; ask what is missing if it is not clear.` : '';
  let st = { openedWithWaymark: false };
  let lines = null;
  try { lines = agent.read(hook); st = sessionState(lines); } catch {}
  let held = null;
  try { held = brake(hook, agent, st); } catch {}
  if (held?.block) return held.block; // stopped before the model: no snapshot, no open turn
  const session = hook.session_id || 'unknown';
  let ids = '', other = '', unclosed = false, offered;
  const started = taskStartMark(session); // read once: a later prompt of a task in progress has it, the task's first has none
  try {
    const t = taskTurn(cwd, new Date(), { session, prompt: agent.promptless ? '' : hook.prompt, reply: replyText(lines) });
    const kept = started ? taskOffer(session) : undefined; // a later prompt of a task in progress keeps its first prompt's offer
    if (kept !== undefined) { t.followUp = kept; t.why = ''; } else taskOffer(session, t.followUp);
    offered = t.followUp; ids = ` ID: new ${t.next}${t.followUp ? `; follow-up ${t.followUp}` : ''}.${t.why}`;
  } catch {}
  try { other = otherSessionLine(cwd, session); } catch {}
  try { other += siblingsLine(cwd, session); } catch (e) { logHookError('rule0-hook siblings', e); }
  try { // this session's last turn never closed (interrupted, or a background agent still running): its open entry is newer than anything the session recorded
    const open = openTurn(cwd, session), home = projectHome(cwd);
    unclosed = stillOpen(open, open && !home.legacy ? readRecords(home.log) : [], session);
  } catch {}
  try { const home = projectHome(cwd); if (home.dir && !home.legacy && fs.existsSync(home.dir)) ensureLocal(home); } catch {} // Waymark's own .gitignore lines land before the snapshot, so they never read as the turn's change
  try { saveSnapshot(hook.session_id, cwd, { keep: unclosed }); } catch {} // the end-of-turn hook diffs against it; an unclosed turn's changes stay in it
  try { markOpen(cwd, hook.session_id, hook.prompt, new Date(), agent.name, offered); } catch {} // a turn that never ends still shows in tasks.md, with its agent; the end-of-turn hook reads the follow-up offered
  try { if (agent.name === 'claude') markStart(hook.session_id); } catch {} // the quota reading the task's % is measured from
  // the earlier task that resembles the ask, handed over once, at the task's first prompt (docs/adr/0033); null clears a stale one
  let prec = '';
  try {
    if (!started) {
      const home = projectHome(cwd), p = home.dir && !home.legacy ? precedentFor(hook.prompt, readTaskRecords(home), undefined, hook.session_id) : null;
      keepPrecedent(hook.session_id, p);
      if (p) prec = ` ${p.text}`;
    }
  } catch {}
  let mark = started;
  try { mark = markTaskStart(hook.session_id); } catch {} // the task's first prompt: where the hooks read its decisions from
  // the stack as the repo has it now (package manager, versions): never from memory, which can be stale
  let repo = '';
  try { const line = stackLine(projectHome(cwd).root, { direct: directBins(agent.name) }); if (line) repo = ` Repo: ${line}.`; } catch {}
  try { repo += gitLine(projectHome(cwd).root); } catch {}
  let cap = '';
  try { cap = softCapLine(hook, agent, cwd, mark, Date.now(), undefined, lines, { level: Number(inheritedRoute(lines)?.level) || 0 }); } catch (e) { logHookError('rule0-hook soft cap', e); } // the task's start is the first prompt's mark, kept by later prompts of the same task
  let owned = '';
  try { owned = ownedOffer(hook.prompt, fs.readFileSync(projectHome(cwd).memory, 'utf8')); } catch {}
  const text = (st.openedWithWaymark ? short : full) + ids + refuted + other + repo + (held?.line || '') + cap + owned + prec + (mode === 'waymark-leads' ? coexist : '') + agent.note(SKILLS_DIR);
  // an agent whose prompt hook cannot add context (Cursor) keeps it for the turn's first tool result
  return agent.deferPrompt ? agent.deferPrompt(hook, text) : agent.out.context('UserPromptSubmit', text);
}

// Real paths on both sides: Node runs a script reached through a link (~/.claude/skills → ~/.agents/skills) from its
// real path, so the path as typed would never match and the hook would do nothing.
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const agent = agentFrom();
  let input = '', done = false;
  const run = () => {
    if (done) return;
    done = true;
    const hook = parseHook(input, agent, { lenient: true });
    if (!hook) return; // Claude Code's hook run by Cursor: Cursor's own hook does the work
    if (hook.waymark_probe) { process.stdout.write(PROBE_OK); return; } // waymark.mjs check: this hook runs from where it is registered
    try { const out = reminder(hook, agent) || agent.out.pass?.('UserPromptSubmit'); if (out) answer(agent, out); } catch (e) { logHookError('rule0-hook', e); }
  };
  readStdin((text) => { input = text; run(); });
}
