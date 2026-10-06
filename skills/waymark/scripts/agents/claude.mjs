// Waymark · Claude Code adapter (docs/adr/0008). Everything the agent-agnostic core needs from one agent:
// - read(): its transcript as the core's lines. The core's shape IS Claude Code's .jsonl (type, message.content[]
//   tool_use/tool_result, toolUseResult, usage) with canonical tool names: Edit/Write/MultiEdit/NotebookEdit, Bash/
//   PowerShell, AskUserQuestion, Skill, Read. Another agent's adapter converts its own transcript into this shape.
// - call(): the pre-tool input as { files } (an edit) or { command } (a shell command), or null for other tools.
// - out: how each hook answers (context for the model, deny a tool call, block the end of a turn, a notice for the user).
// - instructions / sessions(): the user's instructions file (hashed into the record) and the transcripts of a folder.
// - lacks / note(skillsDir): routine steps the agent has no capability for, and one line on how it does the rest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTail } from '../transcript.mjs';

export const name = 'claude';

export const read = (hook, bytes) => readTail(hook.transcript_path, bytes);

export function call(hook) {
  const tool = hook.tool_name || '', input = hook.tool_input || {};
  if (/^(Bash|PowerShell)$/.test(tool)) return { command: String(input.command || '') };
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) return { files: [input.file_path || input.notebook_path].filter(Boolean) };
  return null;
}

export const out = {
  context: (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }),
  deny: (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  block: (reason) => ({ decision: 'block', reason }),
  notice: (text) => ({ systemMessage: text }), // shown to the user, not added to the model's context
};

export const instructions = path.join(os.homedir(), '.claude', 'CLAUDE.md');
export const preContext = true; // a pre-tool hook can add context and let the tool run (additionalContext, no permissionDecision)
export const lacks = []; // routine steps this agent cannot do (recorded as not applicable); Claude Code has them all
export const note = () => ''; // how this agent does what the routine names in Claude terms (added to the reminder and the gate)

// Transcripts of the sessions opened in cwd, newest first (Claude Code names the folder after cwd, every
// non-alphanumeric character as "-").
export function sessions(cwd) {
  const dir = path.join(process.env.WAYMARK_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects'), String(cwd).replace(/[^a-zA-Z0-9]/g, '-'));
  try {
    return fs.readdirSync(dir).filter((n) => n.endsWith('.jsonl')).map((n) => path.join(dir, n))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch { return []; }
}
