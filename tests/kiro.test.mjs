// Waymark · the Kiro adapter (docs/adr/0022): its hooks file of its own shape, plain-text answers and exit codes, the
// journal of its hooks as the turn, install-hooks and uninstall. Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME, KIRO_HOME and hooks file; nothing reads or writes the real ones.
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-kiro-t-'));
const kiroHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-kiro-h-'));
const temps = [home, kiroHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: home, KIRO_HOME: kiroHome, WAYMARK_BACKUPS: path.join(home, 'backups'),
  WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'),
  WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'), WAYMARK_KIRO_HOOKS: path.join(home, 'kiro-hooks.json'),
});
const P = await import(pathToFileURL(path.join(SCRIPTS, 'provenance.mjs')));
const url = (f) => pathToFileURL(path.join(SCRIPTS, f)).href;

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
// outside the temp folder: the hooks exempt temp paths from the routine
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-kiro-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
// A hook as Kiro runs it: `node <script> --agent kiro --event <event>`, the payload on stdin.
const hookRun = (script, event, input) => spawnSync(process.execPath, [path.join(SCRIPTS, script), '--agent', 'kiro', '--event', event], { input: JSON.stringify(input), env: process.env, encoding: 'utf8' });
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('kiro adapter: each hook is journaled and the journal becomes core lines (prompt, skill read, shell, edit, failed tool)', async () => {
  const kiro = await import(url('agents/kiro.mjs'));
  const FILE = path.join(os.homedir(), 'proyecto', 'src', 'orders.mjs');
  const at = (event, extra) => kiro.input({ hook_event_name: event, cwd: '/w', session_id: 'k1', ...extra });
  at('UserPromptSubmit', { prompt: 'agrega reintentos' });
  at('PreToolUse', { tool_name: 'fs_read', tool_input: { operations: [{ mode: 'Line', path: 'C:/s/dept-backend/SKILL.md' }] } });
  at('PostToolUse', { tool_name: 'fs_read', tool_input: {}, tool_response: { success: true, result: ['# dept'] } });
  at('PreToolUse', { tool_name: 'execute_bash', tool_input: { command: 'npm test' } });
  at('PostToolUse', { tool_name: 'execute_bash', tool_input: { command: 'npm test' }, tool_response: { exit_status: '1', stdout: '1 failing' } });
  at('PreToolUse', { tool_name: 'fs_write', tool_input: { command: 'create', path: FILE, file_text: 'x' } });
  at('PostToolUse', { tool_name: 'fs_write', tool_input: { path: FILE }, tool_response: { success: true } });
  const hook = at('Stop', {});
  assert.equal(hook.transcript_path, path.join(home, 'kiro', 'k1.jsonl'), 'the journal, from the session id');
  assert.equal(hook.hook_event_name, 'Stop');
  const lines = kiro.read(hook);
  const uses = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_use').map((c) => [c.name, c.input.file_path || c.input.command || c.input.skill || '']));
  assert.deepEqual(uses, [['Skill', 'dept-backend'], ['Read', 'C:/s/dept-backend/SKILL.md'], ['Bash', 'npm test'], ['Edit', FILE]]);
  const results = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_result'));
  assert.deepEqual(results.map((r) => !!r.is_error), [false, true, false], 'a non-zero exit status is an error result, each result paired with its call');
  assert.equal(lines.filter((l) => l.type === 'user' && typeof l.message?.content === 'string').length, 1, 'one prompt, as typed');
  assert.deepEqual(kiro.sessions('/w'), [hook.transcript_path], 'the journals of that folder');
  assert.deepEqual(kiro.sessions('/otra'), []);
  assert.equal(at('Stop', {}).stop_hook_active, true, 'a second stop with no prompt between: the stop hook already blocked once');
  assert.equal(at('UserPromptSubmit', { prompt: 'otra' }) && at('Stop', {}).stop_hook_active, false, 'a new prompt resets it');
});

test('kiro adapter: payload, tool calls and answers', async () => {
  const kiro = await import(url('agents/kiro.mjs'));
  const argv = process.argv;
  try {
    process.argv = [...argv, '--event', 'PostToolUse'];
    assert.equal(kiro.input({ cwd: '/w', session_id: 'k2', tool_name: 'execute_bash', tool_input: {} }).hook_event_name, 'PostToolUse', 'the event on the command line wins');
  } finally { process.argv = argv; }
  assert.equal(kiro.input({ hook_event_name: 'agentSpawn', cwd: '/w', session_id: 'k2' }).hook_event_name, 'SessionStart', 'CLI 2.x names too');
  process.env.USER_PROMPT = 'desde el IDE';
  try { assert.equal(kiro.input({ hook_event_name: 'UserPromptSubmit', cwd: '/w', session_id: 'k2' }).prompt, 'desde el IDE', 'the IDE gives the prompt as USER_PROMPT'); } finally { delete process.env.USER_PROMPT; }
  assert.deepEqual([kiro.call({ tool_name: 'execute_bash', tool_input: { command: 'ls' } }), kiro.call({ tool_name: 'shell', tool_input: { command: 'dir' } }),
    kiro.call({ tool_name: 'fs_write', tool_input: { path: 'a.ts' } }), kiro.call({ tool_name: 'strReplace', tool_input: { path: 'b.ts' } }),
    kiro.call({ tool_name: 'fs_read', tool_input: { path: 'a.ts' } })],
  [{ command: 'ls' }, { command: 'dir' }, { files: ['a.ts'] }, { files: ['b.ts'] }, null]);
  assert.deepEqual(kiro.out.context('SessionStart', 'x'), { text: 'x' });
  assert.deepEqual(kiro.out.deny('r'), { stderr: 'r', exit: 2 });
  assert.deepEqual(json(kiro.out.block('r').text), { decision: 'block', reason: 'r' });
  assert.equal(kiro.out.blockPrompt, undefined, 'UserPromptSubmit blocking is documented both ways: no prompt brake');
  assert.deepEqual(kiro.lacks, ['cierre', 'evidence', 'decision'], 'no hook carries the reply: the Cierre, its Evidencia and a question in the chat are invisible');
  // answer(): plain text on stdout, a denial as stderr with exit code 2, every other agent's answer as JSON
  const answer = (agent, out) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `const { answer, AGENTS } = await import(${JSON.stringify(url('agents/index.mjs'))}); answer(AGENTS[${JSON.stringify(agent)}], ${JSON.stringify(out)});`], { encoding: 'utf8' });
  const text = answer('kiro', kiro.out.context('PostToolUse', 'el pack'));
  assert.deepEqual([text.stdout, text.status], ['el pack', 0]);
  const deny = answer('kiro', kiro.out.deny('pregunta primero'));
  assert.deepEqual([deny.stdout, deny.stderr, deny.status], ['', 'pregunta primero', 2]);
  assert.deepEqual(json(answer('claude', { decision: 'block', reason: 'r' }).stdout), { decision: 'block', reason: 'r' });
});

test('kiro hooks end to end: the card and the reminder as plain text, the record says kiro', () => {
  const repo = withMemory(repoAt('e2e'));
  const base = { session_id: 'k3', cwd: repo };
  const card = hookRun('session-hook.mjs', 'SessionStart', { ...base, hook_event_name: 'SessionStart' });
  assert.match(card.stdout, /^Waymark context card/, 'the card as plain text (exit 0 adds stdout to the context)');
  assert.equal(json(card.stdout), null);
  const reminder = hookRun('rule0-hook.mjs', 'UserPromptSubmit', { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'agrega reintentos al servicio' });
  assert.match(reminder.stdout, /Waymark Rule 0/);
  hookRun('tool-hook.mjs', 'PreToolUse', { ...base, hook_event_name: 'PreToolUse', tool_name: 'fs_write', tool_input: { command: 'create', path: path.join(repo, 'svc.mjs') } });
  fs.writeFileSync(path.join(repo, 'svc.mjs'), 'export const retry = 3;\n');
  hookRun('tool-hook.mjs', 'PostToolUse', { ...base, hook_event_name: 'PostToolUse', tool_name: 'fs_write', tool_input: { path: path.join(repo, 'svc.mjs') }, tool_response: { success: true } });
  const blocked = hookRun('stop-hook.mjs', 'Stop', { ...base, hook_event_name: 'Stop' });
  assert.equal(json(blocked.stdout)?.decision, 'block', `a gap blocks the stop once, as Stop's JSON (${blocked.stdout})`);
  const stop = hookRun('stop-hook.mjs', 'Stop', { ...base, hook_event_name: 'Stop' });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout, '', 'the second stop goes through: the journal shows a stop already answered');
  const rec = P.readRecords(P.projectHome(repo).log).pop();
  assert.equal(rec?.agent, 'kiro', JSON.stringify(rec));
});

test('install-hooks --agent kiro: ~/.kiro/hooks/waymark.json, version v1, one hook per trigger with --event; idempotent; uninstall removes the file', async () => {
  const { planHooks, registered } = await import(url('install-hooks.mjs'));
  const { settings, steps } = planHooks({}, { scripts: '/s/waymark/scripts', agent: 'kiro' });
  assert.equal(settings.version, 'v1');
  assert.deepEqual(settings.hooks.map((h) => h.trigger), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'PostToolUse']);
  const pre = settings.hooks.find((h) => h.trigger === 'PreToolUse');
  assert.deepEqual(pre.action, { type: 'command', command: 'node "/s/waymark/scripts/hook-run.cjs" "/s/waymark/scripts/tool-hook.mjs" --agent kiro --event PreToolUse' });
  assert.equal(pre.matcher, undefined, 'every tool: the journal keeps reads too');
  assert.equal(steps.length, 5);
  assert.deepEqual(planHooks(settings, { scripts: '/s/waymark/scripts', agent: 'kiro' }).steps, [], 'idempotent');
  const mine = { name: 'lint', trigger: 'PostFileSave', action: { type: 'command', command: 'npm run lint' } };
  const kept = planHooks({ version: 'v1', hooks: [mine] }, { scripts: '/s/waymark/scripts', agent: 'kiro' }).settings;
  assert.deepEqual(kept.hooks[0], mine, 'the user\'s hooks stay, first');
  write(process.env.WAYMARK_KIRO_HOOKS, JSON.stringify(settings));
  assert.ok(registered().some((r) => r.agent === 'kiro' && r.commands.length === 5), JSON.stringify(registered()));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'uninstall.mjs'), '--apply'], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(process.env.WAYMARK_KIRO_HOOKS), 'hooks/waymark.json was Waymark\'s whole file: removed');
});
