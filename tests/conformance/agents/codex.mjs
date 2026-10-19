// Codex CLI driver of the conformance suite: hooks as learn.chatgpt.com/docs/hooks documents them (Claude Code's events and answers; Bash and
// apply_patch as the tools), its transcript as the rollout .jsonl (item_completed events, request_user_input calls).
import { claudeShape, writeRows, skillPath, described } from './common.mjs';

const patch = (file) => `*** Begin Patch\n*** Update File: ${file}\n@@\n-x\n+y\n*** End Patch`;

export default {
  key: 'codex', name: 'Codex',
  caps: { reply: true, promptContext: true, reminder: 'prompt', packAt: 'pre', readGuard: false, brake: true, choice: true },
  events: { reply: false, pre: ['shell', 'edit'], post: [] }, // the matcher is Bash|apply_patch
  argv: () => ['--agent', 'codex'],
  payload(ev, a) {
    const base = { session_id: a.session, cwd: a.cwd, transcript_path: a.file, model: 'gpt-5-codex' };
    if (ev === 'start') return { ...base, hook_event_name: 'SessionStart', source: 'startup' };
    if (ev === 'prompt') return { ...base, hook_event_name: 'UserPromptSubmit', prompt: a.prompt };
    if (ev === 'pre') return { ...base, hook_event_name: 'PreToolUse', ...(a.kind === 'edit' ? { tool_name: 'apply_patch', tool_input: { command: patch(a.input.file) } } : { tool_name: 'Bash', tool_input: { command: a.input.command } }) };
    return { ...base, hook_event_name: 'Stop', stop_hook_active: !!a.again, last_assistant_message: a.reply };
  },
  write(w) {
    const rows = [{ timestamp: w.steps[0]?.at, type: 'session_meta', payload: { cli_version: '0.160.0', cwd: w.cwd } }, { timestamp: w.steps[0]?.at, type: 'turn_context', payload: { model: 'gpt-5-codex' } }];
    let n = 0;
    const item = (s, it) => rows.push({ timestamp: s.at, type: 'event_msg', payload: { type: 'item_completed', turn_id: 't1', item: it } });
    const run = (s, command, out = 'ok', error = false) => item(s, { type: 'CommandExecution', id: `i${++n}`, command, aggregated_output: out, exit_code: error ? 1 : 0, status: error ? 'failed' : 'completed', duration: { secs: 0 } });
    for (const s of w.steps) {
      if (s.k === 'user') item(s, { type: 'UserMessage', id: `m${++n}`, content: [{ type: 'text', text: s.text }] });
      else if (s.k === 'say') item(s, { type: 'AgentMessage', id: `m${++n}`, content: [{ text: s.text }] });
      else if (s.k === 'skill') run(s, `cat ${skillPath(s.name)}`, 'skill text');
      else if (s.k === 'tool' && s.kind === 'edit') item(s, { type: 'FileChange', id: `i${++n}`, changes: { [s.input.file]: {} } });
      else if (s.k === 'tool') run(s, s.kind === 'read' ? `cat ${s.input.file}` : s.input.command, s.out, s.error);
      else if (s.k === 'ask') {
        const id = `ask${++n}`, qs = s.questions.map((q, i) => ({ id: `q${i}`, question: q.question, options: described(q) }));
        rows.push({ timestamp: s.at, type: 'response_item', payload: { type: 'function_call', name: 'request_user_input', call_id: id, arguments: JSON.stringify({ questions: qs }) } });
        rows.push({ timestamp: s.at, type: 'response_item', payload: { type: 'function_call_output', call_id: id, output: JSON.stringify({ answers: Object.fromEntries(s.questions.map((q, i) => [`q${i}`, { answers: [s.picks[q.question]] }])) }) } });
      }
    }
    return writeRows(w, rows, 'rollout.jsonl');
  },
  read: claudeShape,
};
