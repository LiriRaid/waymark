// Waymark · OpenCode plugin (docs/adr/0013): runs Waymark's four hook scripts on OpenCode's events, so OpenCode is a link
// of the same chain as Claude Code, Codex and Gemini CLI. install-hooks.mjs copies it to ~/.config/opencode/plugins/
// waymark.js with __SCRIPTS__ set to the installed waymark/scripts folder; OpenCode loads it at startup.
// - session.created → session-hook (the context card), added to the system prompt of the next request.
// - chat.message → rule0-hook (the task ID and the reminder), added the same way.
// - tool.execute.before → tool-hook: a deny throws, so the tool does not run and the agent gets the reason.
// - tool.execute.after → tool-hook (PostToolUse): the first edit of a file gets its pack appended to the result.
// - session.idle → stop-hook: a block is sent back once as a prompt (the agent continues); the next idle is the retry.
// Before each call the session's messages are written to ~/.waymark/opencode/<session>.jsonl (agents/opencode.mjs reads it).
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SCRIPTS = '__SCRIPTS__';
const DIR = join(process.env.WAYMARK_HOME || join(homedir(), '.waymark'), 'opencode');

export const Waymark = async ({ client, $, directory }) => {
  const pending = new Map(); // session → context for its next request
  const blocked = new Set(); // sessions whose turn the stop-hook already sent back once
  const args = new Map(); // callID → the edit's args, from before to after the tool
  const add = (id, text) => { if (id && text) pending.set(id, [...(pending.get(id) || []), text]); };
  const dump = async (id) => {
    const r = await client.session.messages({ path: { id } });
    const rows = Array.isArray(r) ? r : r?.data || [];
    mkdirSync(DIR, { recursive: true });
    const file = join(DIR, `${id}.jsonl`);
    writeFileSync(file, rows.map((m) => JSON.stringify(m)).join('\n') + '\n');
    return { file, rows };
  };
  let version; // OpenCode's version for the record's inputs, asked once per load (a failed ask is not repeated)
  const agentVersion = async () => {
    if (version === undefined) version = await $`opencode --version`.nothrow().quiet().then((r) => r.stdout.toString().trim().split('\n').pop() || null).catch(() => null);
    return version;
  };
  const run = async (script, payload) => {
    try {
      const input = new Response(JSON.stringify({ cwd: directory, agent_version: await agentVersion(), ...payload }));
      const r = await $`node ${join(SCRIPTS, script)} --agent opencode < ${input}`.nothrow().quiet();
      return JSON.parse(r.stdout.toString().trim() || '{}');
    } catch { return {}; }
  };
  const context = (o) => o?.hookSpecificOutput?.additionalContext || '';
  const lastReply = (rows) => {
    const m = [...rows].reverse().find((x) => x.info?.role === 'assistant' && (x.parts || []).some((p) => p.type === 'text' && p.text?.trim()));
    return (m?.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  };

  return {
    event: async ({ event }) => {
      const id = event.properties?.info?.id || event.properties?.sessionID;
      if (!id) return;
      if (event.type === 'session.created') add(id, context(await run('session-hook.mjs', { session_id: id })));
      if (event.type === 'session.idle') {
        const { file, rows } = await dump(id);
        const o = await run('stop-hook.mjs', { session_id: id, transcript_path: file, stop_hook_active: blocked.has(id), last_assistant_message: lastReply(rows) });
        if (o.decision === 'block' && !blocked.has(id)) {
          blocked.add(id);
          await client.session.prompt({ path: { id }, body: { parts: [{ type: 'text', text: o.reason }] } });
          return;
        }
        blocked.delete(id);
        if (o.systemMessage) await client.tui?.showToast?.({ body: { message: o.systemMessage, variant: 'info' } })?.catch?.(() => {});
      }
    },
    'chat.message': async (input, output) => {
      const prompt = (output.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
      if (/^\s*Waymark: this L/.test(prompt)) return; // the stop-hook's own block reason, sent back above
      const { file } = await dump(input.sessionID);
      add(input.sessionID, context(await run('rule0-hook.mjs', { session_id: input.sessionID, prompt, transcript_path: file })));
    },
    'experimental.chat.system.transform': async (input, output) => {
      const id = input?.sessionID || [...pending.keys()].pop();
      const text = pending.get(id);
      if (text?.length) { output.system.push(...text); pending.delete(id); }
    },
    'tool.execute.before': async (input, output) => {
      if (!['bash', 'edit', 'write', 'apply_patch'].includes(input.tool)) return; // the gate judges changes only
      if (input.tool !== 'bash') args.set(input.callID, output.args); // the after hook hands this file's pack
      const { file } = await dump(input.sessionID);
      const o = await run('tool-hook.mjs', { session_id: input.sessionID, tool_name: input.tool, tool_input: output.args, transcript_path: file });
      const deny = o?.hookSpecificOutput?.permissionDecision === 'deny' && o.hookSpecificOutput.permissionDecisionReason;
      if (deny) { args.delete(input.callID); throw new Error(deny); }
    },
    // Recordar by the hook: the first edit of each file gets its pack appended to the tool's result
    'tool.execute.after': async (input, output) => {
      if (!args.has(input.callID)) return;
      const toolInput = args.get(input.callID);
      args.delete(input.callID);
      const o = await run('tool-hook.mjs', { hook_event_name: 'PostToolUse', session_id: input.sessionID, tool_name: input.tool, tool_input: toolInput });
      const text = context(o);
      if (text && output) output.output = `${output.output ?? ''}\n\n${text}`;
    },
  };
};
