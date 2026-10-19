// Gemini CLI driver of the conformance suite: hooks as google-gemini/gemini-cli docs/hooks/reference.md documents them (SessionStart,
// BeforeAgent, BeforeTool, AfterTool, AfterAgent; run_shell_command, write_file, replace, read_file, ask_user), its chat as the append-only .jsonl.
import { writeRows, skillPath, described } from './common.mjs';

const TOOL = { shell: 'run_shell_command', edit: 'replace', read: 'read_file' };
const args = (kind, input) => (kind === 'shell' ? { command: input.command } : { file_path: input.file });
const EVENT = { start: 'SessionStart', prompt: 'BeforeAgent', pre: 'BeforeTool', post: 'AfterTool', stop: 'AfterAgent' };

export default {
  key: 'gemini', name: 'Gemini CLI',
  caps: { reply: true, promptContext: true, reminder: 'prompt', packAt: 'post', readGuard: false, brake: true, choice: true },
  events: { reply: false, pre: ['shell', 'edit'], post: ['shell', 'edit'] }, // the matcher is run_shell_command|write_file|replace; AfterTool is registered
  argv: () => ['--agent', 'gemini'],
  payload(ev, a) {
    const base = { hook_event_name: EVENT[ev], session_id: a.session, cwd: a.cwd, transcript_path: a.file };
    if (ev === 'start') return { ...base, source: 'startup' };
    if (ev === 'prompt') return { ...base, prompt: a.prompt };
    if (ev === 'pre' || ev === 'post') return { ...base, tool_name: TOOL[a.kind], tool_input: args(a.kind, a.input), ...(ev === 'post' ? { tool_response: { llmContent: a.out } } : {}) };
    return { ...base, stop_hook_active: !!a.again, prompt_response: a.reply };
  },
  write(w) {
    const rows = [{ sessionId: w.session, projectHash: 'h', startTime: w.steps[0]?.at, kind: 'main' }];
    let n = 0;
    const msg = (s, extra) => rows.push({ id: `g${++n}`, timestamp: s.at, type: 'gemini', content: '', model: 'gemini-3-pro', ...extra });
    const call = (s, name, a, result = 'ok', status = 'success') => msg(s, { toolCalls: [{ id: `c${n + 1}`, name, args: a, status, result, timestamp: s.at }] });
    for (const s of w.steps) {
      if (s.k === 'user') rows.push({ id: `u${++n}`, timestamp: s.at, type: 'user', content: s.text });
      else if (s.k === 'say') msg(s, { content: s.text });
      else if (s.k === 'skill') call(s, 'read_file', { file_path: skillPath(s.name) }, 'skill text');
      else if (s.k === 'tool') call(s, TOOL[s.kind], args(s.kind, s.input), s.out, s.error ? 'error' : 'success');
      else if (s.k === 'ask') {
        const qs = s.questions.map((q) => ({ question: q.question, options: described(q) }));
        call(s, 'ask_user', { questions: qs }, JSON.stringify({ answers: Object.fromEntries(s.questions.map((q, i) => [i, s.picks[q.question]])) }));
      }
    }
    return writeRows(w, rows, 'chat.jsonl');
  },
  read(ev, r) {
    const j = r.json || {}, o = j.hookSpecificOutput || {};
    return { context: String(o.additionalContext || ''), deny: ev === 'pre' && j.decision === 'deny' ? String(j.reason || 'deny') : null, block: ev === 'stop' && j.decision === 'deny' ? String(j.reason || '') : null,
      blockPrompt: ev === 'prompt' && j.decision === 'deny' ? String(j.reason || '') : null, notice: String(j.systemMessage || '') };
  },
};
