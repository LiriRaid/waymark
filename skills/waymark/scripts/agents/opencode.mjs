// Waymark · OpenCode adapter (docs/adr/0013). Same exports as claude.mjs.
// OpenCode has no command hooks: the plugin `opencode-plugin.js` (installed as ~/.config/opencode/plugins/waymark.js by
// install-hooks.mjs) runs the same four scripts with `--agent opencode` on session.created, chat.message,
// tool.execute.before and session.idle (opencode.ai/docs/plugins). Before each call it writes the session's messages, as
// the SDK returns them (client.session.messages: one {info, parts} per line), to ~/.waymark/opencode/<session>.jsonl and
// passes that file as transcript_path. The plugin reads the hook's JSON answer itself: additionalContext goes into the
// system prompt, a deny throws (the tool does not run), a block is sent back as a prompt once, a notice is a toast.
// Parts (seen in OpenCode 1.18 sessions): text; tool {tool, callID, state{status, input, output, metadata}} with tools
// bash (command), edit / write / read (filePath), apply_patch (patchText), question (questions[]; the answers are
// state.metadata.answers, one list per question) and skill (name). Assistant info carries tokens{input, output,
// reasoning, cache{read, write}} and modelID.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTail } from '../transcript.mjs';
import { out as claudeOut } from './claude.mjs';
import { patchFiles } from './codex.mjs';

export const name = 'opencode';
export const instructions = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
export const preContext = false; // tool.execute.before cannot add context: the plugin appends the pack to the result (tool.execute.after)
export const lacks = []; // no code-review skill in OpenCode: its review is waymark.mjs review
export const out = claudeOut; // the plugin reads these shapes
export const dumpDir = () => path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'opencode');

const textOf = (parts) => (parts || []).filter((p) => p.type === 'text' && !p.synthetic).map((p) => p.text || '').join('\n');

// The dumped messages → the core's lines (Claude Code .jsonl shape, canonical tool names).
export function toLines(rows, cwd = process.cwd(), version = null) { // version: OpenCode's, from the plugin (agent_version)
  const lines = [];
  let n = 0;
  const assistant = (ts, content, extra = {}) => lines.push({ type: 'assistant', timestamp: ts, message: { id: `oc-${n++}`, content, ...extra } });
  for (const { info = {}, parts = [] } of rows) {
    const ts = info.time?.created ? new Date(info.time.created).toISOString() : undefined;
    if (info.role === 'user') {
      const text = textOf(parts);
      if (text.trim()) lines.push({ type: 'user', uuid: info.id, timestamp: ts, ...(version ? { version } : {}), message: { role: 'user', content: text } });
      continue;
    }
    if (info.role !== 'assistant') continue;
    for (const p of parts) {
      if (p.type === 'text' && p.text?.trim()) { assistant(ts, [{ type: 'text', text: p.text }], { model: info.modelID }); continue; }
      if (p.type !== 'tool') continue;
      const st = p.state || {}, a = st.input || {}, id = p.callID || `oc-call-${n}`;
      const at = st.time?.start ? new Date(st.time.start).toISOString() : ts;
      const isError = st.status === 'error';
      const end = st.time?.end ? new Date(st.time.end).toISOString() : at; // a tool lasts from its start to its end
      const res = () => lines.push({ type: 'user', timestamp: end, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: String(st.output ?? st.error ?? '').slice(0, 400) }] } });
      if (p.tool === 'question') {
        const qs = (a.questions || []).map((q) => ({ question: String(q.question || q.header || '').trim(), options: (q.options || []).map((o) => ({ label: String(o?.label ?? o) })) }));
        assistant(at, [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { questions: qs } }]);
        const picked = st.metadata?.answers || [];
        const answers = Object.fromEntries(qs.map((q, i) => [q.question, [].concat(picked[i] || []).join(',')]).filter(([, v]) => v));
        if (!isError && Object.keys(answers).length) lines.push({ type: 'user', timestamp: end, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] }, toolUseResult: { questions: qs, answers } });
        else res();
        continue;
      }
      if (p.tool === 'apply_patch') {
        for (const file of patchFiles(a.patchText, cwd)) assistant(at, [{ type: 'tool_use', name: 'Edit', id: `${id}:${file}`, input: { file_path: file } }]);
        res();
        continue;
      }
      const tool = { bash: ['Bash', { command: String(a.command || '') }], edit: ['Edit', { file_path: a.filePath }], write: ['Write', { file_path: a.filePath }],
        read: ['Read', { file_path: a.filePath }], skill: ['Skill', { skill: a.name }], grep: ['Grep', { pattern: a.pattern, path: a.path }], glob: ['Glob', { pattern: a.pattern }],
        webfetch: ['WebFetch', { url: a.url }] }[p.tool] || [p.tool, a];
      assistant(at, [{ type: 'tool_use', name: tool[0], id, input: tool[1] }]);
      res();
    }
    const t = info.tokens;
    if (t) assistant(ts, [], { usage: { input_tokens: t.input || 0, cache_read_input_tokens: t.cache?.read || 0, cache_creation_input_tokens: t.cache?.write || 0, output_tokens: (t.output || 0) + (t.reasoning || 0) } });
  }
  return lines;
}

export const read = (hook, bytes) => toLines(readTail(hook.transcript_path, bytes), hook.cwd, hook.agent_version || null);

export function call(hook) {
  const tool = hook.tool_name || '', input = hook.tool_input || {};
  if (tool === 'bash') return { command: String(input.command || '') };
  if (/^(edit|write)$/.test(tool)) return { files: [input.filePath].filter(Boolean) };
  if (tool === 'apply_patch') return { files: patchFiles(input.patchText, hook.cwd) };
  return null;
}

export const note = (skillsDir) => ` In OpenCode: invoke a department with the skill tool (name: dept-<owner>); code-review = node ${String(skillsDir).replace(/\\/g, '/')}/waymark/scripts/waymark.mjs review <the task's files>; the choice window is the question tool.`;

// The dumped sessions of cwd, newest first (each dump's messages carry their session's directory in info.path.cwd).
export function sessions(cwd) {
  const want = String(cwd).replace(/\\/g, '/').toLowerCase();
  try {
    return fs.readdirSync(dumpDir()).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dumpDir(), f))
      .filter((f) => { const first = readTail(f, 64 * 1024).find((r) => r.info?.path?.cwd); return String(first?.info?.path?.cwd || '').replace(/\\/g, '/').toLowerCase() === want; })
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  } catch { return []; }
}
