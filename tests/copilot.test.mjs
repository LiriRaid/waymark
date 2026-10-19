// Waymark · the Copilot CLI adapter (docs/adr/0022): its hooks under Claude Code's event names, its session log as the
// turn, install-hooks and uninstall. Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME, COPILOT_HOME and hooks file; nothing reads or writes the real ones.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-copilot-t-'));
const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-copilot-h-'));
const temps = [home, copilotHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: home, COPILOT_HOME: copilotHome, WAYMARK_BACKUPS: path.join(home, 'backups'),
  WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'),
  WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'), WAYMARK_COPILOT_HOOKS: path.join(home, 'copilot-hooks.json'),
});
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
// outside the temp folder: the hooks exempt temp paths from the routine
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-copilot-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
const node = (script, args, input) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { input: JSON.stringify(input), env: process.env, encoding: 'utf8' });
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// Copilot's session log: ~/.copilot/session-state/<session>/events.jsonl, one event per line {type, data, id, timestamp}.
let seq = 0;
const logOf = (session) => path.join(copilotHome, 'session-state', session, 'events.jsonl');
const ev = (session, type, data) => { fs.mkdirSync(path.dirname(logOf(session)), { recursive: true }); fs.appendFileSync(logOf(session), JSON.stringify({ type, data, id: `e${seq++}`, timestamp: new Date().toISOString(), parentId: null }) + '\n'); };

test('copilot adapter: its session log becomes core lines (prompt, routing, skill, shell failure, edit, ask_user, chat decision); bad lines skipped', async () => {
  const co = await import(`file://${SCRIPTS}/agents/copilot.mjs`);
  const FILE = path.join(os.homedir(), 'proyecto', 'src', 'orders.mjs');
  ev('s1', 'session.start', { sessionId: 's1', copilotVersion: '1.0.54', context: { cwd: '/w' } });
  ev('s1', 'user.message', { content: 'agrega reintentos', transformedContent: '<x>agrega reintentos</x>' });
  ev('s1', 'assistant.message', { content: 'Waymark → L1 · dept-backend\n¿Cómo los hago?\n1. Backoff (Recomendado)\n2. Cola', toolRequests: [], model: 'm' });
  ev('s1', 'assistant.turn_end', { turnId: '0' });
  ev('s1', 'user.message', { content: 'Backoff' });
  ev('s1', 'tool.execution_start', { toolCallId: 't1', toolName: 'skill', arguments: { skill: 'dept-backend' } });
  ev('s1', 'tool.execution_complete', { toolCallId: 't1', success: true, result: { content: '# dept' } });
  ev('s1', 'tool.execution_start', { toolCallId: 't2', toolName: 'view', arguments: { path: 'C:/s/dept-qa/SKILL.md' } });
  ev('s1', 'tool.execution_complete', { toolCallId: 't2', success: true, result: { content: '# qa' } });
  fs.appendFileSync(logOf('s1'), '{"type":"assistant.message","data":{"content":"trunc'); // a truncated event (copilot-cli #4098)
  fs.appendFileSync(logOf('s1'), '\n');
  ev('s1', 'tool.execution_start', { toolCallId: 't3', toolName: 'powershell', arguments: { command: 'npm test' } });
  ev('s1', 'tool.execution_complete', { toolCallId: 't3', success: false, error: { message: 'exit 1' } });
  ev('s1', 'tool.execution_start', { toolCallId: 't4', toolName: 'create', arguments: { path: FILE, file_text: 'x' } });
  ev('s1', 'tool.execution_complete', { toolCallId: 't4', success: true, result: { content: 'created' } });
  ev('s1', 'tool.execution_start', { toolCallId: 't6', toolName: 'apply_patch', arguments: { input: '*** Update File: a.ts\n*** Add File: b.ts\n' } });
  ev('s1', 'tool.execution_complete', { toolCallId: 't6', success: true, result: { content: 'done' } });
  ev('s1', 'tool.execution_start', { toolCallId: 't5', toolName: 'ask_user', arguments: { question: '¿Push?', choices: ['No', 'Not now'] } });
  ev('s1', 'tool.execution_complete', { toolCallId: 't5', success: true, result: { content: 'User selected: Not now' } });
  const hook = co.input({ hook_event_name: 'Stop', session_id: 's1', cwd: '/w', stop_reason: 'end_turn', stop_hook_active: false });
  assert.equal(hook.transcript_path, logOf('s1'), 'the session log, from the session id');
  const lines = co.read(hook);
  const uses = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_use').map((c) => [c.name, c.input.file_path || c.input.command || c.input.skill || '']));
  assert.deepEqual(uses, [['AskUserQuestion', ''], ['Skill', 'dept-backend'], ['Skill', 'dept-qa'], ['Read', 'C:/s/dept-qa/SKILL.md'], ['Bash', 'npm test'], ['Edit', FILE], ['Edit', path.resolve('/w', 'a.ts')], ['Edit', path.resolve('/w', 'b.ts')], ['AskUserQuestion', '']]);
  assert.deepEqual(P.decisionsIn(lines).map((d) => d.chosen), ['Backoff', 'Not now'], 'the question that ended the turn, answered by the next prompt; then ask_user');
  assert.ok(lines.some((l) => l.message?.content?.some?.((c) => c.type === 'tool_result' && c.is_error && /exit 1/.test(c.content))), 'a failed tool is an error result');
  assert.equal(lines.filter((l) => l.type === 'user' && typeof l.message?.content === 'string').length, 2, 'two prompts, as typed');
  assert.ok(lines.some((l) => l.type === 'assistant' && l.message.content.some((c) => c.type === 'text' && /^Waymark → L1/.test(c.text))), 'the reply text');
  assert.deepEqual(co.sessions('/w'), [logOf('s1')], 'the session logs of that folder');
  assert.deepEqual(co.sessions('/otra'), []);
});

test('copilot adapter: payload, tool calls and answers', async () => {
  const co = await import(`file://${SCRIPTS}/agents/copilot.mjs`);
  const h = co.input({ hook_event_name: 'PreToolUse', session_id: 's2', cwd: '/w', tool_name: 'Edit', tool_input: '{"path":"a.ts"}' });
  assert.deepEqual([h.session_id, h.cwd, h.hook_event_name, h.tool_input], ['s2', '/w', 'PreToolUse', { path: 'a.ts' }], 'tool_input given as a JSON string is parsed');
  assert.equal(co.input({ sessionId: 's3', cwd: '/w', toolName: 'bash', toolArgs: { command: 'ls' } }).tool_name, 'bash', 'the camelCase payload too');
  assert.equal(co.input({ session_id: 's3', cwd: '/w', tool_name: 'Bash', tool_input: {}, tool_result: {} }).hook_event_name, 'PostToolUse', 'no event name: inferred from the fields');
  assert.deepEqual([co.call({ tool_name: 'Bash', tool_input: { command: 'ls' } }), co.call({ tool_name: 'powershell', tool_input: { command: 'dir' } }),
    co.call({ tool_name: 'Edit', tool_input: { path: 'a.ts' } }), co.call({ tool_name: 'Write', tool_input: { file_path: 'b.ts' } }),
    co.call({ tool_name: 'apply_patch', tool_input: { input: '*** Update File: c.ts\n' }, cwd: '/w' }), co.call({ tool_name: 'Read', tool_input: { path: 'a.ts' } })],
  [{ command: 'ls' }, { command: 'dir' }, { files: ['a.ts'] }, { files: ['b.ts'] }, { files: [path.resolve('/w', 'c.ts')] }, null]);
  assert.deepEqual(co.out.context('SessionStart', 'x').additionalContext, 'x');
  assert.deepEqual([co.out.deny('r').permissionDecision, co.out.deny('r').permissionDecisionReason], ['deny', 'r']);
  assert.deepEqual(co.out.block('r'), { decision: 'block', reason: 'r' });
  assert.equal(co.out.blockPrompt, undefined, 'a command hook\'s UserPromptSubmit output is dropped: no prompt brake');
  assert.equal(co.preContext, false);
});

test('copilot hooks end to end: the card brings the context, a missing Cierre blocks the stop, the record says copilot', () => {
  const repo = withMemory(repoAt('e2e'));
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const base = { session_id: 'c2', cwd: repo, timestamp: new Date().toISOString() };
  ev('c2', 'session.start', { sessionId: 'c2', context: { cwd: repo } });
  const card = json(node('session-hook.mjs', ['--agent', 'copilot'], { ...base, hook_event_name: 'SessionStart', source: 'new' }).stdout);
  assert.match(card?.additionalContext || '', /Waymark context card/, 'the card, as additionalContext');
  ev('c2', 'user.message', { content: 'agrega reintentos al servicio' });
  node('rule0-hook.mjs', ['--agent', 'copilot'], { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'agrega reintentos al servicio' });
  ev('c2', 'assistant.message', { content: 'Waymark → L1 · dept-backend', toolRequests: [] });
  fs.writeFileSync(path.join(repo, 'svc.mjs'), 'export const retry = 3;\n');
  const blocked = json(node('stop-hook.mjs', ['--agent', 'copilot'], { ...base, hook_event_name: 'Stop', stop_reason: 'end_turn', stop_hook_active: false }).stdout);
  assert.equal(blocked?.decision, 'block', `no Cierre: the stop is blocked (${JSON.stringify(blocked)})`);
  ev('c2', 'assistant.message', { content: `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada el servicio responde\nAprendido: "backoff ← timeouts"`, toolRequests: [] });
  node('stop-hook.mjs', ['--agent', 'copilot'], { ...base, hook_event_name: 'Stop', stop_reason: 'end_turn', stop_hook_active: true });
  const rec = P.readRecords(P.projectHome(repo).log).pop();
  assert.equal(rec?.agent, 'copilot');
});

test('install-hooks --agent copilot: ~/.copilot/hooks/waymark.json, version 1, flat entries under Claude Code\'s event names; idempotent; uninstall removes them', async () => {
  const { planHooks, registered } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const { settings, steps } = planHooks({}, { scripts: '/s/waymark/scripts', agent: 'copilot' });
  assert.equal(settings.version, 1);
  assert.deepEqual(Object.keys(settings.hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'PostToolUse']);
  assert.equal(settings.hooks.PreToolUse[0].command, 'node "/s/waymark/scripts/hook-run.cjs" "/s/waymark/scripts/tool-hook.mjs" --agent copilot');
  assert.match(settings.hooks.PreToolUse[0].matcher, /^Bash\|PowerShell\|Edit\|Write\b/);
  assert.equal(steps.length, 5);
  assert.deepEqual(planHooks(settings, { scripts: '/s/waymark/scripts', agent: 'copilot' }).steps, [], 'idempotent');
  write(process.env.WAYMARK_COPILOT_HOOKS, JSON.stringify(settings));
  assert.ok(registered().some((r) => r.agent === 'copilot' && r.commands.length === 4), JSON.stringify(registered()));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'uninstall.mjs'), '--apply'], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(process.env.WAYMARK_COPILOT_HOOKS), 'hooks/waymark.json was Waymark\'s whole file: removed');
});
