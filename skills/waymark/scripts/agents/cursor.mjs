// Waymark · Cursor adapter (docs/adr/0021). Same exports as claude.mjs, plus input(), deferPrompt() and takePrompt().
// Hooks (cursor.com/docs/hooks, checked 2026-10-12): ~/.cursor/hooks.json, events sessionStart, beforeSubmitPrompt,
// preToolUse, postToolUse, postToolUseFailure, afterAgentResponse and stop, each run as `node <script> --agent cursor`
// (install-hooks.mjs). Every payload carries conversation_id, generation_id, model, cursor_version, workspace_roots and
// transcript_path; user hooks run from ~/.cursor, so the project is workspace_roots[0], never process.cwd().
// - Out: sessionStart and postToolUse add `additional_context`; preToolUse denies with `permission: deny` plus
//   `agent_message`; beforeSubmitPrompt only takes `continue`/`user_message` (no context: the per-prompt reminder waits
//   for the turn's first postToolUse); stop's `followup_message` is sent as the next prompt (a block), `loop_count > 0`
//   once it was. An answer without a decision is `{}`, never `permission: allow`, which would skip Cursor's own approval.
// - The turn: the transcript's format is not documented, so input() journals each hook's event to
//   ~/.waymark/cursor/<conversation>.jsonl and read() converts that journal into the core's lines (as OpenCode's dump):
//   beforeSubmitPrompt → a prompt; afterAgentResponse → assistant text; preToolUse → the tool call (Shell → Bash,
//   Write/Edit/StrReplace/MultiEdit/Delete → Edit, Read → Read, a read of <dir>/<skill>/SKILL.md → also Skill, an
//   ask-question tool → AskUserQuestion); postToolUse(Failure) → its result (an error when it failed or its output names a
//   non-zero exit code). No decision tool answered in the turn: the questions a reply ended asking, with options, and the
//   user's next prompt count as the decision asked in chat (transcript.mjs closingQuestions, as in Codex).
// - The text of a reply arrives when the message ends (afterAgentResponse), after its tool calls: the decision gate
//   before an edit sees the routing line only once a reply ends; the end-of-turn hook sees the whole turn.
// - Claude Code's hooks, which Cursor also runs from ~/.claude/settings.json, step aside (agents/index.mjs parseHook).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTail, clipOutput, closingQuestions, isPrompt } from '../transcript.mjs';

export const name = 'cursor';
// No global instructions file (User Rules live in Cursor's settings): the session card carries the Rule 0 block.
export const instructions = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'instructions.md');
export const ruleInCard = true;
export const preContext = false; // preToolUse cannot add context: the pack goes with the result (postToolUse)
export const lacks = []; // its review is waymark.mjs review
export const dumpDir = () => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'cursor');

const EVENT = { sessionStart: 'SessionStart', beforeSubmitPrompt: 'UserPromptSubmit', preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', postToolUseFailure: 'PostToolUse', afterAgentResponse: 'AfterAgentResponse', stop: 'Stop' };
export const out = {
  context: (event, text) => ({ additional_context: text }),
  deny: (reason) => ({ permission: 'deny', user_message: reason, agent_message: reason }),
  block: (reason) => ({ followup_message: reason }), // stop: Cursor sends it as the user's next message
  blockPrompt: (reason) => ({ continue: false, user_message: reason }), // beforeSubmitPrompt: the prompt never reaches the model
  notice: () => ({}), // stop shows nothing to the user
  pass: (event) => (event === 'UserPromptSubmit' ? { continue: true } : {}), // no decision: the tool or prompt goes on
};

const safe = (s) => String(s || 'unknown').replace(/[^\w.-]+/g, '_');
const journal = (session) => path.join(dumpDir(), `${safe(session)}.jsonl`);
const text = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const prune = (days = 14) => {
  for (const f of fs.readdirSync(dumpDir())) {
    const p = path.join(dumpDir(), f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > days * 86400000) fs.rmSync(p, { force: true }); } catch {}
  }
};

// The hook's stdin → the core's fields (session_id, cwd, prompt, transcript_path = the journal, hook_event_name in the
// core's names, stop_hook_active, agent_version), journaling the event first.
export function input(h) {
  const session = h.conversation_id || h.session_id || 'unknown';
  const cwd = h.cwd || h.workspace_roots?.[0] || process.env.CURSOR_PROJECT_DIR || process.cwd();
  const hook = { ...h, raw_event: h.hook_event_name, hook_event_name: EVENT[h.hook_event_name] || h.hook_event_name, session_id: session, cwd,
    transcript_path: journal(session), stop_hook_active: Number(h.loop_count || 0) > 0, agent_version: h.cursor_version || null };
  if (h.hook_event_name && EVENT[h.hook_event_name]) {
    const row = { at: new Date().toISOString(), event: h.hook_event_name, cwd, model: h.model || null, version: h.cursor_version || null, generation: h.generation_id || null };
    if (h.prompt !== undefined) row.prompt = String(h.prompt);
    if (h.text !== undefined) row.text = String(h.text);
    if (h.tool_name) Object.assign(row, { tool: h.tool_name, input: h.tool_input || {}, id: h.tool_use_id || null });
    if (h.tool_output !== undefined) { row.output = clipOutput(text(h.tool_output)); row.exit = exitOf(text(h.tool_output)); } // the exit code before the clip
    if (h.error_message !== undefined) row.error = clipOutput(text(h.error_message));
    try {
      fs.mkdirSync(dumpDir(), { recursive: true });
      if (!fs.existsSync(journal(session))) prune(); // a new conversation: journals untouched for 14 days go
      fs.appendFileSync(journal(session), JSON.stringify(row) + '\n');
    } catch {}
  }
  return hook;
}

// The per-prompt reminder: kept at beforeSubmitPrompt, handed over with the turn's first tool result.
const pending = (session) => path.join(dumpDir(), `${safe(session)}.reminder`);
export function deferPrompt(hook, reminder) {
  try { fs.mkdirSync(dumpDir(), { recursive: true }); fs.writeFileSync(pending(hook.session_id), reminder); } catch {}
  return out.pass('UserPromptSubmit');
}
export function takePrompt(hook) {
  try { const t = fs.readFileSync(pending(hook.session_id), 'utf8'); fs.rmSync(pending(hook.session_id), { force: true }); return t; } catch { return ''; }
}

const SKILL = /[\\/]([A-Za-z0-9:_-]+)[\\/]SKILL\.md$/i;
const ASK = /^(ask_?(user_?)?questions?|askquestion|cursor\/ask_question)$/i;
const fileOf = (i = {}) => i.file_path || i.path || i.target_file || i.filePath || i.file || '';
const exitOf = (output) => { try { const o = JSON.parse(output); const c = o?.exitCode ?? o?.exit_code ?? o?.returnCode; return typeof c === 'number' ? c : 0; } catch { return 0; } };
const asQuestion = (q) => ({ question: String(q?.question || q?.prompt || q?.title || q || '').trim(), options: (q?.options || []).map((o) => ({ label: String(o?.label ?? o) })) });

// The journal → the core's lines (Claude Code .jsonl shape, canonical tool names).
export function toLines(rows) {
  const lines = [], asked = new Map();
  let n = 0, tail = [], choiceInTurn = false;
  const assistant = (r, content) => lines.push({ type: 'assistant', timestamp: r.at, version: r.version, message: { id: `cu-${n++}`, model: r.model, content } });
  for (const r of rows) {
    if (r.event === 'beforeSubmitPrompt') {
      const prompt = { type: 'user', uuid: `${r.generation || ''}:${n++}`, timestamp: r.at, version: r.version, message: { role: 'user', content: r.prompt || '' } };
      if (!isPrompt(prompt)) { lines.push(prompt); continue; } // a stop hook's followup is not the user answering
      const questions = !choiceInTurn && tail.length ? [...new Set(tail.flatMap(closingQuestions))] : [];
      if (questions.length) { // the previous turn ended asking in the chat: this prompt answers it
        const id = `chat-${n}`, reply = String(r.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        assistant(r, [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { source: 'chat', questions: questions.map((question) => ({ question })) } }]);
        lines.push({ type: 'user', timestamp: r.at, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered in chat' }] }, toolUseResult: { source: 'chat', questions: questions.map((question) => ({ question, options: [] })), answers: Object.fromEntries(questions.map((q) => [q, reply])) } });
      }
      lines.push(prompt);
      tail = []; choiceInTurn = false;
    } else if (r.event === 'afterAgentResponse') {
      if (String(r.text || '').trim()) { assistant(r, [{ type: 'text', text: r.text }]); tail.push(r.text); }
    } else if (r.event === 'preToolUse') {
      tail = []; // an action: what follows is the turn's final stretch
      const id = r.id || `cu-call-${n}`, i = r.input || {};
      if (ASK.test(r.tool || '')) { asked.set(id, (i.questions || [i]).map(asQuestion)); assistant(r, [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { questions: asked.get(id) } }]); continue; }
      const skill = /^Read(File)?$/i.test(r.tool) && fileOf(i).match(SKILL)?.[1];
      if (skill && skill !== 'code-review') assistant(r, [{ type: 'tool_use', name: 'Skill', id: `${id}-skill`, input: { skill } }]);
      const tool = /^(Shell|Bash|Terminal|run_terminal_cmd)$/i.test(r.tool) ? ['Bash', { command: String(i.command || '') }]
        : /^(Write|Edit|StrReplace|MultiEdit|Delete|search_replace|edit_file)$/i.test(r.tool) ? ['Edit', { file_path: fileOf(i) }]
          : /^Read(File)?$/i.test(r.tool) ? ['Read', { file_path: fileOf(i) }] : [r.tool, i];
      assistant(r, [{ type: 'tool_use', name: tool[0], id, input: tool[1] }]);
    } else if (r.event === 'postToolUse' || r.event === 'postToolUseFailure') {
      const id = r.id, failed = r.event === 'postToolUseFailure' || (r.exit ?? exitOf(r.output)) !== 0;
      if (asked.has(id) && !failed) { // answered: the labels its output names, else the output itself
        const qs = asked.get(id), said = String(r.output || '');
        const answers = Object.fromEntries(qs.map((q) => [q.question, q.options.map((o) => o.label).filter((l) => l && said.includes(l)).join(',') || said.slice(0, 300)]));
        lines.push({ type: 'user', timestamp: r.at, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] }, toolUseResult: { questions: qs, answers } });
        choiceInTurn = true;
        continue;
      }
      lines.push({ type: 'user', timestamp: r.at, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: clipOutput(r.error || r.output || '') }] } });
    }
  }
  return lines;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes));

export function call(hook) {
  const tool = hook.tool_name || '', i = hook.tool_input || {};
  if (/^(Shell|Bash|Terminal|run_terminal_cmd)$/i.test(tool)) return { command: String(i.command || '') };
  if (/^(Write|Edit|StrReplace|MultiEdit|Delete|search_replace|edit_file)$/i.test(tool)) return { files: [fileOf(i)].filter(Boolean) };
  return null;
}

export const note = (skillsDir) => ` In Cursor: invoke a department by reading ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md (that read is recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>; the choice window is the ask-questions tool when you have it, otherwise put the options in the chat and end your turn — the user's reply counts as the decision.`;

// The journals of the conversations opened in cwd, newest first (each row carries its workspace).
export function sessions(cwd) {
  const want = String(cwd).replace(/\\/g, '/').toLowerCase();
  try {
    return fs.readdirSync(dumpDir()).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dumpDir(), f))
      .filter((f) => String(readTail(f, 64 * 1024).find((r) => r.cwd)?.cwd || '').replace(/\\/g, '/').toLowerCase() === want)
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch { return []; }
}
