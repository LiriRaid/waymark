// Waymark 2.0.3 · point 4: every agent on the machine with one install (Cursor, unknown agents, check, plugin, paths,
// backups, project skills, uninstall). Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME, agents home and settings files; nothing reads or writes the real ones.
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-agents-t-'));
const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-agents-h-'));
const temps = [home, agentsHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
for (const k of ['CODEX_HOME', 'GEMINI_CLI_HOME', 'CURSOR_CONFIG_DIR', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CURSOR_VERSION']) delete process.env[k];
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: agentsHome, WAYMARK_BACKUPS: path.join(home, 'backups'),
  WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'),
  WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'), WAYMARK_CODEX_HOOKS: path.join(home, 'codex-hooks.json'),
  WAYMARK_GEMINI_SETTINGS: path.join(home, 'gemini-settings.json'), WAYMARK_OPENCODE_PLUGIN: path.join(home, 'opencode-plugin.js'),
  WAYMARK_CURSOR_HOOKS: path.join(home, 'cursor-hooks.json'),
});
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
// outside the temp folder: the hooks exempt temp paths from the routine
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-agents-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
const node = (script, args, input, env = {}) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { input: JSON.stringify(input), env: { ...process.env, ...env }, encoding: 'utf8' });
const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('plugin: plugin.json and the CHANGELOG\'s newest section carry VERSION; a skill invoked as waymark:dept-qa counts as dept-qa', () => {
  const version = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim();
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version, version);
  assert.equal(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## (\S+)/m)?.[1], version, 'CHANGELOG.md opens with the VERSION');
  const lines = [{ type: 'user', uuid: 'p1', message: { role: 'user', content: 'escribe tests' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L2 · dept-qa' }, { type: 'tool_use', id: 's1', name: 'Skill', input: { skill: 'waymark:dept-qa', args: 'L2' } }] } }];
  const turn = T.currentTurn(lines);
  assert.equal(turn.tools[0].input.skill, 'dept-qa');
  assert.equal(T.routedDept(turn.texts, turn.tools), 'dept-qa');
  assert.equal(T.routedLevel(turn.texts, turn.tools), 2);
  assert.equal(T.sessionTools(lines)[0].input.skill, 'dept-qa');
  assert.equal(T.routedDept([], [{ name: 'Skill', input: { skill: 'waymark:dept-data', args: 'L1' } }]), 'dept-data', 'a re-route through the plugin name');
});

test('paths: CLAUDE_CONFIG_DIR, XDG_CONFIG_HOME, CURSOR_CONFIG_DIR, CODEX_HOME and GEMINI_CLI_HOME are where the agents live', () => {
  const at = (...p) => path.join(home, 'env', ...p);
  write(at('claude', 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), 's.jsonl'), '{}\n');
  write(at('claude', '.claude.json'), JSON.stringify({ mcpServers: { fromClaude: {} } }));
  write(at('codex', 'config.toml'), '[mcp_servers.fromCodex]\ncommand = "x"\n');
  write(at('gemini', 'settings.json'), JSON.stringify({ mcpServers: { fromGemini: {} } }));
  write(at('xdg', 'opencode', 'opencode.jsonc'), '// mine\n{ "mcp": { "fromOpencode": {} } /* end */ }\n');
  write(at('cursor', 'mcp.json'), JSON.stringify({ mcpServers: { fromCursor: {} } }));
  const code = `
    const ih = await import(${JSON.stringify(`file://${SCRIPTS}/install-hooks.mjs`)});
    const ca = await import(${JSON.stringify(`file://${SCRIPTS}/connect-agents.mjs`)});
    const cl = await import(${JSON.stringify(`file://${SCRIPTS}/agents/claude.mjs`)});
    const oc = await import(${JSON.stringify(`file://${SCRIPTS}/agents/opencode.mjs`)});
    const sy = await import(${JSON.stringify(`file://${SCRIPTS}/agents/paths.mjs`)});
    console.log(JSON.stringify({ plugin: ih.PLUGIN(), claude: ih.settingsFile('claude'), cursor: ih.settingsFile('cursor'), agents: ca.AGENTS().map((a) => [a.name, a.dir]),
      claudeMd: cl.instructions, sessions: cl.sessions(process.cwd()).length, opencodeMd: oc.instructions, mcp: [...sy.discoverMcp()].sort() }));`;
  const env = { ...process.env, CLAUDE_CONFIG_DIR: at('claude'), XDG_CONFIG_HOME: at('xdg'), CURSOR_CONFIG_DIR: at('cursor'), CODEX_HOME: at('codex'), GEMINI_CLI_HOME: at('gemini') };
  for (const k of ['WAYMARK_CLAUDE_SETTINGS', 'WAYMARK_OPENCODE_PLUGIN', 'WAYMARK_CURSOR_HOOKS', 'WAYMARK_CLAUDE_PROJECTS', 'WAYMARK_CLAUDE_JSON']) delete env[k];
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8', cwd: process.cwd() });
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(o.plugin, at('xdg', 'opencode', 'plugins', 'waymark.js'));
  assert.equal(o.claude, at('claude', 'settings.json'));
  assert.equal(o.cursor, at('cursor', 'hooks.json'));
  const dirs = Object.fromEntries(o.agents);
  assert.deepEqual({ Codex: dirs.Codex, 'Gemini CLI': dirs['Gemini CLI'], OpenCode: dirs.OpenCode, Cursor: dirs.Cursor }, { Codex: at('codex'), 'Gemini CLI': at('gemini'), OpenCode: at('xdg', 'opencode'), Cursor: at('cursor') });
  assert.equal(dirs.Antigravity, path.join(agentsHome, '.gemini'), 'GEMINI_CLI_HOME moves Gemini CLI only; Antigravity documents no variable');
  assert.equal(o.claudeMd, at('claude', 'CLAUDE.md'));
  assert.equal(o.sessions, 1, 'transcripts under CLAUDE_CONFIG_DIR/projects');
  assert.equal(o.opencodeMd, at('xdg', 'opencode', 'AGENTS.md'));
  assert.deepEqual(o.mcp, ['fromClaude', 'fromCodex', 'fromCursor', 'fromGemini', 'fromOpencode']);
});

test('temp folders: the OS temp dir (TMPDIR on macOS) is exempt from the decision gate', async () => {
  const { checkDecision } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const fake = fs.mkdtempSync(path.join(os.homedir(), '.wm-agents-tmp-'));
  temps.push(fake);
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  Object.assign(process.env, { TEMP: fake, TMP: fake, TMPDIR: fake });
  try {
    const lines = [{ type: 'user', uuid: 'tp1', message: { role: 'user', content: 'cambia el servicio' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-backend' }] } }];
    const state = path.join(home, 'gate-tmp.json');
    assert.equal(checkDecision(path.join(fake, 'scratch.mjs'), lines, 'tmp1', state), null, 'a file in the OS temp dir needs no decision');
    assert.ok(checkDecision(path.join(os.homedir(), 'proyecto', 'src', 'a.mjs'), lines, 'tmp1', state, path.join(os.homedir(), 'proyecto')), 'a project file still does');
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test('backups and project skills: skill-links backs up into ~/.waymark-backups; a project skill versioned in git stays in .claude/skills and check reports it', async () => {
  const { linkProjectSkills } = await import(`file://${SCRIPTS}/skill-links.mjs`);
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const repo = withMemory(repoAt('skills'));
  write(path.join(repo, '.claude', 'skills', 'tracked', 'SKILL.md'), '---\nname: tracked\n---\n');
  gitT(repo, 'add', '.claude/skills/tracked/SKILL.md');
  gitT(repo, 'commit', '-qm', 'skill');
  write(path.join(repo, '.claude', 'skills', 'loose', 'SKILL.md'), '---\nname: loose\n---\nold\n');
  write(path.join(repo, '.agents', 'skills', 'loose', 'SKILL.md'), '---\nname: loose\n---\nnew\n');
  fs.utimesSync(path.join(repo, '.claude', 'skills', 'loose', 'SKILL.md'), new Date(2020, 0, 1), new Date(2020, 0, 1));
  const done = linkProjectSkills(repo, { claude: true });
  assert.ok(!fs.lstatSync(path.join(repo, '.claude', 'skills', 'tracked')).isSymbolicLink(), 'versioned: never moved');
  assert.ok(!fs.existsSync(path.join(repo, '.agents', 'skills', 'tracked')));
  assert.ok(!done.some((d) => d.startsWith('tracked')), 'the session card says nothing about it');
  assert.ok(fs.lstatSync(path.join(repo, '.claude', 'skills', 'loose')).isSymbolicLink(), 'a loose copy becomes a link');
  const bk = path.join(home, 'backups');
  assert.ok(fs.readdirSync(bk).some((d) => /skills/.test(d)), `the replaced copy goes to WAYMARK_BACKUPS (~/.waymark-backups): ${fs.readdirSync(bk)}`);
  const items = await check(repo);
  assert.ok(items.some((t) => /^project skills: .*tracked.*git/.test(t)), items.join('\n'));
});

test('check: each agent on the machine without Waymark hooks is offered install-hooks, Claude Code included; none in guest mode', async () => {
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const repo = withMemory(repoAt('check'));
  fs.mkdirSync(path.join(agentsHome, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(agentsHome, '.cursor'), { recursive: true });
  write(process.env.WAYMARK_CLAUDE_SETTINGS, JSON.stringify({ model: 'x' }));
  const line = (items) => items.find((t) => /^hooks: .*without Waymark's hooks/.test(t)) || '';
  const before = line(await check(repo));
  assert.match(before, /Claude Code \(--agent claude\)/, before);
  assert.match(before, /Cursor \(--agent cursor\)/, before);
  assert.match(before, /install-hooks\.mjs/);
  const cmd = (f, a = '') => `node "/x/waymark/scripts/${f}"${a}`;
  write(process.env.WAYMARK_CLAUDE_SETTINGS, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd('stop-hook.mjs') }] }] } }));
  write(process.env.WAYMARK_CURSOR_HOOKS, JSON.stringify({ version: 1, hooks: { stop: [{ command: cmd('stop-hook.mjs', ' --agent cursor') }] } }));
  assert.equal(line(await check(repo)), '', 'both have the hooks now');
  write(process.env.WAYMARK_CURSOR_HOOKS, '{}');
  write(path.join(home, 'coexistence.md'), 'Mode: guest\nFrameworks: acme-orch\n');
  assert.equal(line(await check(repo)), '', 'guest: the orchestrator owns the hooks');
  fs.rmSync(path.join(home, 'coexistence.md'));
  fs.rmSync(path.join(agentsHome, '.claude'), { recursive: true });
  fs.rmSync(path.join(agentsHome, '.cursor'), { recursive: true });
});

test('instructions block: the "no card, no hook line" alarm only applies to an agent whose hooks run Waymark', () => {
  const block = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'instructions.md'), 'utf8');
  assert.match(block, /Hooks installed but no card and no hook line → they are not running/);
  assert.ok(block.length <= 6500, `the block stays within its size (${block.length})`);
});

// Cursor's hook payloads as cursor.com/docs/hooks documents them (checked 2026-10-12).
const cur = (event, extra = {}) => ({ conversation_id: 'cv1', generation_id: 'g1', model: 'grok-5', hook_event_name: event, cursor_version: '3.2.0', workspace_roots: [extra.root || '/w'], user_email: null, transcript_path: null, ...extra });

test('cursor adapter: the hooks\' journal becomes core lines (prompt, routing, skill read, shell failure, edit, decision in chat)', async () => {
  const cu = await import(`file://${SCRIPTS}/agents/cursor.mjs`);
  const FILE = path.join(os.homedir(), 'proyecto', 'src', 'orders.mjs');
  const feed = (event, extra) => cu.input(cur(event, extra));
  feed('sessionStart', { session_id: 'cv1', is_background_agent: false, composer_mode: 'agent' });
  feed('beforeSubmitPrompt', { prompt: 'agrega reintentos', attachments: [] });
  feed('afterAgentResponse', { text: 'Waymark → L1 · dept-backend\n¿Cómo los hago?\n1. Backoff (Recomendado)\n2. Cola' });
  feed('stop', { status: 'completed', loop_count: 0 });
  feed('beforeSubmitPrompt', { prompt: 'Backoff', generation_id: 'g2' });
  feed('preToolUse', { tool_name: 'Read', tool_input: { file_path: 'C:/s/dept-backend/SKILL.md' }, tool_use_id: 't1', cwd: '/w' });
  feed('postToolUse', { tool_name: 'Read', tool_input: { file_path: 'C:/s/dept-backend/SKILL.md' }, tool_use_id: 't1', tool_output: '"# dept"', duration: 5 });
  feed('preToolUse', { tool_name: 'Shell', tool_input: { command: 'npm test' }, tool_use_id: 't2', cwd: '/w' });
  feed('postToolUseFailure', { tool_name: 'Shell', tool_input: { command: 'npm test' }, tool_use_id: 't2', error_message: 'exit 1', failure_type: 'error' });
  feed('preToolUse', { tool_name: 'Write', tool_input: { file_path: FILE }, tool_use_id: 't3', cwd: '/w' });
  const last = feed('postToolUse', { tool_name: 'Write', tool_input: { file_path: FILE }, tool_use_id: 't3', tool_output: '{}', duration: 9 });
  assert.deepEqual([last.session_id, last.cwd, last.hook_event_name, last.agent_version], ['cv1', '/w', 'PostToolUse', '3.2.0'], 'normalized to the core\'s fields');
  const lines = cu.read(last);
  const uses = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_use').map((c) => [c.name, c.input.file_path || c.input.command || c.input.skill || '']));
  assert.deepEqual(uses, [['AskUserQuestion', ''], ['Skill', 'dept-backend'], ['Read', 'C:/s/dept-backend/SKILL.md'], ['Bash', 'npm test'], ['Edit', FILE]]);
  assert.deepEqual(P.decisionsIn(lines).map((d) => d.chosen), ['Backoff'], 'the question that ended the turn, answered by the next prompt');
  assert.ok(lines.some((l) => l.message?.content?.some?.((c) => c.type === 'tool_result' && c.is_error)), 'postToolUseFailure is an error result');
  assert.equal(lines.filter((l) => l.type === 'user' && typeof l.message?.content === 'string').length, 2, 'two prompts');
  assert.deepEqual([cu.call({ tool_name: 'Shell', tool_input: { command: 'ls' } }), cu.call({ tool_name: 'Write', tool_input: { file_path: 'a.ts' } }), cu.call({ tool_name: 'Read', tool_input: { file_path: 'a.ts' } })], [{ command: 'ls' }, { files: ['a.ts'] }, null]);
  assert.deepEqual([cu.out.context('SessionStart', 'x'), cu.out.deny('r'), cu.out.block('r'), cu.out.blockPrompt('r')],
    [{ additional_context: 'x' }, { permission: 'deny', user_message: 'r', agent_message: 'r' }, { followup_message: 'r' }, { continue: false, user_message: 'r' }]);
  assert.equal(cu.input(cur('stop', { loop_count: 1 })).stop_hook_active, true, 'loop_count > 0: Waymark already blocked once');
  assert.equal(cu.sessions('/w').length, 1, 'the journal of that workspace');
  feed('preToolUse', { tool_name: 'Shell', tool_input: { command: 'npm run long' }, tool_use_id: 't4', cwd: '/w' });
  const long = feed('postToolUse', { tool_name: 'Shell', tool_use_id: 't4', tool_output: JSON.stringify({ exitCode: 2, output: 'x'.repeat(5000) }) });
  const res = cu.read(long).flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : [])).find((c) => c.type === 'tool_result' && c.tool_use_id === 't4');
  assert.equal(res?.is_error, true, 'a long output keeps its exit code (read before the clip)');
});

test('cursor hooks end to end: the card brings Rule 0, the reminder rides on the first tool, a missing Cierre is a followup, the record says cursor; Claude\'s imported hooks step aside', () => {
  const repo = withMemory(repoAt('cursor'));
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const ev = (event, extra = {}) => cur(event, { conversation_id: 'cv2', root: repo, ...extra });
  const card = json(node('session-hook.mjs', ['--agent', 'cursor'], ev('sessionStart', { session_id: 'cv2' })).stdout);
  assert.match(card?.additional_context || '', /Rule 0 — Waymark on every request[\s\S]*Waymark context card/, 'the block, then the card');
  const prompt = json(node('rule0-hook.mjs', ['--agent', 'cursor'], ev('beforeSubmitPrompt', { prompt: 'agrega reintentos al servicio' })).stdout);
  assert.deepEqual(prompt, { continue: true }, 'beforeSubmitPrompt cannot add context');
  node('tool-hook.mjs', ['--agent', 'cursor'], ev('afterAgentResponse', { text: 'Waymark → L1 · dept-backend' }));
  const pre = json(node('tool-hook.mjs', ['--agent', 'cursor'], ev('preToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(repo, 'a.md') }, tool_use_id: 'r1', cwd: repo })).stdout);
  assert.deepEqual(pre, {}, 'no decision: an empty answer, never "allow" (it would skip Cursor\'s own approval)');
  const first = json(node('tool-hook.mjs', ['--agent', 'cursor'], ev('postToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(repo, 'a.md') }, tool_use_id: 'r1', tool_output: '""' })).stdout);
  assert.match(first?.additional_context || '', /ID: new/, 'the per-prompt reminder, with the first tool\'s result');
  const second = node('tool-hook.mjs', ['--agent', 'cursor'], ev('postToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(repo, 'a.md') }, tool_use_id: 'r2', tool_output: '""' })).stdout;
  assert.ok(!/Task ID/.test(second), 'once per prompt');
  fs.writeFileSync(path.join(repo, 'svc.mjs'), 'export const retry = 3;'); // the turn changes a project file: only a change needs the Cierre
  const blocked = json(node('stop-hook.mjs', ['--agent', 'cursor'], ev('stop', { status: 'completed', loop_count: 0 })).stdout);
  assert.ok(blocked?.followup_message, `no Cierre: a followup_message (${JSON.stringify(blocked)})`);
  node('tool-hook.mjs', ['--agent', 'cursor'], ev('afterAgentResponse', { text: `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada el servicio responde\nAprendido: "backoff ← timeouts"` }));
  node('stop-hook.mjs', ['--agent', 'cursor'], ev('stop', { status: 'completed', loop_count: 1 }));
  const rec = P.readRecords(P.projectHome(repo).log).pop();
  assert.equal(rec?.agent, 'cursor');
  const imported = node('rule0-hook.mjs', [], { ...ev('beforeSubmitPrompt', { prompt: 'x' }) }, { CURSOR_VERSION: '3.2.0' });
  assert.equal(imported.stdout, '', 'a hook registered for Claude Code that Cursor imports does nothing');
  const importedStop = node('stop-hook.mjs', [], ev('stop', { loop_count: 0 }));
  assert.equal(importedStop.stdout, '', 'cursor_version in the input is enough');
  const fromTerminal = json(node('rule0-hook.mjs', [], { session_id: 'cl1', cwd: repo, prompt: 'hola' }, { CURSOR_VERSION: '3.2.0' }).stdout);
  assert.ok(fromTerminal?.hookSpecificOutput?.additionalContext, 'Claude Code started from Cursor\'s terminal keeps its hooks');
});

test('install-hooks --agent cursor: hooks.json version 1, flat entries for every tool; idempotent; registered() and connect-agents see it', async () => {
  const { planHooks, registered } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const { settings, steps } = planHooks({ version: 1, hooks: { afterFileEdit: [{ command: './format.sh' }] } }, { scripts: '/s/waymark/scripts', agent: 'cursor' });
  assert.equal(settings.version, 1);
  assert.deepEqual(Object.keys(settings.hooks), ['afterFileEdit', 'sessionStart', 'beforeSubmitPrompt', 'preToolUse', 'stop', 'postToolUse', 'postToolUseFailure', 'afterAgentResponse']);
  assert.deepEqual(settings.hooks.preToolUse, [{ command: 'node "/s/waymark/scripts/hook-run.cjs" "/s/waymark/scripts/tool-hook.mjs" --agent cursor' }], 'every tool: the journal needs reads and questions too');
  assert.deepEqual(settings.hooks.afterFileEdit, [{ command: './format.sh' }], 'the user\'s hooks stay');
  assert.equal(steps.length, 7);
  assert.deepEqual(planHooks(settings, { scripts: '/s/waymark/scripts', agent: 'cursor' }).steps, [], 'idempotent');
  write(process.env.WAYMARK_CURSOR_HOOKS, JSON.stringify(settings));
  assert.ok(registered().some((r) => r.agent === 'cursor' && r.commands.length === 4), JSON.stringify(registered()));
  const { found, planFor } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  fs.mkdirSync(path.join(agentsHome, '.cursor'), { recursive: true });
  const c = found().find((a) => a.name === 'Cursor');
  assert.ok(c && planFor(c).skip, 'no global instructions file: its session card brings the block');
  fs.rmSync(path.join(agentsHome, '.cursor'), { recursive: true });
  fs.rmSync(process.env.WAYMARK_CURSOR_HOOKS);
});

test('uninstall: the plan, then --apply removes every agent\'s hooks, the status line (yours back), the OpenCode plugin and the blocks, and restores mcp-fit; backup first', async () => {
  const cmd = (f, a = '') => `node "/x/waymark/scripts/${f}"${a}`;
  const claudeDir = path.dirname(process.env.WAYMARK_CLAUDE_SETTINGS);
  write(process.env.WAYMARK_CLAUDE_SETTINGS, JSON.stringify({ model: 'x', statusLine: { type: 'command', command: cmd('statusline.mjs') },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd('stop-hook.mjs') }, { type: 'command', command: 'mine.sh' }] }], SessionStart: [{ hooks: [{ type: 'command', command: cmd('session-hook.mjs') }] }] } }));
  write(path.join(home, 'statusline.json'), JSON.stringify({ next: 'my-line.sh' }));
  write(path.join(claudeDir, 'CLAUDE.md'), '# Mine\n\n<!-- waymark:begin -->\nRule 0\n<!-- waymark:end -->\n\nkeep\n');
  write(process.env.WAYMARK_CODEX_HOOKS, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: cmd('stop-hook.mjs', ' --agent codex') }] }] } }));
  write(path.join(agentsHome, '.codex', 'AGENTS.md'), 'codex rules\n\n<!-- waymark:pointer -->\nSi el proyecto tiene .waymark/, lee .waymark/tasks.md primero.\n<!-- /waymark:pointer -->\n');
  write(process.env.WAYMARK_CURSOR_HOOKS, JSON.stringify({ version: 1, hooks: { stop: [{ command: cmd('stop-hook.mjs', ' --agent cursor') }, { command: './mine.sh' }] } }));
  write(process.env.WAYMARK_OPENCODE_PLUGIN, 'const SCRIPTS = "/x/waymark/scripts";');
  const proj = repoAt('mcp');
  write(path.join(proj, '.claude', 'settings.local.json'), JSON.stringify({ permissions: { deny: ['mcp__angular-cli', 'Bash(rm -rf)'] } }));
  write(path.join(home, 'mcp-fit.json'), JSON.stringify({ [path.resolve(proj).replace(/\\/g, '/').toLowerCase()]: ['angular-cli'] }));
  const plan = spawnSync(process.execPath, [path.join(SCRIPTS, 'uninstall.mjs')], { env: process.env, encoding: 'utf8' });
  assert.match(plan.stdout, /claude-settings\.json[\s\S]*statusLine[\s\S]*codex-hooks\.json[\s\S]*cursor-hooks\.json[\s\S]*opencode-plugin\.js[\s\S]*CLAUDE\.md[\s\S]*AGENTS\.md[\s\S]*mcp-fit/, plan.stdout);
  assert.match(plan.stdout, /Plan only/);
  assert.ok(fs.readFileSync(process.env.WAYMARK_CLAUDE_SETTINGS, 'utf8').includes('stop-hook'), 'the plan writes nothing');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'uninstall.mjs'), '--apply'], { env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const claude = JSON.parse(fs.readFileSync(process.env.WAYMARK_CLAUDE_SETTINGS, 'utf8'));
  assert.deepEqual(claude, { model: 'x', statusLine: { type: 'command', command: 'my-line.sh' }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine.sh' }] }] } });
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.WAYMARK_CODEX_HOOKS, 'utf8')), { hooks: {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(process.env.WAYMARK_CURSOR_HOOKS, 'utf8')), { version: 1, hooks: { stop: [{ command: './mine.sh' }] } });
  assert.ok(!fs.existsSync(process.env.WAYMARK_OPENCODE_PLUGIN));
  assert.equal(fs.readFileSync(path.join(claudeDir, 'CLAUDE.md'), 'utf8'), '# Mine\n\nkeep\n');
  assert.equal(fs.readFileSync(path.join(agentsHome, '.codex', 'AGENTS.md'), 'utf8'), 'codex rules\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.local.json'), 'utf8')).permissions.deny, ['Bash(rm -rf)'], 'only the rules mcp-fit added');
  const bk = fs.readdirSync(path.join(home, 'backups')).find((d) => d.endsWith('-uninstall'));
  assert.ok(bk && fs.readdirSync(path.join(home, 'backups', bk)).length >= 5, 'every changed file backed up first');
  assert.ok(fs.existsSync(home), '~/.waymark (the user\'s memory) stays');
  fs.rmSync(path.join(agentsHome, '.codex'), { recursive: true });
  const { stripWaymark } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  assert.equal(stripWaymark('\n# A\n\n\n\nkeep spacing\n\n<!-- waymark:begin -->\nR\n<!-- waymark:end -->\n'), '\n# A\n\n\n\nkeep spacing\n', 'only the block and its own blank lines go');
});
