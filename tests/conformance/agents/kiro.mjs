// Kiro driver of the conformance suite: hooks as kiro.dev/docs/hooks documents them (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse,
// Stop, each run with `--event`; execute_bash, fs_write, fs_read), answers as plain text, stderr and the exit code. No hook carries the reply and
// the session files are not documented: Waymark journals each event, so the world is made by the hooks themselves.
import { skillPath } from './common.mjs';

const TOOL = { shell: 'execute_bash', edit: 'fs_write', read: 'fs_read', skill: 'fs_read' };
const NAME = { start: 'SessionStart', prompt: 'UserPromptSubmit', pre: 'PreToolUse', post: 'PostToolUse', stop: 'Stop' };
const input = (kind, i) => (kind === 'shell' ? { command: i.command } : kind === 'skill' ? { path: skillPath(i.name) } : { path: i.file });

export default {
  key: 'kiro', name: 'Kiro',
  caps: { reply: false, promptContext: true, reminder: 'prompt', packAt: 'post', readGuard: false, brake: false, choice: false },
  events: { reply: false, pre: ['shell', 'edit', 'read', 'skill'], post: ['shell', 'edit', 'read', 'skill'] }, // no matcher: every tool is journaled
  argv: (ev) => ['--agent', 'kiro', '--event', NAME[ev]],
  payload(ev, a) {
    const base = { hook_event_name: NAME[ev], session_id: a.session, cwd: a.cwd };
    if (ev === 'start') return base;
    if (ev === 'prompt') return { ...base, prompt: a.prompt };
    if (ev === 'pre' || ev === 'post') return { ...base, tool_name: TOOL[a.kind], tool_input: input(a.kind, a.input), ...(ev === 'post' ? { tool_response: a.error ? { success: false, error: a.out } : { success: true, stdout: a.out } } : {}) };
    return base;
  },
  read(ev, r) {
    if (ev === 'pre') return { context: '', deny: r.status === 2 ? r.stderr.trim() || 'deny' : null, block: null, blockPrompt: null, notice: '' };
    if (ev === 'stop') { let j = {}; try { j = JSON.parse(r.stdout); } catch {} return { context: '', deny: null, block: j.decision === 'block' ? String(j.reason || '') : null, blockPrompt: null, notice: '' }; }
    return { context: r.stdout, deny: null, block: null, blockPrompt: null, notice: '' };
  },
};
