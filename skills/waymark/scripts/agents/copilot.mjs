// Waymark · Copilot CLI adapter (docs/adr/0022). Same exports as claude.mjs, plus input() and toLines().
// Hooks (docs.github.com/en/copilot/reference/hooks-reference, checked 2026-10-13): ~/.copilot/hooks/waymark.json
// (COPILOT_HOME moves the folder), `"version": 1` and flat entries ({command}) under Claude Code's event names
// (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop). With those names the payload is the VS Code format:
// hook_event_name, session_id, cwd, prompt, tool_name (the Claude tool name: Bash, Edit, Write), tool_input,
// stop_hook_active. User hooks need no trust (only repository hooks need workspace admission).
// - Out: SessionStart and PostToolUse add `additionalContext`; PreToolUse denies with `permissionDecision: "deny"` and
//   its reason; Stop blocks with `decision: "block"`, whose reason is the next prompt (8 blocks in a row end the turn).
//   A command hook's UserPromptSubmit output is dropped: no per-prompt reminder and no prompt brake (no blockPrompt; the
//   brake becomes a line nobody sees). The hook still runs: the git snapshot and the open turn. The card and the block
//   in copilot-instructions.md carry Rule 0.
// - The turn: the transcript's format is not documented. read() takes ~/.copilot/session-state/<session>/events.jsonl as
//   the community describes it (github/copilot-cli#3551, CLI 1.0.54): one event per line {type, data, id, timestamp};
//   user.message (data.content as typed), assistant.message (data.content), tool.execution_start (toolCallId, toolName,
//   arguments) and tool.execution_complete (toolCallId, success, result.content, error). A broken line is skipped
//   (github/copilot-cli#4098). Unconfirmed on a live session: adapters/copilot.md lists what to check.
import fs from 'node:fs';
import path from 'node:path';
import { readTail, clipOutput, closingQuestions, isPrompt } from '../transcript.mjs';
import { agentDir, known } from './paths.mjs';
import { patchFiles } from './codex.mjs';

export const name = 'copilot';
const HOME = () => agentDir(known('copilot'));
export const instructions = path.join(HOME(), 'copilot-instructions.md');
export const preContext = false; // PreToolUse documents no additionalContext: the pack goes with the result (PostToolUse)
export const lacks = []; // its review is waymark.mjs review

export const out = {
  context: (event, text) => ({ additionalContext: text }),
  deny: (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason }),
  block: (reason) => ({ decision: 'block', reason }),
  notice: () => ({}), // no documented field shows text to the user
};

const logOf = (session) => path.join(HOME(), 'session-state', String(session || 'unknown').replace(/[^\w.-]+/g, '_'), 'events.jsonl');
const object = (v) => { if (typeof v === 'string') { try { v = JSON.parse(v); } catch {} } return v && typeof v === 'object' ? v : {}; };

// The hook's stdin → the core's fields. Claude-named events send snake_case; the camelCase payload is read too, and a
// missing event name is inferred from the fields.
export function input(h) {
  const session = h.session_id || h.sessionId || 'unknown', tool = h.tool_name || h.toolName || '';
  const result = h.tool_result ?? h.toolResult, failed = tool && h.error !== undefined;
  const event = h.hook_event_name || (tool ? (result !== undefined || failed ? 'PostToolUse' : 'PreToolUse')
    : h.prompt !== undefined ? 'UserPromptSubmit' : (h.stop_reason || h.stopReason || h.stop_hook_active !== undefined) ? 'Stop' : h.source ? 'SessionStart' : '');
  const log = logOf(session);
  return { ...h, session_id: session, cwd: h.cwd || process.cwd(), hook_event_name: event,
    ...(tool ? { tool_name: tool, tool_input: object(h.tool_input ?? h.toolArgs) } : {}),
    transcript_path: fs.existsSync(log) ? log : h.transcript_path || h.transcriptPath || log,
    stop_hook_active: !!(h.stop_hook_active ?? h.stopHookActive) };
}

const SHELL = /^(Bash|PowerShell|bash|powershell|shell)$/;
const EDIT = /^(Edit|Write|MultiEdit|edit|create|write|str_replace_editor|str_replace|insert)$/;
const PATCH = /^apply_patch$/;
const READ = /^(Read|view|read)$/;
const SKILL_TOOL = /^(Skill|skill)$/;
const ASK = /^(AskUserQuestion|ask_user|ask_question)$/;
const SKILL_FILE = /[\\/]([A-Za-z0-9:_-]+)[\\/]SKILL\.md$/i;
const fileOf = (i = {}) => i.file_path || i.path || i.filePath || i.file || '';
const patchOf = (i = {}) => i.input || i.patch || i.command || '';
const textOf = (v) => (typeof v === 'string' ? v : v == null ? '' : v.content != null ? textOf(v.content) : v.message != null ? String(v.message) : JSON.stringify(v));
// The labels a result names, without one that is only part of a longer label it also names ("No" inside "Not now").
const chosen = (labels, said) => { const hit = labels.filter((l) => l && said.includes(l)); return hit.filter((l) => !hit.some((o) => o !== l && o.includes(l))).join(','); };
const asQuestion = (q) => ({ question: String(q?.question || q?.prompt || q?.title || q || '').trim(), options: (q?.choices || q?.options || []).map((o) => ({ label: String(o?.label ?? o) })) });

// The session log → the core's lines (Claude Code .jsonl shape, canonical tool names).
export function toLines(rows, cwd = process.cwd()) {
  const lines = [], asked = new Map();
  let n = 0, tail = [], choiceInTurn = false;
  const assistant = (r, content) => lines.push({ type: 'assistant', timestamp: r.timestamp, message: { id: r.id || `co-${n++}`, model: r.data?.model, content } });
  for (const r of rows) {
    const d = r?.data || {};
    if (r?.type === 'user.message') {
      const prompt = { type: 'user', uuid: r.id || `co-${n++}`, timestamp: r.timestamp, message: { role: 'user', content: String(d.content || '') } };
      if (!isPrompt(prompt)) { lines.push(prompt); continue; }
      const questions = !choiceInTurn && tail.length ? [...new Set(tail.flatMap(closingQuestions))] : [];
      if (questions.length) { // the previous turn ended asking in the chat: this prompt answers it
        const id = `chat-${n++}`, reply = String(d.content || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        assistant({ timestamp: r.timestamp }, [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { source: 'chat', questions: questions.map((question) => ({ question })) } }]);
        lines.push({ type: 'user', timestamp: r.timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered in chat' }] }, toolUseResult: { source: 'chat', questions: questions.map((question) => ({ question, options: [] })), answers: Object.fromEntries(questions.map((q) => [q, reply])) } });
      }
      lines.push(prompt);
      tail = []; choiceInTurn = false;
    } else if (r?.type === 'assistant.message') {
      if (String(d.content || '').trim()) { assistant(r, [{ type: 'text', text: d.content }]); tail.push(d.content); }
    } else if (r?.type === 'tool.execution_start') {
      tail = []; // an action: what follows is the turn's final stretch
      const id = d.toolCallId || `co-call-${n++}`, tool = String(d.toolName || ''), i = object(d.arguments);
      if (ASK.test(tool)) { asked.set(id, (i.questions || [i]).map(asQuestion)); assistant(r, [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { questions: asked.get(id) } }]); continue; }
      if (SKILL_TOOL.test(tool)) { assistant(r, [{ type: 'tool_use', name: 'Skill', id, input: { skill: String(i.skill || i.name || '') } }]); continue; }
      const skill = READ.test(tool) && fileOf(i).match(SKILL_FILE)?.[1];
      if (skill && skill !== 'code-review') assistant(r, [{ type: 'tool_use', name: 'Skill', id: `${id}-skill`, input: { skill } }]);
      if (PATCH.test(tool)) { // one Edit per file the patch touches
        assistant(r, patchFiles(patchOf(i), cwd).map((file_path, k) => ({ type: 'tool_use', name: 'Edit', id: k ? `${id}-${k}` : id, input: { file_path } })));
        continue;
      }
      const use = SHELL.test(tool) ? ['Bash', { command: String(i.command || '') }]
        : EDIT.test(tool) ? ['Edit', { file_path: fileOf(i) }]
          : READ.test(tool) ? ['Read', { file_path: fileOf(i) }] : [tool, i];
      assistant(r, [{ type: 'tool_use', name: use[0], id, input: use[1] }]);
    } else if (r?.type === 'tool.execution_complete') {
      const id = d.toolCallId, failed = d.success === false;
      if (asked.has(id) && !failed) { // answered: the labels its result names, else the result itself
        const qs = asked.get(id), said = textOf(d.result);
        const answers = Object.fromEntries(qs.map((q) => [q.question, chosen(q.options.map((o) => o.label), said) || said.slice(0, 300)]));
        lines.push({ type: 'user', timestamp: r.timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] }, toolUseResult: { questions: qs, answers } });
        choiceInTurn = true;
        continue;
      }
      lines.push({ type: 'user', timestamp: r.timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: clipOutput(failed ? textOf(d.error) || textOf(d.result) : textOf(d.result)) }] } });
    }
  }
  return lines;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes), hook.cwd);

export function call(hook) {
  const tool = hook.tool_name || '', i = hook.tool_input || {};
  if (SHELL.test(tool)) return { command: String(i.command || '') };
  if (PATCH.test(tool)) return { files: patchFiles(patchOf(i), hook.cwd) };
  if (EDIT.test(tool)) return { files: [fileOf(i)].filter(Boolean) };
  return null;
}

export const note = (skillsDir) => ` In Copilot CLI: invoke a department with the skill tool (or read ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md, recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>; the choice window is ask_user, otherwise put the options in the chat and end your turn — the user's reply counts as the decision.`;

// The session logs opened in cwd, newest first (session.start's context.cwd).
export function sessions(cwd) {
  const root = path.join(HOME(), 'session-state'), norm = (x) => String(x || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  try {
    return fs.readdirSync(root).map((d) => path.join(root, d, 'events.jsonl')).filter((f) => fs.existsSync(f))
      .filter((f) => {
        const fd = fs.openSync(f, 'r'), buf = Buffer.alloc(64 * 1024), len = fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        const start = buf.toString('utf8', 0, len).split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.type === 'session.start');
        return norm(start?.data?.context?.cwd || start?.data?.cwd) === norm(cwd);
      })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch { return []; }
}
