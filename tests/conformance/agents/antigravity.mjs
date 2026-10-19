// Antigravity driver of the conformance suite: hooks as antigravity.google/docs/hooks documents them (camelCase payloads: conversationId,
// workspacePaths, toolCall {name, args}; run_command, write_to_file, view_file, ask_question), each run with `--event`. No hook carries the prompt
// or the reply and the transcript is not documented: Waymark journals each event, so the world is made by the hooks themselves.
import { skillPath, described } from './common.mjs';

const TOOL = { shell: 'run_command', edit: 'write_to_file', read: 'view_file', skill: 'view_file', ask: 'ask_question' };
const NAME = { start: 'SessionStart', prompt: 'UserPromptSubmit', pre: 'PreToolUse', post: 'PostToolUse', stop: 'Stop' };
const args = (kind, i) => (kind === 'shell' ? { CommandLine: i.command } : kind === 'skill' ? { AbsolutePath: skillPath(i.name) } : kind === 'ask' ? { questions: i.questions.map((q) => ({ question: q.question, options: described(q) })) } : kind === 'edit' ? { TargetFile: i.file } : { AbsolutePath: i.file });
let step = 0;

export default {
  key: 'antigravity', name: 'Antigravity',
  caps: { reply: false, promptContext: true, reminder: 'prompt', packAt: 'pre', readGuard: false, brake: false, choice: true, answer: false, noOutput: true, prompt: false },
  events: { reply: false, pre: ['shell', 'edit', 'read', 'skill', 'ask'], post: ['shell', 'edit', 'read', 'skill', 'ask'] }, // matcher "*": every tool is journaled
  argv: (ev) => ['--agent', 'antigravity', '--event', NAME[ev]],
  payload(ev, a) {
    const base = { conversationId: a.session, workspacePaths: [a.cwd], transcriptPath: '', modelName: 'gemini-3-pro' };
    if (ev === 'start') return base;
    if (ev === 'prompt') return { ...base, invocationNum: 1 };
    // a tool's post event carries its pre event's step
    if (ev === 'pre' || ev === 'post') { const stepIdx = ev === 'pre' ? ++step : step; return { ...base, toolCall: { name: TOOL[a.kind], args: args(a.kind, a.input) }, stepIdx, ...(ev === 'post' ? { error: a.error ? String(a.out) : '' } : {}) }; }
    return { ...base, terminationReason: 'complete', fullyIdle: true, executionNum: 1 };
  },
  read(ev, r) {
    const j = r.json || {};
    if (ev === 'start' || ev === 'prompt') return { context: String(j.injectSteps?.[0]?.ephemeralMessage || ''), deny: null, block: null, blockPrompt: null, notice: '' };
    if (ev === 'pre') return { context: j.decision === 'allow' ? String(j.reason || '') : '', deny: j.decision === 'deny' ? String(j.reason || 'deny') : null, block: null, blockPrompt: null, notice: '' };
    if (ev === 'stop') return { context: '', deny: null, block: j.decision === 'continue' ? String(j.reason || '') : null, blockPrompt: null, notice: '' };
    return { context: '', deny: null, block: null, blockPrompt: null, notice: '' };
  },
};
