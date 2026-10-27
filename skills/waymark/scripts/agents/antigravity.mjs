// Waymark · Antigravity adapter (docs/adr/0022). Same exports as claude.mjs, plus input().
// Hooks (antigravity.google/docs/hooks, checked 2026-10-13): ~/.gemini/config/hooks.json, read by Antigravity 2.0, its IDE
// and its CLI, is an object of named hooks; Waymark's is "waymark" (install-hooks.mjs): SessionStart, PreInvocation (each
// prompt), PreToolUse and PostToolUse (matcher "*": every tool is journaled, reads included) and Stop, each run as
// `node <script> --agent antigravity --event <core event>`, since the payload names no event and a tool's pre and post
// payloads carry the same fields. The payload is camelCase: conversationId, workspacePaths, transcriptPath, modelName;
// toolCall {name, args} and stepIdx on the tool events, error after a tool (empty on success); invocationNum on
// PreInvocation; terminationReason and fullyIdle on Stop.
// - Out: SessionStart and PreInvocation add an injectSteps ephemeralMessage; PreToolUse answers a decision (deny with the
//   denial; allow with the pack as its reason, since it has no context field); PostToolUse answers {}; Stop's decision
//   "continue" re-enters the loop with the reason as a system message. Nothing blocks a prompt.
// - The turn: no hook carries the prompt or the reply, and transcript.jsonl's format is not documented, so input()
//   journals each event (agents/journal.mjs) and read() converts the journal; a PreInvocation stands for the prompt, with a
//   placeholder text. Without the reply, the routing line and the Cierre are invisible: cierre is not applicable (lacks),
//   and the pre-tool gate, which needs the routing line, lets every change through. The choice window is ask_question,
//   whose answer the hook does not carry. The tool arguments' names are not documented: adapters/antigravity.md lists
//   what the first live session checks.
import path from 'node:path';
import { agentDir, known } from './paths.mjs';
import { append, eventArg, journalOf, journals, stoppedAgain, toLines, SKILL_FILE } from './journal.mjs';
import { readTail } from '../transcript.mjs';
import { asQuestion as question } from './lines.mjs';

export const name = 'antigravity';
export const instructions = path.join(agentDir(known('antigravity')), 'GEMINI.md'); // shared with Gemini CLI
export const preContext = true; // the pack goes before the tool runs, as the reason of an allow
export const lacks = ['cierre', 'evidence']; // no hook carries the reply (its review is waymark.mjs review)
export const promptless = true; // no hook carries the ask: the per-prompt hook cannot tell a follow-up from a new task, so it offers both IDs

export const out = {
  context: (event, text) => (event === 'PreToolUse' ? { decision: 'allow', reason: text } : event === 'PostToolUse' ? {} : { injectSteps: [{ ephemeralMessage: text }] }),
  deny: (reason) => ({ decision: 'deny', reason }),
  block: (reason) => ({ decision: 'continue', reason }),
  notice: () => ({ decision: 'stop' }), // any decision but "continue" lets the stop happen; nothing shows text to the user
  pass: (event) => (event === 'PreToolUse' ? { decision: 'allow' } : {}), // allow: Antigravity's own approval still decides
};

const SHELL = /^run_command$/;
const EDIT = /^(write_to_file|replace_file_content|multi_replace_file_content)$/;
const READ = /^view_file$/;
const ASK = /^ask_question$/;
const fileOf = (i = {}) => i.TargetFile || i.AbsolutePath || i.file_path || i.filePath || i.path || '';
const commandOf = (i = {}) => String(i.CommandLine || i.command || i.cmd || '');
const asQuestion = (q) => question(q, { text: ['question', 'Question', 'prompt'], options: ['options', 'Options', 'choices'], plain: true });

// The hook's stdin → the core's fields (session_id, cwd, tool_name, tool_input, prompt, transcript_path = the journal,
// stop_hook_active), journaling the event first.
export function input(h) {
  const session = h.conversationId || h.session_id || 'unknown', cwd = h.workspacePaths?.[0] || h.cwd || process.cwd(), file = journalOf(name, session);
  const tool = h.toolCall?.name || '', args = h.toolCall?.args || {};
  const event = eventArg() || h.hook_event_name || (tool ? 'PreToolUse' : h.invocationNum !== undefined ? 'UserPromptSubmit' : h.fullyIdle !== undefined ? 'Stop' : 'SessionStart');
  const prompt = `(Antigravity invocation ${h.invocationNum ?? '?'}: its hooks do not carry the prompt)`;
  const hook = { ...h, session_id: session, cwd, hook_event_name: event, transcript_path: file, ...(tool ? { tool_name: tool, tool_input: args } : {}), ...(event === 'UserPromptSubmit' ? { prompt } : {}) };
  // already answered: a stop since the last invocation, or one of the same execution (a "continue" that opened a new
  // invocation keeps its executionNum)
  if (event === 'Stop') hook.stop_hook_active = stoppedAgain(file) || (h.executionNum !== undefined && readTail(file, 256 * 1024).some((r) => r?.event === 'stop' && r.execution === h.executionNum));
  const id = h.stepIdx !== undefined ? `step-${h.stepIdx}` : undefined;
  if (event === 'UserPromptSubmit') append(name, session, { event: 'prompt', cwd, prompt });
  else if (event === 'PreToolUse' && tool) {
    const skill = READ.test(tool) && fileOf(args).match(SKILL_FILE)?.[1];
    const use = SHELL.test(tool) ? ['Bash', { command: commandOf(args) }] : EDIT.test(tool) ? ['Edit', { file_path: fileOf(args) }]
      : READ.test(tool) ? ['Read', { file_path: fileOf(args) }] : ASK.test(tool) ? ['AskUserQuestion', { questions: (args.questions || [args]).map(asQuestion) }] : [tool, args];
    append(name, session, { event: 'tool', cwd, key: tool, id, tool: use[0], input: use[1], ...(skill ? { skill } : {}) });
  } else if (event === 'PostToolUse' && tool) append(name, session, { event: 'result', cwd, key: tool, id, error: String(h.error || '') });
  else if (event === 'Stop') append(name, session, { event: 'stop', cwd, ...(h.executionNum !== undefined ? { execution: h.executionNum } : {}) });
  return hook;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes), 'ag');

export function call(hook) {
  const tool = hook.tool_name || '', i = hook.tool_input || {};
  if (SHELL.test(tool)) return { command: commandOf(i) };
  if (EDIT.test(tool)) return { files: [fileOf(i)].filter(Boolean) };
  return null;
}

export const note = (skillsDir) => ` In Antigravity: invoke a department by reading ${String(skillsDir).replace(/\\/g, '/')}/<name>/SKILL.md with view_file (that read is recorded as the call); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>; the choice window is ask_question.`;

export const sessions = (cwd) => journals(name, cwd);
