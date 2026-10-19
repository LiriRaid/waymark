// Waymark · Qwen Code adapter (docs/adr/0041). Same exports as claude.mjs, plus input().
// Hooks (qwenlm.github.io/qwen-code-docs/en/users/features/hooks/ and /users/configuration/settings/, checked 2026-10-19):
// ~/.qwen/settings.json under "hooks" (QWEN_HOME moves the folder), the events SessionStart, UserPromptSubmit, PreToolUse,
// PostToolUse and Stop, each run as `node <script> --agent qwen`. The payload is JSON on stdin and Claude Code's: hook_event_name,
// session_id, cwd, transcript_path, prompt (and submitted_prompt, the user's text where the agent could capture it), tool_name,
// tool_input, tool_response, and on Stop stop_hook_active and last_assistant_message.
// - Out: Claude Code's shapes. hookSpecificOutput.additionalContext adds context (SessionStart, UserPromptSubmit, PreToolUse,
//   PostToolUse); permissionDecision "deny" (with its reason, both required) refuses a tool; decision "block" with a reason keeps a Stop
//   from ending the turn (at most stopHookBlockingCap, 8, in a row); exit 2 blocks and hands stderr to the model.
// - The turn: transcript_path is listed and never described, so input() journals each event (agents/journal.mjs) and read() converts
//   the journal. The reply is carried only by Stop (last_assistant_message), the turn's last message: the routing line, which opens the
//   turn, is not in it, so the Cierre is journaled but not judged (lacks), and the pre-tool gate, which needs the routing line before the
//   first change, lets every change through. The tool arguments' names are documented for two examples only (file_path, command):
//   adapters/qwen.md lists what the first live session checks.
import path from 'node:path';
import { agentDir, known } from './paths.mjs';
import { append, journalOf, journals, toLines, SKILL_FILE } from './journal.mjs';
import { readTail, clipOutput } from '../transcript.mjs';
import { out as claudeOut } from './claude.mjs';

export const name = 'qwen';
export const instructions = path.join(agentDir(known('qwen')), 'QWEN.md');
export const preContext = true; // PreToolUse takes hookSpecificOutput.additionalContext
export const lacks = ['cierre', 'evidence', 'decision']; // only the last message reaches a hook, with no routing line to judge it by, and its question tool is not documented (its review is waymark.mjs review)
export const out = claudeOut;

// The runtime ids, their display names and Claude Code's names (the docs: Claude's matchers work unchanged).
const SHELL = /^(run_shell_command|Bash)$/i;
const EDIT = /^(write_file|WriteFile|Write|edit|Edit|replace|notebook_edit|NotebookEdit)$/;
const READ = /^(read_file|ReadFile|Read)$/;
const fileOf = (i = {}) => i.file_path || i.filePath || i.absolute_path || i.path || '';
const failed = (r) => {
  if (r == null) return '';
  if (typeof r === 'string') return /^(error|Error:)/.test(r) ? r : '';
  const code = Number(r.exit_code ?? r.exitCode ?? 0);
  return r.error || r.success === false || r.is_error || code ? String(r.error?.message || r.error || r.stderr || r.output || `exit ${code}`) : '';
};

// The hook's stdin → the core's fields (the prompt, transcript_path = the journal), journaling the event first.
export function input(h) {
  const session = h.session_id || 'unknown', cwd = h.cwd || process.cwd(), file = journalOf(name, session), tool = h.tool_name || '';
  const event = h.hook_event_name || '';
  const hook = { ...h, session_id: session, cwd, transcript_path: file, ...(event === 'UserPromptSubmit' ? { prompt: h.submitted_prompt || h.prompt || '' } : {}) };
  if (event === 'UserPromptSubmit') append(name, session, { event: 'prompt', cwd, prompt: String(hook.prompt || '(Qwen Code: the hook did not carry the prompt)') });
  else if (event === 'PreToolUse' && tool) {
    const i = h.tool_input || {}, skill = READ.test(tool) && fileOf(i).match(SKILL_FILE)?.[1];
    const use = SHELL.test(tool) ? ['Bash', { command: String(i.command || '') }] : EDIT.test(tool) ? ['Edit', { file_path: fileOf(i) }] : READ.test(tool) ? ['Read', { file_path: fileOf(i) }] : [tool, i];
    append(name, session, { event: 'tool', cwd, key: tool, id: h.tool_use_id || h.tool_call_id, tool: use[0], input: use[1], ...(skill ? { skill } : {}) });
  } else if (event === 'PostToolUse' && tool) {
    const r = h.tool_response;
    append(name, session, { event: 'result', cwd, key: tool, id: h.tool_use_id || h.tool_call_id, error: clipOutput(failed(r)), output: typeof r === 'string' ? r : String(r?.output ?? r?.stdout ?? r?.llmContent ?? r?.returnDisplay ?? '') });
  } else if (event === 'Stop') {
    if (String(h.last_assistant_message || '').trim()) append(name, session, { event: 'reply', cwd, text: String(h.last_assistant_message) });
    append(name, session, { event: 'stop', cwd });
  }
  return hook;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes), 'qw');

export function call(hook) {
  const tool = hook.tool_name || '', i = hook.tool_input || {};
  if (SHELL.test(tool)) return { command: String(i.command || '') };
  if (READ.test(tool)) return { reads: [fileOf(i)].filter(Boolean) }; // only the sensitive-path guard looks at reads
  if (EDIT.test(tool)) return { files: [fileOf(i)].filter(Boolean) };
  return null;
}

export const note = (skillsDir) => ` In Qwen Code: invoke a department by reading ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md with read_file (that read is recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>.`;

export const sessions = (cwd) => journals(name, cwd);
