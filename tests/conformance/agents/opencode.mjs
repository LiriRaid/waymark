// OpenCode driver of the conformance suite: the plugin (opencode.ai/docs/plugins) runs Waymark's scripts on session.created, chat.message,
// tool.execute.before/after and session.idle with Claude-shaped payloads and the session's messages dumped as {info, parts}.
import { claudeShape, writeRows, described } from './common.mjs';

const TOOL = { shell: 'bash', edit: 'edit', read: 'read' };

export default {
  key: 'opencode', name: 'OpenCode',
  caps: { reply: true, promptContext: true, reminder: 'prompt', packAt: 'post', readGuard: false, brake: true, choice: true },
  events: { reply: false, pre: ['shell', 'edit'], post: ['edit'] }, // the plugin judges bash, edit, write and apply_patch before; hands the pack after an edit
  argv: () => ['--agent', 'opencode'],
  payload(ev, a) {
    const base = { session_id: a.session, cwd: a.cwd, agent_version: '1.18.0' };
    if (ev === 'start') return base;
    if (ev === 'prompt') return { ...base, prompt: a.prompt, transcript_path: a.file };
    if (ev === 'pre') return { ...base, transcript_path: a.file, tool_name: TOOL[a.kind], tool_input: a.kind === 'shell' ? { command: a.input.command } : { filePath: a.input.file } };
    if (ev === 'post') return { ...base, hook_event_name: 'PostToolUse', transcript_path: a.file, tool_name: TOOL[a.kind], tool_input: { filePath: a.input.file } };
    return { ...base, transcript_path: a.file, stop_hook_active: !!a.again, last_assistant_message: a.reply };
  },
  write(w) {
    const rows = [];
    let n = 0;
    const at = (s) => Date.parse(s.at);
    const assistant = (s, parts) => rows.push({ info: { id: `a${++n}`, role: 'assistant', modelID: 'm', time: { created: at(s) } }, parts });
    const tool = (s, name, input, output = 'ok', extra = {}) => assistant(s, [{ type: 'tool', tool: name, callID: `k${n + 1}`, state: { status: 'completed', input, output, time: { start: at(s), end: at(s) }, ...extra } }]);
    for (const s of w.steps) {
      if (s.k === 'user') rows.push({ info: { id: `u${++n}`, role: 'user', time: { created: at(s) } }, parts: [{ type: 'text', text: s.text }] });
      else if (s.k === 'say') assistant(s, [{ type: 'text', text: s.text }]);
      else if (s.k === 'skill') tool(s, 'skill', { name: s.name });
      else if (s.k === 'tool') tool(s, TOOL[s.kind], s.kind === 'shell' ? { command: s.input.command } : { filePath: s.input.file }, s.out);
      else if (s.k === 'ask') tool(s, 'question', { questions: s.questions.map((q) => ({ question: q.question, options: described(q) })) }, 'answered', { metadata: { answers: s.questions.map((q) => [s.picks[q.question]]) } });
    }
    return writeRows(w, rows, 'opencode.jsonl');
  },
  read: claudeShape,
};
