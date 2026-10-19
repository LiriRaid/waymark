// Cursor driver of the conformance suite: hooks as cursor.com/docs/hooks documents them (sessionStart, beforeSubmitPrompt, preToolUse, postToolUse,
// afterAgentResponse, stop; every payload carries conversation_id, workspace_roots and cursor_version). Its transcript format is not documented:
// Waymark journals each event, so the world is made by the hooks themselves and there is no transcript file to write.
import { skillPath, described } from './common.mjs';

const TOOL = { shell: 'Shell', edit: 'Write', read: 'Read', skill: 'Read', ask: 'AskQuestion' };
const NAME = { start: 'sessionStart', prompt: 'beforeSubmitPrompt', pre: 'preToolUse', post: 'postToolUse', reply: 'afterAgentResponse', stop: 'stop' };
const input = (kind, i) => (kind === 'shell' ? { command: i.command } : kind === 'skill' ? { file_path: skillPath(i.name) } : kind === 'ask' ? { questions: i.questions.map((q) => ({ question: q.question, options: described(q) })) } : { file_path: i.file });

export default {
  key: 'cursor', name: 'Cursor',
  caps: { reply: true, promptContext: false, reminder: 'post', packAt: 'post', readGuard: false, brake: true, choice: true, ruleInCard: true },
  events: { reply: true, pre: ['shell', 'edit', 'read', 'skill', 'ask'], post: ['shell', 'edit', 'read', 'skill', 'ask'] }, // hooks.json has no matcher: every tool
  argv: () => ['--agent', 'cursor'],
  payload(ev, a) {
    const base = { hook_event_name: NAME[ev], conversation_id: a.session, generation_id: 'g1', model: 'auto', cursor_version: '1.7.0', workspace_roots: [a.cwd], transcript_path: '' };
    if (ev === 'start') return base;
    if (ev === 'prompt') return { ...base, prompt: a.prompt };
    if (ev === 'reply') return { ...base, text: a.text };
    if (ev === 'pre' || ev === 'post') return { ...base, tool_name: TOOL[a.kind], tool_input: input(a.kind, a.input), tool_use_id: `u${a.input?.file || a.input?.command || a.input?.name || 'ask'}`.slice(0, 60), ...(ev === 'post' ? { tool_output: a.out } : {}) };
    return { ...base, loop_count: a.again ? 1 : 0 };
  },
  read(ev, r) {
    const j = r.json || {};
    return { context: String(j.additional_context || ''), deny: j.permission === 'deny' ? String(j.agent_message || 'deny') : null, block: ev === 'stop' ? j.followup_message || null : null, blockPrompt: j.continue === false ? String(j.user_message || '') : null, notice: '' };
  },
};
