// Waymark · shared reader for the agent's session transcript (Claude Code .jsonl), used by the hooks and measure.mjs.
// Offline and read-only. A "prompt" is a message the user typed: tool results, command echoes, system reminders,
// interruptions and background-task notifications (<task-notification>) are not prompts.
import fs from 'node:fs';
import { shellRuns } from './runs.mjs';

const TAIL = 2 * 1024 * 1024; // bytes read from the end of a transcript by the hooks

// A command's output as the testigos read it: its start and its end (a summary such as "Found 2 errors" or "fail 1" comes
// last), 800 characters at most.
export const clipOutput = (s) => { s = String(s || ''); return s.length > 800 ? `${s.slice(0, 400)}\n…\n${s.slice(-400)}` : s; };
export const parseLines = (text) => text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

export function readTail(file, bytes = TAIL) {
  if (!file || !fs.existsSync(file)) return [];
  const size = fs.statSync(file).size, start = Math.max(0, size - bytes), buf = Buffer.alloc(size - start);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
  const rows = buf.toString('utf8').split('\n');
  if (start > 0) rows.shift(); // first line is partial
  return parseLines(rows.join('\n'));
}

export const promptText = (d) => {
  const c = d.message?.content;
  return typeof c === 'string' ? c : (c || []).filter((x) => x.type === 'text').map((x) => x.text).join(' ');
};

// The summary a context compaction writes to continue the session is no prompt either. Its shape is not documented
// (code.claude.com/docs/en/sessions: the transcript format is internal), so both known markers are checked:
// isCompactSummary and the summary's opening sentence.
const COMPACTED = /^\s*This session is being continued from a previous conversation/;
export const isPrompt = (d) => {
  if (d.type !== 'user' || d.isMeta || d.isSidechain || d.isCompactSummary) return false;
  const c = d.message?.content;
  if (Array.isArray(c) && c.some((x) => x.type === 'tool_result')) return false;
  const text = promptText(d);
  // A Stop-hook block reason fed back to the agent is not the user's prompt (the blocked turn's edits stay in its turn).
  return !!text.trim() && !COMPACTED.test(text) && !/^\s*<(local-command|command-|system-reminder|task-notification)/.test(text) && !/^\[Request interrupted/.test(text) && !/^\s*(Stop hook feedback|Waymark: this L)/.test(text);
};

// Reads the transcript tail, doubling it until it holds `prompts` user prompts and, with `since` (ms, the task's start),
// reaches back to it, or the whole file (max 64 MB): a pasted image is a line of megabytes, and a turn whose prompt fell
// out of the tail was read as "no turn" — the gate skipped it and the record counted the whole tail. read(bytes) → lines.
export function readTurns(read, prompts = 3, start = TAIL, max = 64 * 1024 * 1024, since = 0) {
  const first = (lines) => Date.parse(lines.find((d) => d.timestamp)?.timestamp || '') || 0;
  const short = (lines) => lines.filter(isPrompt).length < prompts || (since > 0 && first(lines) > since);
  let lines = read(start);
  for (let bytes = start * 2; bytes <= max && short(lines); bytes *= 2) {
    const more = read(bytes);
    if (more.length <= lines.length) break; // the whole file was already read
    lines = more;
  }
  return lines;
}

// The index where the current turn starts: after its last prompt, or after `since` (ms) when that is later — a turn
// that a background notification started after a close has no prompt of its own (counting from the prompt would record
// the closed task again).
const turnStart = (lines, since = 0) => {
  let i = lines.length - 1;
  while (i >= 0 && !isPrompt(lines[i])) i--;
  const promptAt = i >= 0 ? Date.parse(lines[i].timestamp || '') || 0 : 0;
  if (!since || promptAt > since) return { i, from: i + 1 }; // a prompt after the close starts the turn, as always
  const j = lines.findIndex((d, k) => k > i && (Date.parse(d.timestamp || '') || 0) > since);
  return { i, from: j < 0 ? lines.length : j };
};

// A skill or agent the turn launched in the background that has not notified yet (Claude Code: its tool result has
// toolUseResult.background for a forked skill, toolUseResult.isAsync for an Agent call; its end is a <task-notification>
// naming the tool-use id). The turn is not over: the agent
// waits for it and closes in the notification's turn, so a task is never judged while its code-review runs.
// Background shell commands are not waited for: a dev server never notifies.
// The notification names the agent by its <task-id> (the launch's agentId) and, sometimes, the launch's <tool-use-id>:
// either releases it (a notification may carry no tool-use-id). A launch older than
// BACKGROUND_WAIT_MS with no notification is a dead agent, not waited for: the turn is judged.
export const BACKGROUND_WAIT_MS = 30 * 60000;
// A gate, a build or a test run the shell left in the background is waited for too: it ends and notifies, and the turn that ends before it was
// judged without its result. A watcher or a server never ends, so it is not waited for. The shell's launch names its id in its result ("…with ID: bg1").
export const SHELL_WAIT_MS = 10 * 60000;
const NEVER_ENDS = /(?:^|\s)(?:--watch|--watchAll|-w|watch|serve|dev|start)(?=\s|$)/;
const isShellCall = (c) => c.type === 'tool_use' && /^(Bash|PowerShell|shell)$/.test(c.name) && c.input?.run_in_background;
const finiteCheck = (command) => !NEVER_ENDS.test(String(command || '')) && shellRuns(String(command || '')).some((p) => p.build || p.test || p.gate);
export function pendingBackground(lines, since = 0, now = Date.now()) {
  const { from } = turnStart(lines, since);
  const launched = [], shellLaunch = new Map();
  for (const d of lines.slice(from)) {
    const at = Date.parse(d.timestamp || '') || 0;
    if (d.type === 'assistant' && !d.isSidechain) for (const c of d.message?.content || []) if (isShellCall(c) && finiteCheck(c.input.command)) shellLaunch.set(c.id, at);
    if (d.type !== 'user' || d.isSidechain) continue;
    const parts = Array.isArray(d.message?.content) ? d.message.content : [];
    if (d.toolUseResult?.background || d.toolUseResult?.isAsync) for (const c of parts) if (c.type === 'tool_result') launched.push({ id: c.tool_use_id, agent: d.toolUseResult.agentId || null, at });
    for (const c of parts) if (c.type === 'tool_result' && shellLaunch.has(c.tool_use_id)) {
      const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
      launched.push({ id: c.tool_use_id, agent: text.match(/\bID:\s*([\w-]+)/)?.[1] || null, at: shellLaunch.get(c.tool_use_id), shell: true });
    }
  }
  if (!launched.length) return [];
  const notified = lines.filter((d) => d.type === 'user' && /<task-notification>/.test(promptText(d))).map(promptText).join('\n');
  // a shell run the agent read to its end itself (its output call shows an exit code or a final status) needs no notification
  const polled = (id) => {
    const calls = new Set();
    for (const d of lines.slice(from)) {
      for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
        if (d.type === 'assistant' && c.type === 'tool_use' && [c.input?.bash_id, c.input?.task_id, c.input?.shell_id].includes(id)) calls.add(c.id);
        if (d.type === 'user' && c.type === 'tool_result' && calls.has(c.tool_use_id) && /<exit_code>|<status>(?:completed|failed|killed)|exit code:?\s*\d/i.test(typeof c.content === 'string' ? c.content : JSON.stringify(c.content || ''))) return true;
      }
    }
    return false;
  };
  return launched.filter((l) => !notified.includes(`<tool-use-id>${l.id}</tool-use-id>`) && !(l.agent && notified.includes(`<task-id>${l.agent}</task-id>`)) && !(l.at && now - l.at > (l.shell ? SHELL_WAIT_MS : BACKGROUND_WAIT_MS)) && !(l.shell && l.agent && polled(l.agent))).map((l) => l.id);
}

// A tool call as the core reads it: a skill invoked through the Claude Code plugin ("waymark:dept-qa") under its own
// name ("dept-qa"), so departments, procedures and re-routes match either install.
const PLUGIN = /^waymark:/;
export const toolInput = (c) => (c.name === 'Skill' && PLUGIN.test(String(c.input?.skill || '')) ? { ...c.input, skill: c.input.skill.replace(PLUGIN, '') } : c.input || {});

// The current turn: everything after the last prompt (and after `since`). Returns its assistant texts and tool calls
// (main agent only).
export function currentTurn(lines, since = 0) {
  const { i, from } = turnStart(lines, since);
  const texts = [], textAt = [], tools = [], results = {};
  for (const d of lines.slice(from)) {
    const cmd =d.type === 'user' && promptText(d).match(/<command-name>\/?([^<\s]+)<\/command-name>/)?.[1];
    if (cmd) tools.push({ name: 'Skill', input: { skill: cmd, slash: true } }); // a slash command typed in the turn
    const at = Date.parse(d.timestamp || '') || 0;
    if (d.type === 'user' && !d.isSidechain && Array.isArray(d.message?.content)) {
      // raw: the first 20,000 characters and the last 4,000 (a test runner prints its summary at the end), where the Evidencia testigo looks up
      // what the Cierre cites (text is clipped)
      for (const c of d.message.content) if (c.type === 'tool_result') { const s = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || ''); results[c.tool_use_id] = { at, error: !!c.is_error, text: clipOutput(s), raw: s.length > 24000 ? `${s.slice(0, 20000)}\n…\n${s.slice(-4000)}` : s }; }
    }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    for (const c of d.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) { texts.push(c.text); textAt.push([tools.length, c.text]); } // the index of the next tool call: what was said before it
      if (c.type === 'tool_use') tools.push({ name: c.name, input: toolInput(c), id: c.id, at });
    }
  }
  const promptAt = i >= 0 ? Date.parse(lines[i].timestamp || '') || 0 : 0;
  return { found: i >= 0, prompt: i >= 0 ? promptText(lines[i]) : '', uuid: i >= 0 ? lines[i].uuid || '' : '', startedAt: Math.max(promptAt, since > promptAt ? since : 0), texts, textAt, tools, results };
}

// Every tool call of the main agent in the readable part of the session (for reads done in an earlier turn), with the
// start of its result (`out`) so a search that found nothing is not taken for a read.
export function sessionTools(lines) {
  const out = [], byId = {};
  for (const d of lines) {
    if (d.type === 'assistant' && !d.isSidechain) for (const c of d.message?.content || []) if (c.type === 'tool_use') { const t = { name: c.name, input: toolInput(c), out: '', id: c.id }; out.push(t); byId[c.id] = t; }
    if (d.type === 'user' && !d.isSidechain && Array.isArray(d.message?.content)) for (const c of d.message.content) if (c.type === 'tool_result' && byId[c.tool_use_id]) Object.assign(byId[c.tool_use_id], { out: (typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '')).slice(0, 200), error: !!c.is_error }); // an edit the gate denied changed nothing
  }
  return out;
}

// A read that returned something: a Read, or a search/command whose result is not empty or "no matches".
export const readSomething = (t) => t.name === 'Read' || !/^\s*(\[\])?\s*$|^No (matches|files) found|^Found 0 /i.test(String(t.out || ''));

// Tokens of the turn's main-agent responses, each message counted once (a streamed response is written as several
// lines that share message.id and usage; measure.mjs counts the same way).
export function turnUsage(lines, since = 0) {
  const { from } = turnStart(lines, since);
  const seen = new Set();
  const s = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }; // split: the quota does not weigh a cache read like a new token
  for (const d of lines.slice(from)) {
    const u = d.type === 'assistant' && !d.isSidechain ? d.message?.usage : null;
    if (!u || seen.has(d.message.id)) continue;
    seen.add(d.message.id);
    s.input += u.input_tokens || 0; s.cacheWrite += u.cache_creation_input_tokens || 0; s.cacheRead += u.cache_read_input_tokens || 0; s.output += u.output_tokens || 0;
  }
  const fresh = s.input + s.cacheWrite + s.output;
  return { total: fresh + s.cacheRead, fresh, ...s, responses: seen.size };
}

// The models the turn's own responses came from, in order, each once: a session that changed model in the middle (`/model`) lists two. A synthetic message and a
// subagent's response are not the session's model.
export function modelsOf(lines, since = 0) {
  const { from } = turnStart(lines, since);
  const out = [];
  for (const d of lines.slice(from)) {
    const m = d.type === 'assistant' && !d.isSidechain ? d.message?.model : null;
    if (m && m !== '<synthetic>' && !out.includes(m)) out.push(m);
  }
  return out;
}

// Tokens of the subagents a turn launched (Claude Code writes each one to <session>/subagents/*.jsonl, next to the
// session's transcript): every file with a response at or after `since`. Another agent's layout → zeros.
export const subagentDir = (transcriptPath) => transcriptPath.replace(/\.jsonl$/i, '') + '/subagents';
export function subagentUsage(transcriptPath, since = 0) {
  const s = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, files: 0 };
  if (!transcriptPath) return s;
  const dir = subagentDir(transcriptPath);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')); } catch { return s; }
  for (const n of names) {
    const seen = new Set();
    let counted = false;
    for (const d of parseLines(fs.readFileSync(`${dir}/${n}`, 'utf8'))) {
      const u = d.type === 'assistant' ? d.message?.usage : null;
      if (!u || seen.has(d.message.id) || (Date.parse(d.timestamp || '') || 0) < since) continue;
      seen.add(d.message.id); counted = true;
      s.input += u.input_tokens || 0; s.cacheWrite += u.cache_creation_input_tokens || 0; s.cacheRead += u.cache_read_input_tokens || 0; s.output += u.output_tokens || 0;
    }
    if (counted) s.files++;
  }
  return s;
}

// Cost per link (schema v1): each main-agent response of the turn goes to the step its tool calls served.
// routine = a department/waymark/review/docs skill, a waymark.mjs command, a read of a procedures file, the project's
// memory or the waymark references, the choice window; reply = a response with no tool call (the Cierre); work = the
// rest. A response with calls of several kinds is split by its calls (its routine part, its work part) and counted as a work
// response. Subagent tokens stay apart (withSubagents). Messages are
// counted once, like turnUsage.
const ROUTINE_CALL = (c) => {
  const i = c.input || {};
  if (c.name === 'Skill') return /^(dept-|waymark$|code-review$|library-docs$)/.test(String(i.skill || '').replace(PLUGIN, ''));
  if (c.name === 'AskUserQuestion') return true;
  if (c.name === 'Read') return /procedures\.md|[\\/]\.waymark[\\/]|[\\/]waymark[\\/]references[\\/]/.test(String(i.file_path || ''));
  return /\bwaymark\.mjs["']?\s+(pack|review|memory|tasks|check|engram|incidents|sync|notes|verify|attest)\b/.test(String(i.command || ''));
};
export function turnLinks(lines, since = 0) {
  const { from } = turnStart(lines, since);
  const byId = new Map();
  for (const d of lines.slice(from)) {
    const u = d.type === 'assistant' && !d.isSidechain ? d.message?.usage : null;
    if (!u) continue;
    const e = byId.get(d.message.id) || { u, calls: [] };
    for (const c of d.message.content || []) if (c.type === 'tool_use') e.calls.push(c);
    byId.set(d.message.id, e);
  }
  const zero = () => ({ responses: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });
  const links = { v: 1, routine: zero(), work: zero(), reply: zero() };
  const add = (l, u, part) => { l.input += Math.round((u.input_tokens || 0) * part); l.cacheWrite += Math.round((u.cache_creation_input_tokens || 0) * part); l.cacheRead += Math.round((u.cache_read_input_tokens || 0) * part); l.output += Math.round((u.output_tokens || 0) * part); };
  for (const { u, calls } of byId.values()) {
    if (!calls.length) { links.reply.responses++; add(links.reply, u, 1); continue; }
    // a response that loads a department beside the task's first read is split by its calls, as costByCall splits it: the work it does is work
    const routine = calls.filter(ROUTINE_CALL).length / calls.length;
    links[routine === 1 ? 'routine' : 'work'].responses++;
    if (routine) add(links.routine, u, routine);
    if (routine < 1) add(links.work, u, 1 - routine);
  }
  return links;
}

// The tokens of each tool call of the turn, as compact tuples [tool, link, input, cacheWrite, cacheRead, output] (record
// schema v2, docs/adr/0030). link is "r" for a routine call and "w" for work (ROUTINE_CALL, the same rule as turnLinks). A
// response that issues several calls is one billed response: its tokens are split among its calls in equal parts, the
// remainder going to the first ones, so the calls add up to the response and the turn's calls to links minus its replies.
export function costByCall(lines, since = 0) {
  const { from } = turnStart(lines, since);
  const byId = new Map();
  let model = null;
  for (const d of lines.slice(from)) {
    const u = d.type === 'assistant' && !d.isSidechain ? d.message?.usage : null;
    if (!u) continue;
    // the first response after a model change re-writes the whole cache: that is the change's cost, not the cost of the call it carries
    const changed = model && d.message?.model && d.message.model !== '<synthetic>' && d.message.model !== model && !byId.has(d.message.id);
    if (d.message?.model && d.message.model !== '<synthetic>') model = d.message.model;
    const e = byId.get(d.message.id) || { u: changed ? { ...u, cache_creation_input_tokens: 0 } : u, calls: [] };
    for (const c of d.message.content || []) if (c.type === 'tool_use') e.calls.push(c);
    byId.set(d.message.id, e);
  }
  const out = [];
  for (const { u, calls } of byId.values()) {
    const n = calls.length;
    if (!n) continue;
    const q = [u.input_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0, u.output_tokens || 0];
    calls.forEach((c, i) => out.push([String(c.name || '?').slice(0, 60), ROUTINE_CALL(c) ? 'r' : 'w', ...q.map((x) => Math.floor(x / n) + (i < x % n ? 1 : 0))]));
  }
  return out;
}

// A turn's usage plus its subagents' (same shape as turnUsage; `subagents` keeps their total apart).
export function withSubagents(usage, sub) {
  const fresh = sub.input + sub.cacheWrite + sub.output, total = fresh + sub.cacheRead;
  if (!total) return usage;
  return { ...usage, input: usage.input + sub.input, cacheWrite: usage.cacheWrite + sub.cacheWrite, cacheRead: usage.cacheRead + sub.cacheRead, output: usage.output + sub.output, fresh: usage.fresh + fresh, total: usage.total + total, subagents: total };
}

// The harness cut the turn (docs/adr/0048): its last message is a synthetic one no model wrote, with error `rate_limit` (the quota: session, spend or weekly
// limit) or `server_error` (the provider: a dropped connection, an overload). → { cause: 'usage limit' | 'provider', text } or null. Only the last message of
// the turn counts: a notice from an earlier turn, or the same words in a model's reply, excuse nothing.
// The quota also warns in the middle of the turn: a meta user message (usageLimitNote, "[Usage limit reached; a short grace allowance remains…") after
// which the model goes on for a short grace and ends as it can. → { cause: 'usage limit', text, grace: true }: the hook never blocks such a turn.
const GRACE = /^\s*\[Usage limit reached/i;
export const graceNotice = (d) => d.type === 'user' && !!d.isMeta && !d.isSidechain && (!!d.usageLimitNote || GRACE.test(promptText(d)));
export function externalStop(lines) {
  let last = null, grace = null;
  for (const d of lines) {
    if (isPrompt(d)) { last = null; grace = null; continue; }
    if (graceNotice(d)) grace = d;
    if (d.type === 'assistant' && !d.isSidechain) last = d;
  }
  if (grace && last?.message?.model !== '<synthetic>') return { cause: 'usage limit', text: promptText(grace).replace(/\s+/g, ' ').trim().slice(0, 160), grace: true };
  if (!last || last.message?.model !== '<synthetic>') return null;
  const text = (last.message?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
  const cause = last.error === 'rate_limit' ? 'usage limit' : last.error === 'server_error' ? 'provider' : null;
  return cause ? { cause, text: text.slice(0, 160) } : null;
}

// Context size and time of the last main-agent response, and whether the last answered turn opened with "Waymark →".
// A usage limit leaves a synthetic response (model "<synthetic>", usage all 0) that no model read: it is skipped, or the
// session would look empty and the brakes would let its costly resume through.
export function sessionState(lines) {
  let context = 0, lastAt = 0, opener = null, turn = null;
  for (const d of lines) {
    if (isPrompt(d)) { turn = { first: null }; continue; }
    if (d.type !== 'assistant' || d.isSidechain || d.message?.model === '<synthetic>') continue;
    const u = d.message?.usage;
    if (u) {
      context = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
      lastAt = Date.parse(d.timestamp || '') || lastAt;
    }
    const text = (d.message?.content || []).find((x) => x.type === 'text' && x.text.trim())?.text;
    if (turn && text && turn.first === null) { turn.first = text.trim(); opener = turn.first; }
  }
  return { context, lastAt, openedWithWaymark: !!opener && opener.startsWith('Waymark →') };
}

// Level declared in the turn's routing line ("Waymark → L2 · …"): 0 when there is none, 'Q' for questions. The LAST
// routing line wins: a question that turns into a change re-routes mid-turn.
// Only a line that starts with "Waymark →" routes; one quoted mid-sentence (evidence, an example) does not.
// Text written after a thinking block is not persisted (checked again 2026-10-02: a mid-turn re-route line was lost), so
// a re-route is also a tool call: the owner dept-* skill invoked with args "L<n>", which always comes after the
// turn's first text and therefore wins.
// "Waymark → L0|Q" (the template's "L<n>|Q" with L0 kept) is a question.
// The department may come without its prefix ("· frontend"): only the ten department names count as one.
const ROUTE = /^[ \t]*Waymark →\s*(L([0-3])(?:\s*(?:\||or)\s*Q)?|Q)\b(?:\s*·\s*((?:dept-)?(?:architecture|backend|data|devex|devops|frontend|product|qa|security|ux-ui))\b(?!-))?/gm;
const routes = (texts) => [...texts.join('\n').matchAll(ROUTE)];
const isQ = (m) => m[1] === 'Q' || /^L0\s*(?:\||or)\s*Q$/.test(m[1]);
const reroute = (tools = []) => {
  const r = tools.map((t) => ({ ...t, input: toolInput(t) })).filter((t) => t.name === 'Skill' && /^dept-/.test(String(t.input.skill || '')) && /^\s*(L[0-3])\b/i.test(String(t.input.args || '')));
  return r.length ? { level: Number(String(r[r.length - 1].input.args).trim()[1]), dept: String(r[r.length - 1].input.skill) } : null;
};
export function routedLevel(texts, tools) {
  const t = reroute(tools);
  if (t) return t.level;
  const all = routes(texts), m = all[all.length - 1];
  // a Q line after an L1-L3 route of the same turn is a note, not a re-route: it never lowers the level
  const numeric = all.filter((r) => !isQ(r));
  if (m && isQ(m) && numeric.length) return Number(numeric[numeric.length - 1][2]);
  return !m ? 0 : isQ(m) ? 'Q' : Number(m[2]);
}

// The Cierre heading: "## Cierre" at the start of a line. A mention inside a sentence ("until it writes its `## Cierre`")
// is not one (a Q answer that names it is not a closed task).
export const CIERRE = /^[ \t]*##\s*Cierre\b/m;

// An L1 with one real way says it in a `Camino: <it>` line before its first change and owes no choice window (Rule 0). One reading for the decision gate
// (tool-hook.mjs) and the Decision testigo (stop-hook.mjs). `before`: the index of the turn's first change; the line counts when it was said before that call.
export const CAMINO = /^[ \t]*(?:[-*][ \t]*)?Camino:[ \t]*\S/m;
export const caminoSaid = (turn, before = Infinity) => (turn?.textAt || []).some(([at, t]) => at <= before && CAMINO.test(String(t).replace(/\*\*|__/g, '')));

// A turn with no routing at all inherits the routing of the task's last routed turn (L1–L3) while that turn has not
// written its Cierre: a reply to a question asked in the chat (Codex) opens a new unrouted turn, which would read as L0
// and skip the gate. Looks back within the task (the two prompts before this one); an
// explicit "Waymark → L0" or a Q turn never passes its routing on. → { level, dept } or null.
export function inheritedRoute(lines, prompts = 2) {
  const now = currentTurn(lines);
  if (!lines.some(isPrompt) || routes(now.texts).length || reroute(now.tools)) return null;
  return openTaskRoute(lines, prompts);
}
// The route (level and department) of the task still open before this turn: the last numerically routed turn since the task's start that has not written its Cierre,
// whatever this turn says. A reply that continues the task is that task's, so a Q line on a reply that changes files is judged and gated at its level.
export function openTaskRoute(lines, prompts = 2) {
  const starts = [];
  for (let i = lines.length - 1; i >= 0 && starts.length <= prompts; i--) if (isPrompt(lines[i])) starts.push(i);
  for (let k = 1; k < starts.length; k++) {
    const t = currentTurn(lines.slice(0, starts[k - 1]));
    if (t.texts.some((x) => CIERRE.test(x.replace(/\*\*|__/g, '')))) return null; // the task closed
    if (!routes(t.texts).length && !reroute(t.tools)) continue; // another unrouted reply: keep looking back
    const level = routedLevel(t.texts, t.tools);
    return typeof level === 'number' && level > 0 ? { level, dept: routedDept(t.texts, t.tools) } : null;
  }
  return null;
}

// Department named in the last routing line ("Waymark → L2 · dept-frontend (+dept-ux-ui) · …") or re-route call, or null.
export function routedDept(texts, tools) {
  const t = reroute(tools);
  if (t) return t.dept;
  const all = routes(texts), real = all.filter((r) => !isQ(r)), pool = real.length ? real : all; // a Q line does not change the department of the route before it
  const dept = pool.length ? pool[pool.length - 1][3] : null;
  return dept ? (dept.startsWith('dept-') ? dept : `dept-${dept}`) : null;
}

// The questions a message ends asking, when it offers options: the block of question and option lines it ends with
// (and the line just before it, "Opciones: 1) A 2) B"), with at least 2 options among option lines ("- A", "1) A",
// "a. A"), an inline enumeration ("1) A 2) B") or "A o B" inside a question. → the question lines, or [].
const OPTION_LINE = /^\s*(?:[-*•]|\d+[.)]|[a-zA-Z][.)])\s+\S/;
const QUESTION_LINE = /\?[\s*_)]*$/;
export function closingQuestions(text) {
  const lines = String(text || '').replace(/\*\*|__/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  let i = lines.length;
  while (i > 0 && (QUESTION_LINE.test(lines[i - 1]) || OPTION_LINE.test(lines[i - 1]))) i--;
  const block = lines.slice(i), questions = block.filter((l) => QUESTION_LINE.test(l)).map((l) => l.trim());
  if (!questions.length) return [];
  const lead = i > 0 ? lines[i - 1] : '';
  const inline = (l) => (l.match(/(?:^|\s)\d+[.)]\s+\S/g) || []).length;
  const either = (l) => (QUESTION_LINE.test(l) && /\S\s+(?:o|u|or)\s+\S/i.test(l) ? 2 : 0);
  const options = Math.max(block.filter((l) => OPTION_LINE.test(l)).length, ...[lead, ...block].map(inline), ...block.map(either));
  return options >= 2 ? questions : [];
}
