// Waymark · Amp adapter (docs/adr/0041). Same exports as claude.mjs, plus input().
// Amp's extension point is a plugin (ampcode.com/docs/customize/plugins, /docs/plugin-api and /docs/customize/agents-md, checked
// 2026-10-19): `amp-plugin.js`, installed as ~/.config/amp/plugins/waymark.js by install-hooks.mjs, runs the four scripts with
// `--agent amp` on session.start, agent.start, tool.call / tool.result and agent.end, and reads each hook's answer itself: context is
// returned as the message appended to the next turn, a deny as {action: 'reject-and-continue'}, a block as {action: 'continue'}.
// The payload is Claude Code's (hook_event_name, session_id = the thread, cwd = the workspace, prompt, tool_name, tool_input,
// tool_response {status, error, output}, last_assistant_message, stop_hook_active) plus what Amp's own helpers say about the call:
// `command` (shellCommandFromToolCall) and `files` (filesModifiedByToolCall), because the names of a tool's input fields are not documented.
// - The turn: a plugin reads a thread's messages only a few at a time, so input() journals each event (agents/journal.mjs) and read()
//   converts the journal. The reply arrives only with agent.end, after the work: the Cierre is journaled but not judged (lacks), and the
//   pre-tool gate, which needs the routing line before the first change, lets every change through.
// - A tool result cannot carry the pack: it waits in the plugin for the thread's next prompt (adapters/amp.md).
import path from 'node:path';
import { agentDir, known } from './paths.mjs';
import { append, journalOf, journals, stoppedAgain, toLines, SKILL_FILE } from './journal.mjs';
import { readTail, clipOutput } from '../transcript.mjs';
import { out as claudeOut } from './claude.mjs';

export const name = 'amp';
export const instructions = path.join(agentDir(known('amp')), 'AGENTS.md');
export const preContext = false; // tool.call cannot add context: the pack waits for the next prompt
export const lacks = ['cierre', 'evidence', 'decision']; // the reply comes with agent.end, after the work, so the routing line cannot be judged in order, and its question tool is not documented (its review is waymark.mjs review)
export const out = claudeOut; // the plugin reads these shapes

const SHELL = /^(Bash|shell_command)$/;
const EDIT = /^(edit_file|create_file|apply_patch|Write|Edit)$/;
const READ = /^Read$/;
const fileOf = (i = {}) => i.path || i.file_path || i.filePath || '';
const failed = (r) => (r && (r.status === 'error' || r.status === 'cancelled') ? String(r.error || r.output || r.status) : '');

// The hook's stdin → the core's fields (transcript_path = the journal, stop_hook_active), journaling the event first.
export function input(h) {
  const session = h.session_id || 'unknown', cwd = h.cwd || process.cwd(), file = journalOf(name, session), tool = h.tool_name || '';
  const event = h.hook_event_name || '';
  const hook = { ...h, session_id: session, cwd, transcript_path: file };
  if (event === 'Stop') hook.stop_hook_active = !!h.stop_hook_active || stoppedAgain(file);
  if (event === 'UserPromptSubmit') append(name, session, { event: 'prompt', cwd, prompt: String(h.prompt || '(Amp: the hook did not carry the prompt)') });
  else if (event === 'PreToolUse' && tool) {
    const i = h.tool_input || {}, skill = READ.test(tool) && fileOf(i).match(SKILL_FILE)?.[1];
    const use = h.command || SHELL.test(tool) ? ['Bash', { command: String(h.command || i.cmd || i.command || '') }] : (h.files || []).length || EDIT.test(tool) ? ['Edit', { file_path: (h.files || [])[0] || fileOf(i) }]
      : READ.test(tool) ? ['Read', { file_path: fileOf(i) }] : [tool, i];
    append(name, session, { event: 'tool', cwd, key: tool, id: h.tool_use_id, tool: use[0], input: use[1], ...(skill ? { skill } : {}) });
  } else if (event === 'PostToolUse' && tool) append(name, session, { event: 'result', cwd, key: tool, id: h.tool_use_id, error: clipOutput(failed(h.tool_response)), output: String(h.tool_response?.output || '') });
  else if (event === 'Stop') {
    if (String(h.last_assistant_message || '').trim()) append(name, session, { event: 'reply', cwd, text: String(h.last_assistant_message) });
    append(name, session, { event: 'stop', cwd });
  }
  return hook;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes), 'am');

export function call(hook) {
  const tool = hook.tool_name || '', i = hook.tool_input || {};
  if (hook.command || SHELL.test(tool)) return { command: String(hook.command || i.cmd || i.command || '') };
  if (READ.test(tool)) return { reads: [fileOf(i)].filter(Boolean) }; // only the sensitive-path guard looks at reads
  if ((hook.files || []).length || EDIT.test(tool)) return { files: (hook.files || []).length ? hook.files : [fileOf(i)].filter(Boolean) };
  return null;
}

export const note = (skillsDir) => ` In Amp: invoke a department by reading ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md with Read (that read is recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>.`;

export const sessions = (cwd) => journals(name, cwd);
