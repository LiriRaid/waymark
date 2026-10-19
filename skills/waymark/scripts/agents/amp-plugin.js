// Waymark · Amp plugin (docs/adr/0041): runs Waymark's hook scripts on Amp's plugin events, so Amp is a link of the same chain as Claude Code.
// install-hooks.mjs copies it to ~/.config/amp/plugins/waymark.js (XDG_CONFIG_HOME, WAYMARK_AMP_PLUGIN move it) with __SCRIPTS__ set to
// the installed waymark/scripts folder (ampcode.com/docs/customize/plugins and /docs/plugin-api, checked 2026-10-19).
// - session.start → session-hook (the card); it returns nothing, so the card waits for the thread's next prompt.
// - agent.start → rule0-hook (the task ID and the reminder): the answer's context is returned as the message appended to that turn, and
//   a {decision: block} cancels the turn.
// - tool.call → tool-hook: a deny is returned as {action: 'reject-and-continue', message}; everything else is allowed.
// - tool.result → tool-hook (PostToolUse): the first edit of a file gets its pack, held for the thread's next prompt.
// - agent.end → stop-hook with the last assistant text: a block comes back as {action: 'continue', userMessage}, once.
// The hooks run as `node hook-run.cjs <script> --agent amp` with a child process (the plugin runs on Bun, whose process.execPath is not
// node). Every handler answers "allow" when anything fails: a hook that cannot run never stops the agent.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const SCRIPTS = '__SCRIPTS__';

export default function (amp) {
  const pending = new Map(); // thread → context for its next prompt
  const blocked = new Set(); // threads whose turn the stop-hook already sent back once
  const add = (id, text) => { if (id && text) pending.set(id, [...(pending.get(id) || []), text]); };
  const workspace = (ctx) => { try { return amp.helpers.filePathFromURI(ctx.system.workspaceRoot) || process.cwd(); } catch { return process.cwd(); } };
  const run = (script, payload) => {
    try {
      const r = spawnSync('node', [join(SCRIPTS, 'hook-run.cjs'), join(SCRIPTS, script), '--agent', 'amp'], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 60000 });
      if (r.error) amp.logger?.log?.(`Waymark: ${script} did not run (${r.error.message}); the hooks are not checking this thread`);
      return JSON.parse(String(r.stdout || '').trim() || '{}');
    } catch { return {}; }
  };
  const context = (o) => o?.hookSpecificOutput?.additionalContext || '';
  const text = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
  const filesOf = (event) => { try { return (amp.helpers.filesModifiedByToolCall(event) || []).map((u) => amp.helpers.filePathFromURI(u)); } catch { return []; } };
  const commandOf = (event) => { try { return amp.helpers.shellCommandFromToolCall(event)?.command || ''; } catch { return ''; } };
  const lastReply = (messages) => {
    const m = [...(messages || [])].reverse().find((x) => x.role === 'assistant' && (x.content || []).some((p) => p.type === 'text' && p.text?.trim()));
    return (m?.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  };
  const tool = (event, ctx, extra = {}) => ({ session_id: event.thread.id, cwd: workspace(ctx), tool_name: event.tool, tool_use_id: event.toolUseID, tool_input: event.input,
    command: commandOf(event), files: filesOf(event), ...extra });

  amp.on('session.start', (event, ctx) => {
    add(event.thread.id, context(run('session-hook.mjs', { hook_event_name: 'SessionStart', session_id: event.thread.id, cwd: workspace(ctx) })));
  });

  amp.on('agent.start', (event, ctx) => {
    const id = event.thread.id, blockedText = /^\s*Waymark: this L/.test(event.message || '');
    if (blockedText) return undefined; // the stop-hook's own block reason, sent back by agent.end
    const o = run('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', session_id: id, cwd: workspace(ctx), prompt: event.message });
    if (o.decision === 'block') { try { ctx.thread.cancel(); } catch {} return undefined; } // the context brake: the turn never starts
    add(id, context(o));
    const held = pending.get(id) || [];
    pending.delete(id);
    return held.length ? { message: { content: held.join('\n\n'), display: false } } : undefined;
  });

  amp.on('tool.call', (event, ctx) => {
    const o = run('tool-hook.mjs', { hook_event_name: 'PreToolUse', ...tool(event, ctx) });
    const deny = o?.hookSpecificOutput?.permissionDecision === 'deny' && o.hookSpecificOutput.permissionDecisionReason;
    return deny ? { action: 'reject-and-continue', message: deny } : { action: 'allow' };
  });

  amp.on('tool.result', (event, ctx) => {
    const o = run('tool-hook.mjs', { hook_event_name: 'PostToolUse', ...tool(event, ctx, { tool_response: { status: event.status, error: text(event.error), output: text(event.output) } }) });
    add(event.thread.id, context(o));
  });

  amp.on('agent.end', (event, ctx) => {
    const id = event.thread.id;
    const o = run('stop-hook.mjs', { hook_event_name: 'Stop', session_id: id, cwd: workspace(ctx), stop_hook_active: blocked.has(id), last_assistant_message: lastReply(event.messages) });
    if (o.decision === 'block' && !blocked.has(id)) { blocked.add(id); return { action: 'continue', userMessage: o.reason, maxContinuations: 1 }; }
    blocked.delete(id);
    return undefined;
  });
}
