// Waymark 2.0.18 · point 12: the Qwen Code, Droid and Amp adapters (docs/adr/0041), from the payloads their documentation gives: how install-hooks
// registers each (nested under "hooks", the events as the file's own keys, a plugin), how the hook's stdin becomes the core's fields and the
// journal, what each answer looks like, uninstall, and Amp's plugin run against the real hooks. Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME and hooks files; nothing reads or writes the real ones.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-newad-'));
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: home, WAYMARK_BACKUPS: path.join(home, 'backups'), WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1',
  WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'), WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'),
  WAYMARK_QWEN_SETTINGS: path.join(home, 'qwen-settings.json'), WAYMARK_DROID_HOOKS: path.join(home, 'droid-hooks.json'), WAYMARK_AMP_PLUGIN: path.join(home, 'amp-plugin.js'),
});
const url = (f) => pathToFileURL(path.join(SCRIPTS, f)).href;
const I = await import(url('install-hooks.mjs'));
const J = await import(url('agents/journal.mjs'));
const QWEN = await import(url('agents/qwen.mjs'));
const DROID = await import(url('agents/droid.mjs'));
const AMP = await import(url('agents/amp.mjs'));
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const readJournal = (agent, session) => fs.readFileSync(J.journalOf(agent, session), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const S = '/s/waymark/scripts';
const cmd = (file, agent) => `node "${S}/hook-run.cjs" "${S}/${file}" --agent ${agent}`;

// ---- registration ----

test('install-hooks --agent qwen: ~/.qwen/settings.json under "hooks", the five events, Claude\'s matcher ids, a command through the launcher; idempotent; the user\'s settings stay', () => {
  const mine = { model: 'qwen3-coder', hooks: { PreToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: 'echo theirs' }] }] } };
  const { settings, steps } = I.planHooks(mine, { scripts: S, agent: 'qwen' });
  assert.equal(settings.model, 'qwen3-coder');
  assert.deepEqual(Object.keys(settings.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  const pre = settings.hooks.PreToolUse;
  assert.equal(pre[0].hooks[0].command, 'echo theirs', 'the user\'s hook stays, first');
  assert.deepEqual(pre[1], { matcher: 'run_shell_command|write_file|edit|replace|read_file', hooks: [{ type: 'command', command: cmd('tool-hook.mjs', 'qwen') }] });
  assert.equal(settings.hooks.Stop[0].hooks[0].command, cmd('stop-hook.mjs', 'qwen'));
  assert.equal(steps.length, 5);
  assert.deepEqual(I.planHooks(settings, { scripts: S, agent: 'qwen' }).steps, [], 'idempotent');
});

test('install-hooks --agent droid: ~/.factory/hooks.json with the events as the file\'s own keys (no "hooks" wrapper); idempotent; the user\'s events stay', () => {
  const mine = { Notification: [{ hooks: [{ type: 'command', command: 'notify-me' }] }] };
  const { settings, steps } = I.planHooks(mine, { scripts: S, agent: 'droid' });
  assert.equal(settings.hooks, undefined, 'the events are top-level keys');
  assert.deepEqual(Object.keys(settings).sort(), ['Notification', 'PostToolUse', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  assert.equal(settings.Notification[0].hooks[0].command, 'notify-me');
  assert.deepEqual(settings.PreToolUse, [{ matcher: 'Execute|Create|Edit|ApplyPatch|Read', hooks: [{ type: 'command', command: cmd('tool-hook.mjs', 'droid') }] }]);
  assert.equal(steps.length, 5);
  assert.deepEqual(I.planHooks(settings, { scripts: S, agent: 'droid' }).steps, [], 'idempotent');
});

test('install-hooks --agent amp: a plugin file with its scripts folder in place, and PLUGINS lists it next to OpenCode', () => {
  assert.deepEqual([...I.PLUGINS].sort(), ['amp', 'opencode']);
  const text = I.pluginText(S, 'amp');
  assert.match(text, /const SCRIPTS = "\/s\/waymark\/scripts";/);
  assert.match(text, /hook-run\.cjs/);
  assert.equal(I.PLUGIN('amp'), process.env.WAYMARK_AMP_PLUGIN);
  assert.equal(I.pluginText(S), I.pluginText(S, 'opencode'), 'OpenCode stays the default');
});

test('registered(), check\'s probe and uninstall see the three: Qwen\'s entries, Droid\'s top-level ones and Amp\'s plugin', () => {
  write(process.env.WAYMARK_QWEN_SETTINGS, JSON.stringify({ model: 'q', ...I.planHooks({}, { scripts: S, agent: 'qwen' }).settings }));
  write(process.env.WAYMARK_DROID_HOOKS, JSON.stringify({ Notification: [{ hooks: [{ type: 'command', command: 'notify-me' }] }], ...I.planHooks({}, { scripts: S, agent: 'droid' }).settings }));
  write(process.env.WAYMARK_AMP_PLUGIN, I.pluginText(S, 'amp'));
  const seen = Object.fromEntries(I.registered().map((r) => [r.agent, r.commands.length]));
  assert.deepEqual([seen.qwen, seen.droid, seen.amp], [4, 4, 4], `the four scripts (the pre and post tool events share one command): ${JSON.stringify(seen)}`);
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'uninstall.mjs'), '--apply'], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const qwen = JSON.parse(fs.readFileSync(process.env.WAYMARK_QWEN_SETTINGS, 'utf8'));
  assert.deepEqual([qwen.model, Object.keys(qwen.hooks || {})], ['q', []], 'Qwen\'s hooks are gone and its settings stay');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(process.env.WAYMARK_DROID_HOOKS, 'utf8'))), ['Notification'], 'Droid\'s file keeps the user\'s event');
  assert.ok(!fs.existsSync(process.env.WAYMARK_AMP_PLUGIN), 'the plugin was Waymark\'s: removed');
});

// ---- the payloads ----

test('Qwen Code: the hook\'s stdin becomes the core\'s fields and the journal (prompt, tools with their ids, results, the reply at Stop)', () => {
  const base = { session_id: 'q1', cwd: '/p', transcript_path: '/q/t.jsonl' };
  const prompt = QWEN.input({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'legacy', submitted_prompt: 'agrega reintentos' });
  assert.equal(prompt.prompt, 'agrega reintentos', 'submitted_prompt is the user\'s text');
  assert.equal(prompt.transcript_path, J.journalOf('qwen', 'q1'), 'the journal, not Qwen\'s unnamed transcript');
  QWEN.input({ ...base, hook_event_name: 'PreToolUse', tool_name: 'run_shell_command', tool_input: { command: 'npm test' }, tool_use_id: 'c1' });
  QWEN.input({ ...base, hook_event_name: 'PostToolUse', tool_name: 'run_shell_command', tool_input: { command: 'npm test' }, tool_use_id: 'c1', tool_response: { output: 'ok' } });
  QWEN.input({ ...base, hook_event_name: 'PreToolUse', tool_name: 'read_file', tool_input: { file_path: '/skills/dept-qa/SKILL.md' }, tool_use_id: 'c2' });
  QWEN.input({ ...base, hook_event_name: 'PostToolUse', tool_name: 'run_shell_command', tool_use_id: 'c3', tool_response: { error: 'boom', exit_code: 1 } });
  const stop = QWEN.input({ ...base, hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: '## Cierre' });
  assert.equal(stop.stop_hook_active, true, 'the agent\'s own flag');
  const rows = readJournal('qwen', 'q1');
  assert.deepEqual(rows.map((r) => r.event), ['prompt', 'tool', 'result', 'tool', 'result', 'reply', 'stop']);
  assert.deepEqual([rows[1].tool, rows[1].input], ['Bash', { command: 'npm test' }]);
  assert.equal(rows[3].skill, 'dept-qa', 'a read of <dir>/<skill>/SKILL.md is the skill call');
  assert.ok(rows[4].error.includes('boom'), 'a failed result carries its error');
  const lines = QWEN.read({ transcript_path: stop.transcript_path });
  assert.ok(lines.some((l) => l.message?.content?.some?.((c) => c.type === 'tool_use' && c.name === 'Skill' && c.input.skill === 'dept-qa')));
  assert.ok(lines.some((l) => l.type === 'assistant' && l.message.content.some((c) => c.type === 'text' && /Cierre/.test(c.text))), 'the reply is a line');
  assert.deepEqual(QWEN.call({ tool_name: 'write_file', tool_input: { file_path: '/p/a.mjs' } }), { files: ['/p/a.mjs'] });
  assert.deepEqual(QWEN.call({ tool_name: 'Read', tool_input: { file_path: '/p/.env' } }), { reads: ['/p/.env'] }, 'the Claude alias works too');
  assert.equal(QWEN.call({ tool_name: 'glob', tool_input: {} }), null);
  assert.deepEqual(QWEN.lacks, ['cierre', 'evidence', 'decision']);
  assert.deepEqual(QWEN.out.deny('no'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } }, 'both fields: Qwen requires them');
});

test('Droid: Execute, Create and Read map to the core\'s tools; ApplyPatch names its files; UserPromptSubmit context goes both ways; a stop answered already is known', () => {
  const base = { session_id: 'd1', cwd: '/p', transcript_path: '' };
  assert.equal(DROID.input({ ...base, hook_event_name: 'UserPromptSubmit', prompt: '', has_images: true }).prompt, '(Droid: the hook did not carry the prompt)', 'an image-only prompt still opens the turn');
  DROID.input({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Execute', tool_input: { command: 'ls' }, tool_use_id: 'e1' });
  DROID.input({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Create', tool_input: { file_path: '/p/new.mjs', content: 'x' }, tool_use_id: 'e2' });
  assert.equal(DROID.input({ ...base, hook_event_name: 'Stop', stop_hook_active: false }).stop_hook_active, false);
  assert.equal(DROID.input({ ...base, hook_event_name: 'Stop', stop_hook_active: false }).stop_hook_active, true, 'a second Stop after one with no new prompt: already answered');
  const rows = readJournal('droid', 'd1');
  assert.deepEqual(rows.filter((r) => r.event === 'tool').map((r) => [r.tool, r.input]), [['Bash', { command: 'ls' }], ['Edit', { file_path: '/p/new.mjs' }]]);
  assert.deepEqual(DROID.call({ tool_name: 'Execute', tool_input: { command: 'git push' } }), { command: 'git push' });
  assert.deepEqual(DROID.call({ tool_name: 'Create', tool_input: { file_path: '/p/a.mjs' } }), { files: ['/p/a.mjs'] });
  assert.deepEqual(DROID.call({ tool_name: 'Read', tool_input: { file_path: '/p/.env' } }), { reads: ['/p/.env'] });
  const patch = '*** Begin Patch\n*** Update File: src/a.mjs\n@@\n-a\n+b\n*** End Patch\n';
  assert.deepEqual(DROID.call({ tool_name: 'ApplyPatch', tool_input: { patch }, cwd: '/p' }).files.map((f) => f.replace(/\\/g, '/')).map((f) => f.replace(/^.*\/p\//, '')), ['src/a.mjs']);
  assert.equal(DROID.call({ tool_name: 'Grep', tool_input: {} }), null);
  const ctx = DROID.out.context('UserPromptSubmit', 'CARD');
  assert.equal(ctx.additionalContext, 'CARD', 'bare, as the guide writes it');
  assert.equal(ctx.hookSpecificOutput.additionalContext, 'CARD', 'and under hookSpecificOutput, as SessionStart and PostToolUse document it');
  assert.deepEqual(DROID.out.context('SessionStart', 'CARD'), { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'CARD' } });
  assert.deepEqual(DROID.out.block('x'), { decision: 'block', reason: 'x' });
  assert.equal(DROID.preContext, false, 'PreToolUse documents no context: the pack rides on the result');
});

test('Amp: the helpers\' command and files win over the input\'s unnamed fields; a tool result and the reply are journaled; the thread is the session', () => {
  const base = { session_id: 'T-1', cwd: '/p' };
  AMP.input({ ...base, hook_event_name: 'PreToolUse', tool_name: 'shell_command', tool_use_id: 'a1', tool_input: { cmd: 'ls' }, command: 'ls', files: [] });
  AMP.input({ ...base, hook_event_name: 'PreToolUse', tool_name: 'edit_file', tool_use_id: 'a2', tool_input: { path: '/p/a.mjs' }, command: '', files: ['/p/a.mjs'] });
  AMP.input({ ...base, hook_event_name: 'PostToolUse', tool_name: 'edit_file', tool_use_id: 'a2', tool_response: { status: 'error', error: 'denied', output: '' } });
  AMP.input({ ...base, hook_event_name: 'Stop', last_assistant_message: '## Cierre' });
  const rows = readJournal('amp', 'T-1');
  assert.deepEqual(rows.map((r) => r.event), ['tool', 'tool', 'result', 'reply', 'stop']);
  assert.deepEqual([rows[0].tool, rows[0].input, rows[1].tool, rows[1].input], ['Bash', { command: 'ls' }, 'Edit', { file_path: '/p/a.mjs' }]);
  assert.ok(rows[2].error.includes('denied'), 'a tool that ended in error says so');
  assert.deepEqual(AMP.call({ tool_name: 'whatever', tool_input: {}, command: 'git push', files: [] }), { command: 'git push' });
  assert.deepEqual(AMP.call({ tool_name: 'whatever', tool_input: {}, command: '', files: ['/p/b.mjs'] }), { files: ['/p/b.mjs'] });
  assert.deepEqual(AMP.call({ tool_name: 'Read', tool_input: { path: '/p/.env' } }), { reads: ['/p/.env'] });
  assert.equal(AMP.call({ tool_name: 'Grep', tool_input: {} }), null);
});

// ---- Amp's plugin against the real hooks ----

test('Amp plugin: the card waits for the first prompt, a read of .env is rejected, a normal edit is allowed, and a hook that cannot run never blocks', async () => {
  const repo = fs.mkdtempSync(path.join(os.homedir(), '.wm-amp-'));
  temps.push(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  write(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.writeFileSync(path.join(repo, '.env'), 'KEY=1\n');
  fs.writeFileSync(path.join(repo, 'svc.mjs'), 'export const a = 1;\n');
  const file = path.join(home, 'plugin-under-test.mjs');
  write(file, I.pluginText(SCRIPTS.replace(/\\/g, '/'), 'amp'));
  const handlers = {}, cancelled = [];
  const amp = {
    on: (event, fn) => { handlers[event] = fn; },
    helpers: {
      filePathFromURI: (u) => String(u).replace(/^file:\/\/\/?/, process.platform === 'win32' ? '' : '/'),
      shellCommandFromToolCall: (e) => (e.tool === 'Bash' ? { command: e.input.cmd } : null),
      filesModifiedByToolCall: (e) => (e.tool === 'edit_file' ? [`file:///${e.input.path.replace(/\\/g, '/').replace(/^\//, '')}`] : null),
    },
  };
  const ctx = { system: { workspaceRoot: `file:///${repo.replace(/\\/g, '/').replace(/^\//, '')}` }, thread: { cancel: () => cancelled.push(1) } };
  const thread = { id: 'T-plugin' };
  (await import(pathToFileURL(file).href)).default(amp);
  assert.deepEqual(Object.keys(handlers).sort(), ['agent.end', 'agent.start', 'session.start', 'tool.call', 'tool.result']);
  assert.equal(await handlers['session.start']({ thread }, ctx), undefined, 'session.start returns nothing: the card is held');
  const turn = await handlers['agent.start']({ thread, message: 'agrega reintentos al servicio', id: 'm1' }, ctx);
  assert.match(turn.message.content, /Waymark/, 'the card and the reminder come with the first prompt');
  assert.equal(turn.message.display, false);
  const denied = await handlers['tool.call']({ thread, toolUseID: 'u1', tool: 'Read', input: { path: path.join(repo, '.env') } }, ctx);
  assert.equal(denied.action, 'reject-and-continue');
  assert.match(denied.message, /\.env|sensitive|secret/i);
  const ok = await handlers['tool.call']({ thread, toolUseID: 'u2', tool: 'edit_file', input: { path: path.join(repo, 'svc.mjs') } }, ctx);
  assert.deepEqual(ok, { action: 'allow' });
  const rows = readJournal('amp', 'T-plugin');
  assert.ok(rows.some((r) => r.event === 'tool' && r.tool === 'Edit' && /svc\.mjs$/.test(r.input.file_path)), 'the call reached the journal through the hook');
  await handlers['tool.result']({ thread, toolUseID: 'u2', tool: 'edit_file', input: { path: path.join(repo, 'svc.mjs') }, status: 'done', output: 'ok' }, ctx);
  const next = await handlers['agent.start']({ thread, message: 'sigue', id: 'm2' }, ctx);
  assert.match(String(next?.message?.content || ''), /Waymark memory for the file you are changing/, 'the pack of the edited file rides on the next prompt');
  const end = await handlers['agent.end']({ thread, message: 'sigue', id: 'm2', status: 'done', messages: [{ role: 'assistant', content: [{ type: 'text', text: 'listo' }] }] }, ctx);
  assert.ok(end === undefined || end.action === 'continue', 'the stop hook answers or lets the turn end');
  assert.equal(cancelled.length, 0);
  const broken = path.join(home, 'plugin-broken.mjs');
  write(broken, I.pluginText(path.join(home, 'no-scripts-here').replace(/\\/g, '/'), 'amp'));
  const h2 = {};
  (await import(pathToFileURL(broken).href)).default({ ...amp, on: (e, fn) => { h2[e] = fn; } });
  assert.deepEqual(await h2['tool.call']({ thread, toolUseID: 'u3', tool: 'Bash', input: { cmd: 'ls' } }, ctx), { action: 'allow' }, 'scripts that are not there: the tool is allowed');
});
