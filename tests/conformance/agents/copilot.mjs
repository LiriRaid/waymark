// Copilot CLI driver of the conformance suite: hooks as docs.github.com/en/copilot/reference/hooks-reference documents them (Claude Code's
// event names, the VS Code payload), its session log as ~/.copilot/session-state/<session>/events.jsonl (as the community describes it).
import fs from 'node:fs';
import path from 'node:path';
import { skillPath, described } from './common.mjs';

const TOOL = { shell: 'Bash', edit: 'Edit', read: 'Read' };
const args = (kind, input) => (kind === 'shell' ? { command: input.command } : { file_path: input.file });
const NAME = { start: 'SessionStart', prompt: 'UserPromptSubmit', pre: 'PreToolUse', post: 'PostToolUse', stop: 'Stop' };

export default {
  key: 'copilot', name: 'Copilot CLI',
  caps: { reply: true, promptContext: false, reminder: null, packAt: 'post', readGuard: false, brake: false, choice: true },
  events: { reply: false, pre: ['shell', 'edit'], post: ['shell', 'edit'] }, // the matcher names the shell and edit tools
  argv: () => ['--agent', 'copilot'],
  payload(ev, a) {
    const base = { hook_event_name: NAME[ev], session_id: a.session, cwd: a.cwd };
    if (ev === 'start') return { ...base, source: 'startup' };
    if (ev === 'prompt') return { ...base, prompt: a.prompt };
    if (ev === 'pre' || ev === 'post') return { ...base, tool_name: TOOL[a.kind], tool_input: args(a.kind, a.input), ...(ev === 'post' ? { tool_result: { content: a.out } } : {}) };
    return { ...base, stop_hook_active: !!a.again };
  },
  write(w) {
    const file = path.join(w.env.COPILOT_HOME, 'session-state', w.session, 'events.jsonl');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const rows = [];
    let n = 0;
    const start = (s, toolName, arguments_) => { const id = `t${++n}`; rows.push({ type: 'tool.execution_start', id: `e${n}`, timestamp: s.at, data: { toolCallId: id, toolName, arguments: arguments_ } }); return id; };
    const done = (s, id, content, success = true) => rows.push({ type: 'tool.execution_complete', id: `d${n}`, timestamp: s.at, data: { toolCallId: id, success, result: { content } } });
    for (const s of w.steps) {
      if (s.k === 'user') rows.push({ type: 'user.message', id: `u${++n}`, timestamp: s.at, data: { content: s.text } });
      else if (s.k === 'say') rows.push({ type: 'assistant.message', id: `a${++n}`, timestamp: s.at, data: { content: s.text } });
      else if (s.k === 'skill') done(s, start(s, 'Skill', { skill: s.name }), 'skill text');
      else if (s.k === 'tool') done(s, start(s, TOOL[s.kind], args(s.kind, s.input)), s.out, !s.error);
      else if (s.k === 'ask') done(s, start(s, 'ask_user', { questions: s.questions.map((q) => ({ question: q.question, choices: described(q) })) }), Object.values(s.picks).join(', '));
    }
    fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  },
  read(ev, r) {
    const j = r.json || {};
    return { context: String(j.additionalContext || ''), deny: j.permissionDecision === 'deny' ? String(j.permissionDecisionReason || 'deny') : null, block: ev === 'stop' && j.decision === 'block' ? String(j.reason || '') : null, blockPrompt: null, notice: '' };
  },
};
