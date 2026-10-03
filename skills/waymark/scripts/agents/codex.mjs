// Waymark · Codex CLI adapter (docs/adr/0008, 0009). Same exports as claude.mjs.
// Hooks (learn.chatgpt.com/docs/hooks, checked 2026-10-03, codex 0.160): ~/.codex/hooks.json, same events and output
// shapes as Claude Code; PreToolUse tool_name "Bash" (tool_input.command) or "apply_patch" (tool_input.command = the
// patch text); untrusted hooks are skipped until the user trusts them in /hooks. The transcript (rollout .jsonl) is "not a
// stable interface": read() converts what it needs, from the item_completed events seen in local rollouts (0.115–0.160):
// - UserMessage → a prompt; AgentMessage → assistant text; CommandExecution → Bash (+ its result and exit code);
//   FileChange → one Edit per changed path; McpToolCall → mcp__<server>__<tool>; WebSearch → WebSearch.
// - A read of <dir>/<skill>/SKILL.md counts as invoking that skill (Codex has no Skill tool).
// - request_user_input (Codex's choice window: Plan mode, or the default_mode_request_user_input flag) → AskUserQuestion
//   with the user's answers. request_user_input_async (seen in codex 0.160's default mode: {"accepted":true}, the answer
//   is the user's next message) → AskUserQuestion answered by that message; a rejected call (bad arguments) never counts.
//   Without either, a turn that ended asking in the chat and the user's next message count as the decisions asked in
//   chat, one per question line written after the turn's last action (user's choice, 2026-10-03 · T2i, T2j, T2k;
//   docs/adr/0009, 0010).
// - token_count → usage per response (cached input apart); turn_context → model; session_meta → Codex version.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTail, isPrompt } from '../transcript.mjs';
import { out as claudeOut } from './claude.mjs';

export const name = 'codex';
const HOME = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
export const instructions = path.join(HOME(), 'AGENTS.md');
export const lacks = ['review']; // routine steps this agent has no capability for: recorded as not applicable
export const out = claudeOut; // same output shapes (verified in the hooks docs)

const SKILL = /[\\/]([A-Za-z0-9:_-]+)[\\/]SKILL\.md\b/i;
const QUESTION = /^[^\n]*\?[ \t*_)]*$/gm; // a line that ends with "?" (also "¿…?")

const shellOf = (cmd) => {
  if (!Array.isArray(cmd)) return String(cmd || '');
  const i = cmd.findIndex((a) => /^-(Command|c)$/i.test(a));
  return i >= 0 ? cmd.slice(i + 1).join(' ') : cmd.join(' ');
};

// The rollout's rows → the core's lines (Claude Code .jsonl shape, canonical tool names).
// A question of request_user_input(_async) → { id, question, options: [{ label }] } ("question" or "title"; options as
// strings or { label }).
const asQuestion = (q) => ({ id: q.id, question: String(q.question || q.title || '').trim(), options: (q.options || []).map((o) => ({ label: String(o?.label ?? o) })) });
const bare = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*\(recomendad[oa]\)\s*$/, '').replace(/\s+/g, ' ').trim();

export function toLines(rows) {
  const lines = [], asked = new Map();
  let version = null, model = null, lastTotal = 0, tail = [], choiceInTurn = false, pendingAsync = [], n = 0;
  const assistant = (ts, content, extra = {}) => lines.push({ type: 'assistant', timestamp: ts, version, message: { id: `cx-${n++}`, model, content, ...extra } });
  const result = (ts, id, isError, text) => lines.push({ type: 'user', timestamp: ts, version, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: String(text || '').slice(0, 400) }] } });
  for (const d of rows) {
    const p = d.payload || {}, ts = d.timestamp;
    if (d.type === 'session_meta') { version = p.cli_version || version; continue; }
    if (d.type === 'turn_context') { model = p.model || model; continue; }
    if (d.type === 'response_item' && p.type === 'function_call' && /^request_user_input(_async)?$/.test(p.name)) {
      let a = {};
      try { a = JSON.parse(p.arguments || '{}'); } catch {}
      asked.set(p.call_id, { ts, async: p.name.endsWith('_async'), questions: (a.questions || []).map(asQuestion) });
      continue;
    }
    if (d.type === 'response_item' && p.type === 'function_call_output' && asked.has(p.call_id)) {
      const { ts: at, async, questions: qs } = asked.get(p.call_id);
      let o = {};
      try { o = JSON.parse(p.output || '{}'); } catch {}
      if (!o.answers && !o.accepted) continue; // rejected (e.g. "failed to parse function arguments"): the user never saw it
      choiceInTurn = true;
      // request_user_input_async: asked only once the user answers (their next message); an edit before that stays gated
      if (async) { pendingAsync.push({ id: p.call_id, qs }); continue; }
      assistant(at, [{ type: 'tool_use', name: 'AskUserQuestion', id: p.call_id, input: { questions: qs } }]);
      const answers = {};
      for (const q of qs) { const v = o.answers?.[q.id]?.answers; if (v?.length) answers[q.question] = v.join(','); }
      lines.push({ type: 'user', timestamp: ts, version, message: { content: [{ type: 'tool_result', tool_use_id: p.call_id, content: 'answered' }] }, toolUseResult: { questions: qs.map((q) => ({ question: q.question, options: q.options })), answers } });
      continue;
    }
    if (d.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage) {
      const total = p.info.total_token_usage?.total_tokens || 0;
      if (total <= lastTotal) continue; // a repeated count (rate-limit refresh) is not a new response
      lastTotal = total;
      const u = p.info.last_token_usage, cached = u.cached_input_tokens || 0;
      assistant(ts, [], { usage: { input_tokens: Math.max(0, (u.input_tokens || 0) - cached), cache_read_input_tokens: cached, cache_creation_input_tokens: u.cache_write_input_tokens || 0, output_tokens: u.output_tokens || 0 } });
      continue;
    }
    if (d.type !== 'event_msg' || p.type !== 'item_completed') continue;
    const it = p.item || {};
    if (it.type === 'UserMessage') {
      const text = (it.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
      const prompt = { type: 'user', uuid: `${p.turn_id || ''}:${it.id || n}`, timestamp: ts, version, message: { role: 'user', content: text } };
      if (!isPrompt(prompt)) { lines.push(prompt); continue; } // a hook's block reason fed back is not the user answering
      const reply = text.replace(/\s+/g, ' ').trim().slice(0, 300);
      for (const { id, qs } of pendingAsync) { // each question: the options the reply names, else the reply itself
        assistant(ts, [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { source: 'async', questions: qs } }]);
        const answers = Object.fromEntries(qs.map((q) => [q.question, q.options.map((o) => o.label).filter((l) => bare(l) && bare(reply).includes(bare(l))).join(',') || reply]));
        lines.push({ type: 'user', timestamp: ts, version, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered in the next message' }] }, toolUseResult: { source: 'async', questions: qs.map((q) => ({ question: q.question, options: q.options })), answers } });
      }
      // every question line the agent wrote after the turn's last action (3c: a closing summary without "?" hid them)
      const questions = !choiceInTurn && tail.length ? [...new Set([...tail.join('\n').matchAll(QUESTION)].map((m) => m[0].trim()))] : [];
      if (questions.length) { // the previous turn ended asking in the chat: this message answers it
        const id = `chat-${n}`;
        assistant(ts, [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { source: 'chat', questions: questions.map((question) => ({ question })) } }]);
        lines.push({ type: 'user', timestamp: ts, version, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered in chat' }] }, toolUseResult: { source: 'chat', questions: questions.map((question) => ({ question, options: [] })), answers: Object.fromEntries(questions.map((q) => [q, reply])) } });
      }
      lines.push(prompt);
      tail = []; choiceInTurn = false; pendingAsync = [];
    } else if (it.type === 'AgentMessage') {
      const text = (it.content || []).map((c) => c.text || '').join('\n');
      if (text.trim()) { assistant(ts, [{ type: 'text', text }]); tail.push(text); }
    } else if (/^(CommandExecution|FileChange|McpToolCall|WebSearch)$/.test(it.type)) tail = []; // an action: what follows is the turn's final stretch
    if (it.type === 'CommandExecution') {
      const command = shellOf(it.command), started = new Date((Date.parse(ts) || 0) - ((it.duration?.secs || 0) * 1000)).toISOString();
      const skill = command.match(SKILL)?.[1];
      if (skill) assistant(started, [{ type: 'tool_use', name: 'Skill', id: `${it.id}-skill`, input: { skill } }]);
      assistant(started, [{ type: 'tool_use', name: 'Bash', id: it.id, input: { command } }]);
      result(ts, it.id, (it.exit_code ?? 0) !== 0 || it.status === 'failed', it.aggregated_output);
    } else if (it.type === 'FileChange') {
      for (const file of Object.keys(it.changes || {})) assistant(ts, [{ type: 'tool_use', name: 'Edit', id: `${it.id}:${file}`, input: { file_path: file } }]);
    } else if (it.type === 'McpToolCall') {
      assistant(ts, [{ type: 'tool_use', name: `mcp__${it.server}__${it.tool}`, id: it.id, input: it.arguments || {} }]);
      result(ts, it.id, !!it.result?.isError, JSON.stringify(it.result?.content || ''));
    } else if (it.type === 'WebSearch') {
      assistant(ts, [{ type: 'tool_use', name: 'WebSearch', id: it.id, input: { query: it.query || '' } }]);
    }
  }
  return lines;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes));

// Files an apply_patch touches ("*** Add|Update|Delete File: <path>", "*** Move to: <path>"), resolved against cwd.
export function patchFiles(patch, cwd = process.cwd()) {
  return [...String(patch || '').matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to):\s*(.+?)\s*$/gm)].map((m) => path.resolve(cwd, m[1]));
}

export function call(hook) {
  const tool = hook.tool_name || '', input = hook.tool_input || {};
  if (tool === 'Bash') return { command: String(input.command || '') };
  if (/^(apply_patch|Edit|Write)$/.test(tool)) return { files: patchFiles(input.command, hook.cwd) };
  return null;
}

// One line added to the reminder and to the gate's message: how this agent does what the routine names in Claude terms.
export const note = (skillsDir) => ` In Codex: "invoke the skill <name>" = read ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md (that read is recorded as the call); a re-route is a new "Waymark → L<n> · <dept>" line; the choice window is request_user_input when you have it, otherwise put the options in the chat and end your turn — the user's reply counts as the decision.`;

// Rollouts of the sessions opened in cwd, newest first (session_meta.cwd of each file modified in the last 14 days).
export function sessions(cwd) {
  const root = path.join(HOME(), 'sessions'), files = [], since = Date.now() - 14 * 86400000;
  const walk = (d) => { try { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), s = fs.statSync(p); if (s.isDirectory()) walk(p); else if (n.endsWith('.jsonl') && s.mtimeMs > since) files.push({ p, t: s.mtimeMs }); } } catch {} };
  walk(root);
  const norm = (x) => String(x || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return files.filter(({ p }) => {
    try {
      const fd = fs.openSync(p, 'r'), buf = Buffer.alloc(64 * 1024);
      const len = fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
      return norm(buf.toString('utf8', 0, len).match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\\/g, '\\')) === norm(cwd);
    } catch { return false; }
  }).sort((a, b) => b.t - a.t).map((f) => f.p);
}
