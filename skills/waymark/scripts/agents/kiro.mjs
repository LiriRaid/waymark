// Waymark · Kiro adapter (docs/adr/0022). Same exports as claude.mjs, plus input() and emit().
// Hooks (kiro.dev/docs/hooks, /docs/hooks/types, /docs/hooks/actions, /docs/cli/v3/hooks-migration and
// /docs/ide/whats-new-v1/hooks, checked 2026-10-13): ~/.kiro/hooks/waymark.json (KIRO_HOME moves the folder; global hooks
// are documented for CLI V3, the IDE documents only the workspace's .kiro/hooks), {"version": "v1", "hooks": [{name,
// trigger, action: {type: "command", command}}]} with the triggers SessionStart, UserPromptSubmit, PreToolUse, PostToolUse
// and Stop, each run as `node <script> --agent kiro --event <event>` (install-hooks.mjs) and with no matcher: every tool is
// journaled, reads included. The payload is JSON on stdin: hook_event_name, cwd, session_id, prompt (UserPromptSubmit; the
// IDE gives it as USER_PROMPT), tool_name and tool_input (CLI 2.x names the events agentSpawn, userPromptSubmit…).
// - Out: plain text, not JSON (emit). Exit 0 adds stdout to the agent's context; exit 2 blocks a PreToolUse and hands
//   stderr to the agent; Stop's stdout {"decision": "block", "reason"} asks for another turn. Blocking a prompt is
//   documented both ways (IDE: exit 2 blocks it; CLI V3: the prompt is sent regardless), so there is no prompt brake.
// - The turn: no hook carries the reply's text and the session files (~/.kiro/sessions) are not documented, so input()
//   journals each event (agents/journal.mjs) and read() converts the journal. Without the reply, the routing line, the
//   Cierre and a question asked in the chat are invisible: cierre and decision are not applicable (lacks), and the
//   pre-tool gate, which needs the routing line, lets every change through. The gates, review, build, spec, secrets,
//   procedure and memory come from the tool calls. The tool result's field and the tool names of the V3 engine and the IDE
//   are not documented: adapters/kiro.md lists what the first live session checks.
import path from 'node:path';
import { agentDir, known } from './paths.mjs';
import { append, eventArg, journalOf, journals, stoppedAgain, toLines, SKILL_FILE } from './journal.mjs';
import { readTail } from '../transcript.mjs';

export const name = 'kiro';
const HOME = () => agentDir(known('kiro'));
export const instructions = path.join(HOME(), 'steering', 'AGENTS.md');
export const preContext = false; // PreToolUse documents no context: the pack goes with the result (PostToolUse)
export const lacks = ['cierre', 'decision']; // no hook carries the reply (its review is waymark.mjs review)

export const out = {
  context: (event, text) => ({ text }),
  deny: (reason) => ({ stderr: reason, exit: 2 }),
  block: (reason) => ({ text: JSON.stringify({ decision: 'block', reason }) }),
  notice: () => ({}), // nothing shows text to the user
};
// How each answer reaches Kiro: stdout as text, stderr, and the exit code (agents/index.mjs answer).
export function emit(o = {}) {
  if (o.text) process.stdout.write(o.text);
  if (o.stderr) process.stderr.write(o.stderr);
  if (o.exit) process.exitCode = o.exit;
}

const EVENT = { agentSpawn: 'SessionStart', userPromptSubmit: 'UserPromptSubmit', PromptSubmit: 'UserPromptSubmit', preToolUse: 'PreToolUse', postToolUse: 'PostToolUse', stop: 'Stop', AgentStop: 'Stop' };
const SHELL = /^(execute_?bash|execute_?cmd|execute_?pwsh|shell|bash|run_command)$/i;
const EDIT = /^(fs_?write|fs_?append|str_?replace|write|create|edit|delete_?file)$/i;
const READ = /^(fs_?read|read|read_?file|read_?multiple_?files)$/i;
const fileOf = (i = {}) => i.path || i.file_path || i.filePath || i.targetFile || i.operations?.[0]?.path || '';
const failed = (r) => {
  if (r == null || typeof r !== 'object') return '';
  const code = Number(r.exit_status ?? r.exitCode ?? r.exit_code ?? 0);
  return r.success === false || r.status === 'error' || code ? String(r.error || r.stderr || r.stdout || `exit ${code}`) : '';
};

// The hook's stdin → the core's fields (the event from the command line, else from the payload), journaling it first.
export function input(h) {
  const session = h.session_id || 'unknown', cwd = h.cwd || process.cwd(), file = journalOf(name, session);
  const tool = h.tool_name || '';
  const event = eventArg() || EVENT[h.hook_event_name] || h.hook_event_name || (tool ? (h.tool_response !== undefined ? 'PostToolUse' : 'PreToolUse') : '');
  const hook = { ...h, session_id: session, cwd, hook_event_name: event, transcript_path: file, prompt: h.prompt ?? process.env.USER_PROMPT };
  if (event === 'Stop') hook.stop_hook_active = stoppedAgain(file);
  if (event === 'UserPromptSubmit') { // a prompt with no text still opens the turn
    hook.prompt = String(hook.prompt || '').trim() ? hook.prompt : '(Kiro: the hook did not carry the prompt)';
    append(name, session, { event: 'prompt', cwd, prompt: String(hook.prompt) });
  }
  else if (event === 'PreToolUse' && tool) {
    const i = h.tool_input || {}, skill = READ.test(tool) && fileOf(i).match(SKILL_FILE)?.[1];
    const use = SHELL.test(tool) ? ['Bash', { command: String(i.command || i.cmd || '') }]
      : EDIT.test(tool) ? ['Edit', { file_path: fileOf(i) }] : READ.test(tool) ? ['Read', { file_path: fileOf(i) }] : [tool, i];
    append(name, session, { event: 'tool', cwd, key: tool, tool: use[0], input: use[1], ...(skill ? { skill } : {}) });
  } else if (event === 'PostToolUse' && tool) {
    const r = h.tool_response ?? h.tool_output ?? h.tool_result;
    append(name, session, { event: 'result', cwd, key: tool, error: failed(r), output: typeof r === 'string' ? r : '' });
  } else if (event === 'Stop') append(name, session, { event: 'stop', cwd });
  return hook;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes), 'ki');

export function call(hook) {
  const tool = hook.tool_name || '', i = hook.tool_input || {};
  if (SHELL.test(tool)) return { command: String(i.command || i.cmd || '') };
  if (EDIT.test(tool)) return { files: [fileOf(i)].filter(Boolean) };
  return null;
}

export const note = (skillsDir) => ` In Kiro: invoke a department by reading ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md (that read is recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>; put the choice window's options in the chat and end your turn — the user's reply counts as the decision.`;

export const sessions = (cwd) => journals(name, cwd);
