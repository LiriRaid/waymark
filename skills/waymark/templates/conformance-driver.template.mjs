// __NAME__ driver of the conformance suite (draft from waymark.mjs adapter-new): __NAME__'s hooks as its documentation describes them (__DOCS__).
// It speaks Claude Code's shapes until the documentation says otherwise: change `payload`, `write` and `read` where it does, and say what the agent cannot do in `caps`.
import { claudeShape, claudeAsk, writeRows } from '__COMMON__';

const TOOL = { shell: '__SHELL__', edit: '__EDIT__', read: '__READ__', skill: 'Skill' };
const toolInput = (kind, input) => (kind === 'shell' ? { command: input.command } : kind === 'skill' ? { skill: input.name } : kind === 'ask' ? input : { file_path: input.file });

export default {
  key: '__KEY__', name: '__NAME__',
  caps: { reply: true, promptContext: true, reminder: 'prompt', packAt: 'pre', readGuard: true, brake: true, choice: true },
  events: { reply: false, pre: ['shell', 'edit', 'read'], post: [] },
  argv: () => ['--agent', '__KEY__'],
  payload(ev, a) {
    const base = { session_id: a.session, cwd: a.cwd, transcript_path: a.file };
    if (ev === 'start') return { ...base, hook_event_name: 'SessionStart', source: 'startup' };
    if (ev === 'prompt') return { ...base, hook_event_name: 'UserPromptSubmit', prompt: a.prompt };
    if (ev === 'pre') return { ...base, hook_event_name: 'PreToolUse', tool_name: TOOL[a.kind] || 'AskUserQuestion', tool_input: toolInput(a.kind, a.input) };
    return { ...base, hook_event_name: 'Stop', stop_hook_active: !!a.again, last_assistant_message: a.reply };
  },
  write(w) {
    const rows = [];
    let n = 0;
    for (const s of w.steps) {
      const id = `c${++n}`, timestamp = s.at;
      if (s.k === 'user') rows.push({ type: 'user', uuid: `u${n}`, timestamp, message: { role: 'user', content: s.text } });
      else if (s.k === 'say') rows.push({ type: 'assistant', timestamp, message: { content: [{ type: 'text', text: s.text }] } });
      else if (s.k === 'skill') rows.push({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name: 'Skill', input: { skill: s.name } }] } });
      else if (s.k === 'tool') rows.push({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id, name: TOOL[s.kind], input: toolInput(s.kind, s.input) }] } }, { type: 'user', timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: s.out, is_error: !!s.error }] } });
      else if (s.k === 'ask') rows.push(...claudeAsk(id, s.questions, s.picks, timestamp));
    }
    return writeRows(w, rows);
  },
  read: claudeShape,
};
