// Waymark · <Agent> adapter (docs/adr/0022). Copy to scripts/agents/<key>.mjs, replace every <…> and TODO from the
// agent's documentation (library-docs; cite the URL and the date checked here), then: add `<key>` to agents/index.mjs,
// set "adapter": "<key>" and its hooks (file, format, events, matcher, extra) in agents/agents.json, write
// adapters/<key>.md and a spec in tests/ that feeds the documented payloads (tests/agents.test.mjs → the Cursor tests).
// Procedure: skills/dept-devex/procedures.md → Add an agent. Same exports as claude.mjs, which documents each one:
// - read(): the agent's transcript as the core's lines (Claude Code's .jsonl shape: type, message.content[] tool_use/
//   tool_result, canonical tool names Edit/Write/Bash/AskUserQuestion/Skill/Read). No documented transcript → journal
//   each hook's event and read the journal (cursor.mjs, opencode.mjs).
// - call(): the pre-tool input as { files } (an edit) or { command } (a shell command), or null for other tools.
// - out: how each hook answers (context, deny a tool call, block the end of a turn, block a prompt, a notice).
// - instructions / sessions(): the user's global instructions file and the transcripts of a folder.
// - lacks / note(skillsDir): routine steps the agent cannot do, and how it does the rest in Claude terms.
// Optional, when the agent needs them: input(hook) (its payload → the core's fields: cwd, session_id, prompt, tool_name,
// tool_input), ruleInCard (no instructions file: the session card brings Rule 0), toLines (a transcript converter).
// Imports from scripts/agents/: '../transcript.mjs' (readTail, clipOutput, closingQuestions), './paths.mjs' (agentDir).
import path from 'node:path';
import os from 'node:os';

export const name = '<key>';

// TODO: the agent's transcript (or Waymark's journal of its hooks) → the core's lines; [] reads nothing.
export const read = (hook, bytes) => [];

// TODO: the agent's tool names → shell command or edited files.
export function call(hook) {
  const tool = hook.tool_name || '', input = hook.tool_input || {};
  if (/^<shell tool>$/.test(tool)) return { command: String(input.command || '') };
  if (/^<edit tools>$/.test(tool)) return { files: [input.file_path].filter(Boolean) };
  return null;
}

// TODO: each answer in the agent's documented output (exit code 2 + stderr when it has no JSON answer).
export const out = {
  context: (event, text) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }),
  deny: (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }),
  block: (reason) => ({ decision: 'block', reason }),
  blockPrompt: (reason) => ({ decision: 'block', reason }),
  notice: (text) => ({ systemMessage: text }),
};

export const instructions = path.join(os.homedir(), '<.agent>', '<INSTRUCTIONS>.md'); // TODO: agentDir(known('<key>')) in scripts/agents/
export const preContext = false; // true only when its pre-tool hook can add context and still let the tool run
export const lacks = []; // routine steps it has no capability for (recorded as not applicable)
export const note = () => ''; // how it does what the routine names in Claude terms (its question tool, its skills folder)

// TODO: the transcripts of the sessions opened in cwd, newest first ([] when the agent keeps none Waymark can read).
export function sessions(cwd) { return []; }
