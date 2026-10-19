// Waymark · the Antigravity adapter (docs/adr/0022): its named hooks in ~/.gemini/config/hooks.json, injectSteps and
// decisions as answers, the journal of its hooks as the turn, install-hooks and uninstall. Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME and hooks file; nothing reads or writes the real ones.
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-ag-t-'));
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: home, WAYMARK_BACKUPS: path.join(home, 'backups'),
  WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'),
  WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'), WAYMARK_ANTIGRAVITY_HOOKS: path.join(home, 'ag-hooks.json'),
});
const P = await import(pathToFileURL(path.join(SCRIPTS, 'provenance.mjs')));
const url = (f) => pathToFileURL(path.join(SCRIPTS, f)).href;

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
// outside the temp folder: the hooks exempt temp paths from the routine
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-ag-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
// A hook as Antigravity runs it: `node <script> --agent antigravity --event <core event>`, the camelCase payload on stdin.
const hookRun = (script, event, input) => spawnSync(process.execPath, [path.join(SCRIPTS, script), '--agent', 'antigravity', '--event', event], { input: JSON.stringify(input), env: process.env, encoding: 'utf8' });
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
// input() reads the event from the command line, as the installed hook gives it
const withEvent = (event, fn) => { const argv = process.argv; process.argv = [...argv, '--event', event]; try { return fn(); } finally { process.argv = argv; } };

test('antigravity adapter: each hook is journaled and the journal becomes core lines (invocation, skill read, shell, edit, ask_question)', async () => {
  const ag = await import(url('agents/antigravity.mjs'));
  const FILE = path.join(os.homedir(), 'proyecto', 'src', 'orders.mjs');
  const common = { conversationId: 'a1', workspacePaths: ['/w'], transcriptPath: '/x/transcript.jsonl', artifactDirectoryPath: '/x', modelName: 'm' };
  const at = (event, extra) => withEvent(event, () => ag.input({ ...common, ...extra }));
  at('UserPromptSubmit', { invocationNum: 1, initialNumSteps: 0 });
  at('PreToolUse', { toolCall: { name: 'view_file', args: { AbsolutePath: 'C:/s/dept-backend/SKILL.md' } }, stepIdx: 1 });
  at('PostToolUse', { toolCall: { name: 'view_file', args: {} }, stepIdx: 1 });
  at('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'npm test', Cwd: '/w' } }, stepIdx: 2 });
  at('PostToolUse', { toolCall: { name: 'run_command', args: {} }, stepIdx: 2, error: 'exit status 1' });
  at('PreToolUse', { toolCall: { name: 'ask_question', args: { question: '¿Cómo los hago?', options: ['Backoff', 'Cola'] } }, stepIdx: 3 });
  at('PostToolUse', { toolCall: { name: 'ask_question', args: {} }, stepIdx: 3 });
  at('PreToolUse', { toolCall: { name: 'write_to_file', args: { TargetFile: FILE, CodeContent: 'x' } }, stepIdx: 4 });
  at('PostToolUse', { toolCall: { name: 'write_to_file', args: {} }, stepIdx: 4, error: '' });
  const hook = at('Stop', { executionNum: 1, terminationReason: 'done', fullyIdle: true });
  assert.deepEqual([hook.session_id, hook.cwd, hook.hook_event_name], ['a1', '/w', 'Stop']);
  assert.equal(hook.transcript_path, path.join(home, 'antigravity', 'a1.jsonl'), 'the journal, from the conversation id');
  const lines = ag.read(hook);
  const uses = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_use').map((c) => [c.name, c.input.file_path || c.input.command || c.input.skill || '']));
  assert.deepEqual(uses, [['Skill', 'dept-backend'], ['Read', 'C:/s/dept-backend/SKILL.md'], ['Bash', 'npm test'], ['AskUserQuestion', ''], ['Edit', FILE]]);
  const results = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_result'));
  assert.deepEqual(results.map((r) => !!r.is_error), [false, true, false, false], 'a tool with an error is an error result; an empty error is a success');
  assert.equal(P.decisionsIn(lines).length, 1, 'ask_question answered counts as the choice window, though the hook does not carry the answer');
  assert.equal(lines.filter((l) => l.type === 'user' && typeof l.message?.content === 'string').length, 1, 'the invocation stands for the prompt');
  assert.deepEqual(ag.sessions('/w'), [hook.transcript_path]);
  assert.equal(at('Stop', { fullyIdle: true }).stop_hook_active, true, 'a second stop in the same invocation: the stop hook already blocked once');
  at('UserPromptSubmit', { invocationNum: 2, initialNumSteps: 5 });
  assert.equal(at('Stop', { executionNum: 1, fullyIdle: true }).stop_hook_active, true, 'a "continue" that opened a new invocation keeps its executionNum');
  at('PreToolUse', { toolCall: { name: 'run_command', args: { CommandLine: 'npm run build' } }, stepIdx: 3 }); // the step id of the earlier question
  at('PostToolUse', { toolCall: { name: 'run_command', args: {} }, stepIdx: 3 });
  assert.equal(P.decisionsIn(ag.read(hook)).length, 1, 'a step id reused in a later turn is a new call, not another answer');
});

test('antigravity adapter: tool calls and answers', async () => {
  const ag = await import(url('agents/antigravity.mjs'));
  assert.deepEqual([ag.call({ tool_name: 'run_command', tool_input: { CommandLine: 'ls' } }), ag.call({ tool_name: 'write_to_file', tool_input: { TargetFile: 'a.ts' } }),
    ag.call({ tool_name: 'replace_file_content', tool_input: { TargetFile: 'b.ts' } }), ag.call({ tool_name: 'multi_replace_file_content', tool_input: { TargetFile: 'c.ts' } }),
    ag.call({ tool_name: 'view_file', tool_input: { AbsolutePath: 'a.ts' } })],
  [{ command: 'ls' }, { files: ['a.ts'] }, { files: ['b.ts'] }, { files: ['c.ts'] }, null]);
  assert.deepEqual(ag.out.context('SessionStart', 'x'), { injectSteps: [{ ephemeralMessage: 'x' }] });
  assert.deepEqual(ag.out.context('PreToolUse', 'x'), { decision: 'allow', reason: 'x' }, 'PreToolUse has no context field: the pack goes as the reason of an allow');
  assert.deepEqual(ag.out.deny('r'), { decision: 'deny', reason: 'r' });
  assert.deepEqual(ag.out.block('r'), { decision: 'continue', reason: 'r' });
  assert.deepEqual([ag.out.pass('PreToolUse'), ag.out.pass('PostToolUse')], [{ decision: 'allow' }, {}]);
  assert.equal(ag.preContext, true);
  assert.deepEqual(ag.lacks, ['cierre', 'evidence'], 'no hook carries the reply: the Cierre and its Evidencia are invisible');
});

test('antigravity hooks end to end: the card as an injected step, the record says antigravity', () => {
  const repo = withMemory(repoAt('e2e'));
  const base = { conversationId: 'a3', workspacePaths: [repo], transcriptPath: '', modelName: 'm' };
  const card = json(hookRun('session-hook.mjs', 'SessionStart', base).stdout);
  assert.match(card?.injectSteps?.[0]?.ephemeralMessage || '', /Waymark context card/);
  const reminder = json(hookRun('rule0-hook.mjs', 'UserPromptSubmit', { ...base, invocationNum: 1, initialNumSteps: 0 }).stdout);
  assert.match(reminder?.injectSteps?.[0]?.ephemeralMessage || '', /Waymark Rule 0/);
  const pre = json(hookRun('tool-hook.mjs', 'PreToolUse', { ...base, toolCall: { name: 'write_to_file', args: { TargetFile: path.join(repo, 'svc.mjs') } }, stepIdx: 1 }).stdout);
  assert.equal(pre?.decision, 'allow', JSON.stringify(pre));
  fs.writeFileSync(path.join(repo, 'svc.mjs'), 'export const retry = 3;\n');
  hookRun('tool-hook.mjs', 'PostToolUse', { ...base, toolCall: { name: 'write_to_file', args: {} }, stepIdx: 1 });
  const blocked = json(hookRun('stop-hook.mjs', 'Stop', { ...base, executionNum: 1, terminationReason: 'done', fullyIdle: true }).stdout);
  assert.equal(blocked?.decision, 'continue', `a gap re-enters the loop once (${JSON.stringify(blocked)})`);
  const stop = hookRun('stop-hook.mjs', 'Stop', { ...base, executionNum: 1, terminationReason: 'done', fullyIdle: true });
  assert.equal(stop.status, 0, stop.stderr);
  assert.notEqual(json(stop.stdout)?.decision, 'continue', 'the second stop goes through');
  const rec = P.readRecords(P.projectHome(repo).log).pop();
  assert.equal(rec?.agent, 'antigravity', JSON.stringify(rec));
});

test('install-hooks --agent antigravity: a "waymark" hook in ~/.gemini/config/hooks.json with --event; idempotent; uninstall removes it', async () => {
  const { planHooks, registered } = await import(url('install-hooks.mjs'));
  const { settings, steps } = planHooks({}, { scripts: '/s/waymark/scripts', agent: 'antigravity' });
  assert.deepEqual(Object.keys(settings.waymark), ['SessionStart', 'PreInvocation', 'PreToolUse', 'Stop', 'PostToolUse']);
  assert.deepEqual(settings.waymark.PreToolUse, [{ matcher: '*', hooks: [{ type: 'command', command: 'node "/s/waymark/scripts/hook-run.cjs" "/s/waymark/scripts/tool-hook.mjs" --agent antigravity --event PreToolUse' }] }]);
  assert.equal(settings.waymark.PreInvocation[0].command, 'node "/s/waymark/scripts/hook-run.cjs" "/s/waymark/scripts/rule0-hook.mjs" --agent antigravity --event UserPromptSubmit');
  assert.equal(settings.waymark.Stop[0].timeout, 60, 'the end-of-turn hook gets more than the default 30 s');
  assert.equal(steps.length, 5);
  assert.deepEqual(planHooks(settings, { scripts: '/s/waymark/scripts', agent: 'antigravity' }).steps, [], 'idempotent');
  const lint = { PostToolUse: [{ matcher: 'write_to_file', hooks: [{ type: 'command', command: './lint.sh' }] }] };
  const both = planHooks({ lint }, { scripts: '/s/waymark/scripts', agent: 'antigravity' }).settings;
  assert.deepEqual(both.lint, lint, 'the user\'s hooks stay');
  assert.deepEqual(planHooks({ draft: { enabled: false } }, { scripts: '/s/waymark/scripts', agent: 'antigravity' }).settings.draft, { enabled: false }, 'a hook of the user\'s with no events stays too');
  write(process.env.WAYMARK_ANTIGRAVITY_HOOKS, JSON.stringify(both));
  assert.ok(registered().some((r) => r.agent === 'antigravity' && r.commands.length === 5), JSON.stringify(registered()));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'uninstall.mjs'), '--apply'], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(json(fs.readFileSync(process.env.WAYMARK_ANTIGRAVITY_HOOKS, 'utf8')), { lint }, 'only Waymark\'s hook goes');
});
