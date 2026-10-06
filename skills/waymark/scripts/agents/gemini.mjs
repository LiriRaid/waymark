// Waymark · Gemini CLI adapter (docs/adr/0013). Same exports as claude.mjs.
// Hooks (google-gemini/gemini-cli docs/hooks/reference.md and the 0.39 bundle): ~/.gemini/settings.json "hooks", events
// SessionStart, BeforeAgent (stdin prompt), BeforeTool (tool_name, tool_input) and AfterAgent (prompt_response,
// stop_hook_active). additionalContext under hookSpecificOutput adds context; {"decision":"deny","reason"} denies a tool
// (BeforeTool) or sends the reason back as a new prompt so the agent continues (AfterAgent); systemMessage is shown to the
// user. Tools: run_shell_command (command), write_file / replace / read_file (file_path), ask_user (questions[]; its result
// is {"answers":{"<index>":"<label>"}}).
// The transcript (~/.gemini/tmp/<project>/chats/session-*.jsonl) is append-only: line 1 is the session's metadata, every
// other line a whole message {id, timestamp, type: "user"|"gemini"|…, content, toolCalls[], tokens}; a message updated
// later is written again with the same id (the last one wins), "$set" lines carry metadata and "$rewindTo": <id> drops
// that message and every later one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTail } from '../transcript.mjs';

export const name = 'gemini';
const HOME = () => process.env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini');
export const instructions = path.join(HOME(), 'GEMINI.md');
export const preContext = false; // BeforeTool cannot add context: the pack goes with the result (AfterTool)
export const lacks = []; // no code-review skill in Gemini CLI: its review is waymark.mjs review

// The core's event names → Gemini's.
const EVENT = { SessionStart: 'SessionStart', UserPromptSubmit: 'BeforeAgent', PreToolUse: 'BeforeTool', PostToolUse: 'AfterTool', Stop: 'AfterAgent' };
export const out = {
  context: (event, text) => ({ hookSpecificOutput: { hookEventName: EVENT[event] || event, additionalContext: text } }),
  deny: (reason) => ({ decision: 'deny', reason }),
  block: (reason) => ({ decision: 'deny', reason }), // AfterAgent: the reason goes back as a prompt and the agent continues
  notice: (text) => ({ systemMessage: text }),
};

const SKILL = /[\\/]([A-Za-z0-9:_-]+)[\\/]SKILL\.md$/i;
const textOf = (content) => (typeof content === 'string' ? content : (Array.isArray(content) ? content : []).map((p) => (typeof p === 'string' ? p : p?.text || '')).join('\n'));
const resultText = (r) => (typeof r === 'string' ? r : JSON.stringify(r ?? ''));

// The messages as Gemini last wrote them, in order: the last line of each id, without the rewound ones.
export function messagesOf(rows) {
  const order = [], byId = new Map();
  for (const d of rows) {
    if (!d || typeof d !== 'object' || d.$set) continue;
    if (d.$rewindTo) {
      const at = order.indexOf(d.$rewindTo);
      if (at >= 0) for (const id of order.splice(at)) byId.delete(id);
      continue;
    }
    if (!d.id || !d.type) continue; // the metadata line
    if (!byId.has(d.id)) order.push(d.id);
    byId.set(d.id, d);
  }
  return order.map((id) => byId.get(id));
}

// The messages → the core's lines (Claude Code .jsonl shape, canonical tool names).
export function toLines(rows) {
  const lines = [];
  let n = 0;
  const assistant = (ts, content, extra = {}) => lines.push({ type: 'assistant', timestamp: ts, message: { id: `gm-${n++}`, content, ...extra } });
  for (const m of messagesOf(rows)) {
    const ts = m.timestamp;
    if (m.type === 'user') {
      const text = textOf(m.content);
      if (text.trim()) lines.push({ type: 'user', uuid: m.id, timestamp: ts, message: { role: 'user', content: text } });
      continue;
    }
    if (m.type !== 'gemini') continue;
    const text = textOf(m.content);
    if (text.trim()) assistant(ts, [{ type: 'text', text }], { model: m.model });
    for (const c of m.toolCalls || []) {
      const a = c.args || {}, at = c.timestamp || ts, isError = /error|cancel/i.test(String(c.status || ''));
      const res = () => lines.push({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: c.id, is_error: isError, content: resultText(c.result).slice(0, 400) }] } });
      if (c.name === 'ask_user') {
        const qs = (a.questions || []).map((q) => ({ question: String(q.question || q.header || '').trim(), options: (q.options || []).map((o) => ({ label: String(o?.label ?? o) })) }));
        assistant(at, [{ type: 'tool_use', name: 'AskUserQuestion', id: c.id, input: { questions: qs } }]);
        let picked = {};
        try { picked = JSON.parse(resultText(c.result).match(/\{\\?"answers\\?"\s*:\s*\{[^}]*\}\s*\}/)?.[0].replace(/\\"/g, '"') || '{}').answers || {}; } catch {}
        const answers = Object.fromEntries(qs.map((q, i) => [q.question, String(picked[i] ?? '')]).filter(([, v]) => v));
        if (!isError && Object.keys(answers).length) lines.push({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: c.id, content: 'answered' }] }, toolUseResult: { questions: qs, answers } });
        else res();
        continue;
      }
      const skill = c.name === 'read_file' && String(a.file_path || '').match(SKILL)?.[1];
      if (skill) assistant(at, [{ type: 'tool_use', name: 'Skill', id: `${c.id}-skill`, input: { skill } }]);
      const tool = { run_shell_command: ['Bash', { command: String(a.command || '') }], write_file: ['Write', { file_path: a.file_path }], replace: ['Edit', { file_path: a.file_path }],
        read_file: ['Read', { file_path: a.file_path }], grep_search: ['Grep', { pattern: a.pattern, path: a.dir_path || a.path }], glob: ['Glob', { pattern: a.pattern }],
        web_fetch: ['WebFetch', { url: a.url || a.prompt }], google_web_search: ['WebSearch', { query: a.query }] }[c.name] || [c.name, a];
      assistant(at, [{ type: 'tool_use', name: tool[0], id: c.id, input: tool[1] }]);
      res();
    }
    const t = m.tokens;
    if (t) assistant(ts, [], { usage: { input_tokens: Math.max(0, (t.input || 0) - (t.cached || 0)), cache_read_input_tokens: t.cached || 0, cache_creation_input_tokens: 0, output_tokens: (t.output || 0) + (t.thoughts || 0) } });
  }
  return lines;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes));

export function call(hook) {
  const tool = hook.tool_name || '', input = hook.tool_input || {};
  if (tool === 'run_shell_command') return { command: String(input.command || '') };
  if (/^(write_file|replace)$/.test(tool)) return { files: [input.file_path].filter(Boolean) };
  return null;
}

export const note = (skillsDir) => ` In Gemini CLI: "invoke the skill <name>" = read_file ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md (that read is recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>; the choice window is ask_user.`;

// Chats of the sessions opened in cwd, newest first (~/.gemini/projects.json maps the folder to its project id).
export function sessions(cwd) {
  let id = null;
  try { id = JSON.parse(fs.readFileSync(path.join(HOME(), 'projects.json'), 'utf8')).projects?.[String(cwd).toLowerCase()]; } catch {}
  if (!id) return [];
  const dir = path.join(HOME(), 'tmp', id, 'chats');
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch { return []; }
}
