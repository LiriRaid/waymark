// Qwen Code driver of the conformance suite: hooks as qwenlm.github.io/qwen-code-docs documents them (checked 2026-10-19): Claude Code's payloads
// and answers with Qwen's runtime tool ids (run_shell_command, write_file, read_file). Its transcript is not described and the reply comes only
// with Stop, so Waymark journals each event: the world is made by the hooks themselves.
import { claudeShape, skillPath } from './common.mjs';

const TOOL = { shell: 'run_shell_command', edit: 'write_file', read: 'read_file', skill: 'read_file' };
// pre and post of one call share an id; two calls never do (the journal pairs a result with its call by it)
const ids = new WeakMap();
let seq = 0;
const idOf = (input) => { if (!ids.has(input)) ids.set(input, `t-${++seq}`); return ids.get(input); };
const NAME = { start: 'SessionStart', prompt: 'UserPromptSubmit', pre: 'PreToolUse', post: 'PostToolUse', stop: 'Stop' };
const input = (kind, i) => (kind === 'shell' ? { command: i.command } : kind === 'skill' ? { file_path: skillPath(i.name) } : { file_path: i.file });

export default {
  key: 'qwen', name: 'Qwen Code',
  caps: { reply: false, promptContext: true, reminder: 'prompt', packAt: 'pre', readGuard: true, brake: true, choice: false },
  events: { reply: false, pre: ['shell', 'edit', 'read', 'skill'], post: ['shell', 'edit', 'read', 'skill'] }, // the journal needs every tool and its result
  argv: () => ['--agent', 'qwen'],
  payload(ev, a) {
    const base = { hook_event_name: NAME[ev], session_id: a.session, cwd: a.cwd, transcript_path: '', timestamp: new Date().toISOString(), permission_mode: 'default' };
    if (ev === 'start') return { ...base, source: 'startup', model: 'qwen3-coder' };
    if (ev === 'prompt') return { ...base, prompt: a.prompt, submitted_prompt: a.prompt };
    if (ev === 'pre' || ev === 'post') {
      return { ...base, tool_name: TOOL[a.kind], tool_input: input(a.kind, a.input), tool_use_id: idOf(a.input),
        ...(ev === 'post' ? { tool_response: a.error ? { error: a.out, exit_code: 1 } : { output: a.out } } : {}) };
    }
    return { ...base, stop_hook_active: !!a.again, last_assistant_message: a.reply };
  },
  read: claudeShape,
};
