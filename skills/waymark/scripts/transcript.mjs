// Waymark · shared reader for the agent's session transcript (Claude Code .jsonl), used by the hooks and measure.mjs.
// Offline and read-only. A "prompt" is a message the user typed: tool results, command echoes, system reminders,
// interruptions and background-task notifications (<task-notification>) are not prompts.
import fs from 'node:fs';

const TAIL = 2 * 1024 * 1024; // bytes read from the end of a transcript by the hooks

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

export const isPrompt = (d) => {
  if (d.type !== 'user' || d.isMeta || d.isSidechain) return false;
  const c = d.message?.content;
  if (Array.isArray(c) && c.some((x) => x.type === 'tool_result')) return false;
  const text = promptText(d);
  // A Stop-hook block reason fed back to the agent is not the user's prompt (the blocked turn's edits stay in its turn).
  return !!text.trim() && !/^\s*<(local-command|command-|system-reminder|task-notification)/.test(text) && !/^\[Request interrupted/.test(text) && !/^\s*(Stop hook feedback|Waymark: this L)/.test(text);
};

// Reads the transcript tail, doubling it until it holds `prompts` user prompts or the whole file (max 64 MB): a pasted
// image is a line of megabytes, and a turn whose prompt fell out of the tail was read as "no turn" — the gate skipped it
// and the record counted the whole tail (3c test A: 17.4M tokens recorded for a ~2% turn). read(bytes) → lines.
export function readTurns(read, prompts = 3, start = TAIL, max = 64 * 1024 * 1024) {
  let lines = read(start);
  for (let bytes = start * 2; bytes <= max && lines.filter(isPrompt).length < prompts; bytes *= 2) {
    const more = read(bytes);
    if (more.length <= lines.length) break; // the whole file was already read
    lines = more;
  }
  return lines;
}

// The index where the current turn starts: after its last prompt, or after `since` (ms) when that is later — a turn
// that a background notification started after a close has no prompt of its own (3c test A: the code-review agent's
// notification resumed the closed task and the record counted the previous task again).
const turnStart = (lines, since = 0) => {
  let i = lines.length - 1;
  while (i >= 0 && !isPrompt(lines[i])) i--;
  const promptAt = i >= 0 ? Date.parse(lines[i].timestamp || '') || 0 : 0;
  if (!since || promptAt > since) return { i, from: i + 1 }; // a prompt after the close starts the turn, as always
  const j = lines.findIndex((d, k) => k > i && (Date.parse(d.timestamp || '') || 0) > since);
  return { i, from: j < 0 ? lines.length : j };
};

// A skill or agent the turn launched in the background that has not notified yet (Claude Code: its tool result has
// toolUseResult.background, its end is a <task-notification> naming the tool-use id). The turn is not over: the agent
// waits for it and closes in the notification's turn (2026-10-03 · T2o: the hook judged T1 while its code-review ran).
// Background shell commands are not waited for: a dev server never notifies.
export function pendingBackground(lines, since = 0) {
  const { from } = turnStart(lines, since);
  const launched = [];
  for (const d of lines.slice(from)) {
    if (d.type !== 'user' || d.isSidechain || !d.toolUseResult?.background) continue;
    for (const c of Array.isArray(d.message?.content) ? d.message.content : []) if (c.type === 'tool_result') launched.push(c.tool_use_id);
  }
  if (!launched.length) return [];
  const notified = lines.filter((d) => d.type === 'user' && /<task-notification>/.test(promptText(d))).map(promptText).join('\n');
  return launched.filter((id) => !notified.includes(`<tool-use-id>${id}</tool-use-id>`));
}

// The current turn: everything after the last prompt (and after `since`). Returns its assistant texts and tool calls
// (main agent only).
export function currentTurn(lines, since = 0) {
  const { i, from } = turnStart(lines, since);
  const texts = [], tools = [], results = {};
  for (const d of lines.slice(from)) {
    const cmd = d.type === 'user' && promptText(d).match(/<command-name>\/?([^<\s]+)<\/command-name>/)?.[1];
    if (cmd) tools.push({ name: 'Skill', input: { skill: cmd, slash: true } }); // a slash command typed in the turn
    const at = Date.parse(d.timestamp || '') || 0;
    if (d.type === 'user' && !d.isSidechain && Array.isArray(d.message?.content)) {
      for (const c of d.message.content) if (c.type === 'tool_result') results[c.tool_use_id] = { at, error: !!c.is_error, text: (typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '')).slice(0, 400) };
    }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    for (const c of d.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) texts.push(c.text);
      if (c.type === 'tool_use') tools.push({ name: c.name, input: c.input || {}, id: c.id, at });
    }
  }
  const promptAt = i >= 0 ? Date.parse(lines[i].timestamp || '') || 0 : 0;
  return { found: i >= 0, prompt: i >= 0 ? promptText(lines[i]) : '', uuid: i >= 0 ? lines[i].uuid || '' : '', startedAt: Math.max(promptAt, since > promptAt ? since : 0), texts, tools, results };
}

// Every tool call of the main agent in the readable part of the session (for reads done in an earlier turn), with the
// start of its result (`out`) so a search that found nothing is not taken for a read.
export function sessionTools(lines) {
  const out = [], byId = {};
  for (const d of lines) {
    if (d.type === 'assistant' && !d.isSidechain) for (const c of d.message?.content || []) if (c.type === 'tool_use') { const t = { name: c.name, input: c.input || {}, out: '' }; out.push(t); byId[c.id] = t; }
    if (d.type === 'user' && !d.isSidechain && Array.isArray(d.message?.content)) for (const c of d.message.content) if (c.type === 'tool_result' && byId[c.tool_use_id]) byId[c.tool_use_id].out = (typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '')).slice(0, 200);
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

// Tokens of the subagents a turn launched (Claude Code writes each one to <session>/subagents/*.jsonl, next to the
// session's transcript): every file with a response at or after `since`. Another agent's layout → zeros.
export function subagentUsage(transcriptPath, since = 0) {
  const s = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, files: 0 };
  if (!transcriptPath) return s;
  const dir = transcriptPath.replace(/\.jsonl$/i, '') + '/subagents';
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

// A turn's usage plus its subagents' (same shape as turnUsage; `subagents` keeps their total apart).
export function withSubagents(usage, sub) {
  const fresh = sub.input + sub.cacheWrite + sub.output, total = fresh + sub.cacheRead;
  if (!total) return usage;
  return { ...usage, input: usage.input + sub.input, cacheWrite: usage.cacheWrite + sub.cacheWrite, cacheRead: usage.cacheRead + sub.cacheRead, output: usage.output + sub.output, fresh: usage.fresh + fresh, total: usage.total + total, subagents: total };
}

// Context size and time of the last main-agent response, and whether the last answered turn opened with "Waymark →".
export function sessionState(lines) {
  let context = 0, lastAt = 0, opener = null, turn = null;
  for (const d of lines) {
    if (isPrompt(d)) { turn = { first: null }; continue; }
    if (d.type !== 'assistant' || d.isSidechain) continue;
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
// routing line wins: a question that turns into a change re-routes mid-turn (test 2.0-1: a turn routed Q edited 8 files).
// Only a line that starts with "Waymark →" routes; one quoted mid-sentence (evidence, an example) does not.
// Text written after a thinking block is not persisted (checked again 2026-10-02: a mid-turn re-route line was lost), so
// a re-route is also a tool call: the owner dept-* skill invoked with args "L<n>", which always comes after the
// turn's first text and therefore wins.
// "Waymark → L0|Q" (the template's "L<n>|Q" with L0 kept) is a question (3c).
const ROUTE = /^[ \t]*Waymark →\s*(L([0-3])(?:\s*\|\s*Q)?|Q)\b(?:\s*·\s*(dept-[a-z-]+))?/gm;
const routes = (texts) => [...texts.join('\n').matchAll(ROUTE)];
const reroute = (tools = []) => {
  const r = tools.filter((t) => t.name === 'Skill' && /^dept-/.test(String(t.input.skill || '')) && /^\s*(L[0-3])\b/i.test(String(t.input.args || '')));
  return r.length ? { level: Number(String(r[r.length - 1].input.args).trim()[1]), dept: String(r[r.length - 1].input.skill) } : null;
};
export function routedLevel(texts, tools) {
  const t = reroute(tools);
  if (t) return t.level;
  const all = routes(texts), m = all[all.length - 1];
  return !m ? 0 : m[1] === 'Q' || /^L0\s*\|\s*Q$/.test(m[1]) ? 'Q' : Number(m[2]);
}

// The Cierre heading: "## Cierre" at the start of a line. A mention inside a sentence ("until it writes its `## Cierre`")
// is not one (2026-10-03 · T2n: a Q answer that named it was checked as a closed task).
export const CIERRE = /^[ \t]*##\s*Cierre\b/m;

// A turn with no routing at all inherits the routing of the task's last routed turn (L1–L3) while that turn has not
// written its Cierre (user's choice, 2026-10-03 · T2j): a reply to a question asked in the chat (Codex) opened a new
// unrouted turn, read as L0, and skipped the gate. Looks back within the task (the two prompts before this one); an
// explicit "Waymark → L0" or a Q turn never passes its routing on. → { level, dept } or null.
export function inheritedRoute(lines, prompts = 2) {
  const starts = [];
  for (let i = lines.length - 1; i >= 0 && starts.length <= prompts; i--) if (isPrompt(lines[i])) starts.push(i);
  if (!starts.length) return null;
  const turnAt = (k) => currentTurn(lines.slice(0, k === 0 ? lines.length : starts[k - 1]));
  const now = turnAt(0);
  if (routes(now.texts).length || reroute(now.tools)) return null;
  for (let k = 1; k < starts.length; k++) {
    const t = turnAt(k);
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
  const all = routes(texts);
  return all.length ? all[all.length - 1][3] || null : null;
}
