// Waymark · Droid adapter (docs/adr/0041). Same exports as claude.mjs, plus input().
// Hooks (docs.factory.com/cli/configuration/hooks-guide and /reference/hooks-reference, checked 2026-10-19): ~/.factory/hooks.json with
// the event names as the file's top-level keys (no "hooks" wrapper; inside settings.json they would sit under "hooks"), the events
// SessionStart, UserPromptSubmit, PreToolUse, PostToolUse and Stop, each run as `node <script> --agent droid`. The payload is JSON on
// stdin and Claude Code's: hook_event_name, session_id, transcript_path, cwd, prompt, tool_name, tool_input, tool_response,
// stop_hook_active. Tools: Execute (command), Create (file_path, content), Edit, ApplyPatch and Read.
// - Out: SessionStart and PostToolUse add hookSpecificOutput.additionalContext; UserPromptSubmit documents additionalContext bare, so
//   it goes both ways; permissionDecision "deny" refuses a tool; decision "block" with a reason blocks a prompt and keeps a Stop from
//   ending the turn. PreToolUse documents no context: the pack goes with the result (PostToolUse).
// - The turn: the transcript's format is not documented and no hook carries the reply, so input() journals each event
//   (agents/journal.mjs) and read() converts the journal. Without the reply the routing line, the Cierre and a question asked in the chat
//   are invisible: cierre and decision are not applicable (lacks), and the pre-tool gate lets every change through. The input of Edit,
//   ApplyPatch and Read, and the shape of tool_response, are not documented: adapters/droid.md lists what the first live session checks.
import path from 'node:path';
import { agentDir, known } from './paths.mjs';
import { append, journalOf, journals, stoppedAgain, toLines, SKILL_FILE } from './journal.mjs';
import { readTail, clipOutput } from '../transcript.mjs';
import { out as claudeOut } from './claude.mjs';
import { patchFiles } from './codex.mjs';

export const name = 'droid';
export const instructions = path.join(agentDir(known('droid')), 'AGENTS.md'); // Droid also reads ~/.agents and ~/.agent for personal instructions
export const preContext = false; // PreToolUse documents no context: the pack goes with the result (PostToolUse)
export const lacks = ['cierre', 'evidence', 'decision']; // no hook carries the reply (its review is waymark.mjs review)
export const out = {
  ...claudeOut,
  context: (event, text) => (event === 'UserPromptSubmit' ? { additionalContext: text, hookSpecificOutput: { hookEventName: event, additionalContext: text } } : claudeOut.context(event, text)),
};

const SHELL = /^Execute$/;
const EDIT = /^(Create|Edit|ApplyPatch)$/;
const READ = /^Read$/;
const fileOf = (i = {}) => i.file_path || i.filePath || i.path || '';
const filesOf = (tool, i = {}, cwd) => (tool === 'ApplyPatch' ? patchFiles(String(i.patch || i.input || i.patchText || i.diff || ''), cwd) : [fileOf(i)]).filter(Boolean);
const failed = (r) => {
  if (r == null) return '';
  if (typeof r === 'string') return '';
  const code = Number(r.exit_code ?? r.exitCode ?? 0);
  return r.error || r.success === false || r.is_error || code ? String(r.error?.message || r.error || r.stderr || r.output || `exit ${code}`) : '';
};

// The hook's stdin → the core's fields (transcript_path = the journal, stop_hook_active), journaling the event first.
export function input(h) {
  const session = h.session_id || 'unknown', cwd = h.cwd || process.cwd(), file = journalOf(name, session), tool = h.tool_name || '';
  const event = h.hook_event_name || '';
  const hook = { ...h, session_id: session, cwd, transcript_path: file };
  if (event === 'Stop') hook.stop_hook_active = !!h.stop_hook_active || stoppedAgain(file);
  if (event === 'UserPromptSubmit') {
    hook.prompt = String(h.prompt || '').trim() ? h.prompt : '(Droid: the hook did not carry the prompt)'; // a prompt with only an image still opens the turn
    append(name, session, { event: 'prompt', cwd, prompt: String(hook.prompt) });
  } else if (event === 'PreToolUse' && tool) {
    const i = h.tool_input || {}, skill = READ.test(tool) && fileOf(i).match(SKILL_FILE)?.[1];
    const use = SHELL.test(tool) ? ['Bash', { command: String(i.command || '') }] : EDIT.test(tool) ? ['Edit', { file_path: filesOf(tool, i, cwd)[0] || '' }] : READ.test(tool) ? ['Read', { file_path: fileOf(i) }] : [tool, i];
    append(name, session, { event: 'tool', cwd, key: tool, id: h.tool_use_id, tool: use[0], input: use[1], ...(skill ? { skill } : {}) });
  } else if (event === 'PostToolUse' && tool) {
    const r = h.tool_response;
    append(name, session, { event: 'result', cwd, key: tool, id: h.tool_use_id, error: clipOutput(failed(r)), output: typeof r === 'string' ? r : String(r?.output ?? r?.stdout ?? r?.result ?? '') });
  } else if (event === 'Stop') append(name, session, { event: 'stop', cwd });
  return hook;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes), 'dr');

export function call(hook) {
  const tool = hook.tool_name || '', i = hook.tool_input || {};
  if (SHELL.test(tool)) return { command: String(i.command || '') };
  if (READ.test(tool)) return { reads: [fileOf(i)].filter(Boolean) }; // only the sensitive-path guard looks at reads
  if (EDIT.test(tool)) return { files: filesOf(tool, i, hook.cwd) };
  return null;
}

export const note = (skillsDir) => ` In Droid: invoke a department by reading ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md with Read (that read is recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>.`;

export const sessions = (cwd) => journals(name, cwd);
