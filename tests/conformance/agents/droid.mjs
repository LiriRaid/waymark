// Droid driver of the conformance suite: hooks as docs.factory.com documents them (checked 2026-10-19): Claude Code's payloads and answers with
// Droid's tool names (Execute, Create, Read). No hook carries the reply and the transcript's format is not documented, so Waymark journals each
// event: the world is made by the hooks themselves.
import { claudeShape, skillPath } from './common.mjs';

const TOOL = { shell: 'Execute', edit: 'Create', read: 'Read', skill: 'Read' };
// pre and post of one call share an id; two calls never do (the journal pairs a result with its call by it)
const ids = new WeakMap();
let seq = 0;
const idOf = (input) => { if (!ids.has(input)) ids.set(input, `t-${++seq}`); return ids.get(input); };
const NAME = { start: 'SessionStart', prompt: 'UserPromptSubmit', pre: 'PreToolUse', post: 'PostToolUse', stop: 'Stop' };
const input = (kind, i) => (kind === 'shell' ? { command: i.command } : kind === 'skill' ? { file_path: skillPath(i.name) } : { file_path: i.file, content: 'x' });

export default {
  key: 'droid', name: 'Droid',
  caps: { reply: false, promptContext: true, reminder: 'prompt', packAt: 'post', readGuard: true, brake: true, choice: false },
  events: { reply: false, pre: ['shell', 'edit', 'read', 'skill'], post: ['shell', 'edit', 'read', 'skill'] }, // the journal needs every tool and its result
  argv: () => ['--agent', 'droid'],
  payload(ev, a) {
    const base = { hook_event_name: NAME[ev], session_id: a.session, cwd: a.cwd, transcript_path: '', permission_mode: 'off' };
    if (ev === 'start') return { ...base, source: 'startup' };
    if (ev === 'prompt') return { ...base, prompt: a.prompt, has_images: false };
    if (ev === 'pre' || ev === 'post') {
      return { ...base, tool_name: TOOL[a.kind], tool_input: input(a.kind, a.input), tool_use_id: idOf(a.input),
        ...(ev === 'post' ? { tool_response: a.error ? { error: a.out, exit_code: 1 } : { output: a.out } } : {}) };
    }
    return { ...base, stop_hook_active: !!a.again, tool_execution_count: 1, elapsed_time: 1 };
  },
  read(ev, r) {
    const c = claudeShape(ev, r);
    return c.context ? c : { ...c, context: String(r.json?.additionalContext || '') }; // UserPromptSubmit documents additionalContext bare
  },
};
