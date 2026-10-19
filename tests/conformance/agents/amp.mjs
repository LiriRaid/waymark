// Amp driver of the conformance suite: what Waymark's plugin (agents/amp-plugin.js) hands the hooks for Amp's plugin events
// (ampcode.com/docs/plugin-api, checked 2026-10-19): Claude Code's shape, the thread as the session, the tool names Bash, edit_file and Read, and
// the `command` and `files` Amp's own helpers extract from a call. The reply comes with agent.end, so Waymark journals each event: the world is
// made by the hooks themselves.
import { claudeShape, skillPath } from './common.mjs';

const TOOL = { shell: 'Bash', edit: 'edit_file', read: 'Read', skill: 'Read' };
// pre and post of one call share an id; two calls never do (the journal pairs a result with its call by it)
const ids = new WeakMap();
let seq = 0;
const idOf = (input) => { if (!ids.has(input)) ids.set(input, `toolu_${++seq}`); return ids.get(input); };
const NAME = { start: 'SessionStart', prompt: 'UserPromptSubmit', pre: 'PreToolUse', post: 'PostToolUse', stop: 'Stop' };
const input = (kind, i) => (kind === 'shell' ? { cmd: i.command } : kind === 'skill' ? { path: skillPath(i.name) } : { path: i.file });
const extra = (kind, i) => (kind === 'shell' ? { command: i.command, files: [] } : kind === 'edit' ? { command: '', files: [i.file] } : { command: '', files: [] });

export default {
  key: 'amp', name: 'Amp',
  caps: { reply: false, promptContext: true, reminder: 'prompt', packAt: 'post', readGuard: true, brake: true, choice: false },
  events: { reply: false, pre: ['shell', 'edit', 'read', 'skill'], post: ['shell', 'edit', 'read', 'skill'] }, // the journal needs every tool and its result
  argv: () => ['--agent', 'amp'],
  payload(ev, a) {
    const base = { hook_event_name: NAME[ev], session_id: `T-${a.session}`, cwd: a.cwd };
    if (ev === 'start') return base;
    if (ev === 'prompt') return { ...base, prompt: a.prompt };
    if (ev === 'pre' || ev === 'post') {
      return { ...base, tool_name: TOOL[a.kind], tool_use_id: idOf(a.input), tool_input: input(a.kind, a.input), ...extra(a.kind, a.input),
        ...(ev === 'post' ? { tool_response: { status: a.error ? 'error' : 'done', error: a.error ? a.out : '', output: a.error ? '' : a.out } } : {}) };
    }
    return { ...base, stop_hook_active: !!a.again, last_assistant_message: a.reply };
  },
  read: claudeShape,
};
