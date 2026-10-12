// Waymark 2.0.3 · point 4b: any agent, the ones Waymark does not know included (agents as data in agents.json, unknown
// agents detected, the pointer offered, the adapter template). Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME, agents home and settings files; nothing reads or writes the real ones.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-any-t-'));
const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-any-h-'));
const temps = [home, agentsHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
for (const k of ['CODEX_HOME', 'GEMINI_CLI_HOME', 'CURSOR_CONFIG_DIR', 'CLAUDE_CONFIG_DIR', 'XDG_CONFIG_HOME', 'CURSOR_VERSION', 'KIRO_HOME', 'COPILOT_HOME', 'QWEN_HOME']) delete process.env[k];
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: agentsHome, WAYMARK_BACKUPS: path.join(home, 'backups'),
  WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'),
  WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'), WAYMARK_CODEX_HOOKS: path.join(home, 'codex-hooks.json'),
  WAYMARK_GEMINI_SETTINGS: path.join(home, 'gemini-settings.json'), WAYMARK_OPENCODE_PLUGIN: path.join(home, 'opencode-plugin.js'),
  WAYMARK_CURSOR_HOOKS: path.join(home, 'cursor-hooks.json'),
});

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-any-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const at = (...p) => path.join(agentsHome, ...p);
const clean = () => { for (const n of fs.readdirSync(agentsHome)) fs.rmSync(at(n), { recursive: true, force: true }); };

test('agents as data: agents.json lists every known agent with its docs; the adapters, install-hooks and connect-agents read it', async () => {
  const data = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'agents', 'agents.json'), 'utf8'));
  const keys = data.agents.map((a) => a.key);
  for (const k of ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'kiro', 'copilot', 'windsurf', 'qwen', 'antigravity', 'droid', 'amp', 'crush']) assert.ok(keys.includes(k), k);
  for (const a of data.agents) {
    assert.match(String(a.docs), /^https:\/\//, `${a.key}: every entry cites its documentation`);
    if (a.adapter) assert.ok(fs.existsSync(path.join(SCRIPTS, 'agents', `${a.adapter}.mjs`)), `${a.key}: its module exists`);
  }
  const { AGENTS: modules } = await import(`file://${SCRIPTS}/agents/index.mjs`);
  assert.deepEqual(Object.keys(modules).sort(), data.agents.filter((a) => a.adapter).map((a) => a.key).sort(), 'one module per agent with an adapter');
  const { AGENTS } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  assert.ok(!AGENTS().some((a) => a.key === 'claude'), 'Claude Code: its CLAUDE.md is the install\'s, not connect-agents\'');
  assert.ok(AGENTS().some((a) => a.key === 'kiro' && a.dir === at('.kiro')));
  const ih = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  assert.equal(ih.settingsFile('codex'), process.env.WAYMARK_CODEX_HOOKS);
  assert.equal(ih.settingsFile('kiro'), null, 'no adapter: no hooks written');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'install-hooks.mjs'), '--agent', 'kiro'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no adapter yet[\s\S]*Add an agent/, r.stdout);
});

test('a known agent without an adapter (Kiro): found, the pointer goes into its own instructions file, the plan says where it reads skills', async () => {
  const { found, planFor, apply: connect, POINTER } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  fs.mkdirSync(at('.kiro'), { recursive: true }); // no steering/ yet: connect creates it
  write(at('.codeium', 'windsurf', 'memories', 'global_rules.md'), '# mine\n');
  const w = found().find((a) => a.key === 'windsurf');
  connect(planFor(w));
  assert.equal(fs.readFileSync(at('.codeium', 'windsurf', 'memories', 'global_rules.md'), 'utf8'), `# mine\n\n${POINTER}\n`);
  const bk = fs.readdirSync(path.join(home, 'backups')).find((d) => d.endsWith('-connect-agents'));
  assert.equal(fs.readFileSync(path.join(home, 'backups', bk, 'windsurf', 'memories', 'global_rules.md'), 'utf8'), '# mine\n', 'backup of a file in a subfolder');
  const k = found().find((a) => a.key === 'kiro');
  assert.ok(k, JSON.stringify(found().map((a) => a.name)));
  assert.equal(k.path, at('.kiro', 'steering', 'AGENTS.md'));
  const plan = planFor(k);
  assert.match(plan.steps.join('\n'), /reads skills from ~\/\.kiro\/skills, not ~\/\.agents\/skills/);
  connect(plan);
  assert.equal(fs.readFileSync(at('.kiro', 'steering', 'AGENTS.md'), 'utf8'), `${POINTER}\n`);
  assert.ok(found().find((a) => a.key === 'kiro').connected);
  clean();
});

test('shared folder: Antigravity and Gemini CLI share ~/.gemini/GEMINI.md, which is written once', async () => {
  const { found, planFor } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  fs.mkdirSync(at('.gemini', 'antigravity'), { recursive: true });
  assert.deepEqual(found().map((a) => a.key), ['antigravity'], 'Antigravity alone owns GEMINI.md');
  assert.ok(planFor(found()[0]).steps.length);
  write(at('.gemini', 'projects.json'), '{}');
  const [g, ag] = found();
  assert.deepEqual([g.key, ag.key], ['gemini', 'antigravity']);
  assert.ok(planFor(g).steps.length);
  assert.match(planFor(ag).skip, /shares .*GEMINI\.md with Gemini CLI/);
  clean();
});

test('unknown agents: a home folder with an agent\'s signals is found, a tool\'s folder is not; the pointer goes where its instructions file is known', async () => {
  const { unknownAgents, found, planFor, apply: connect, POINTER } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  write(at('.foo', 'FOO.md'), '# foo rules\n');
  fs.mkdirSync(at('.foo', 'skills'), { recursive: true });
  write(at('.bar', 'settings.json'), JSON.stringify({ hooks: { Stop: [] } }));
  write(at('.config', 'baz', 'AGENTS.md'), '');
  write(at('.vscode', 'argv.json'), '{}');
  fs.mkdirSync(at('.vscode', 'extensions'), { recursive: true });
  fs.mkdirSync(at('.agents', 'skills'), { recursive: true });
  write(at('.docker', 'config.json'), '{"auths":{}}');
  const u = unknownAgents().map((a) => [a.name, a.file, a.signals.join(' ')]).sort();
  assert.deepEqual(u, [['.bar', null, 'hooks'], ['.config/baz', 'AGENTS.md', 'AGENTS.md'], ['.foo', 'FOO.md', 'FOO.md skills/']]);
  const foo = found().find((a) => a.name === '.foo');
  assert.ok(foo.unknown && !foo.connected);
  assert.match(planFor(foo).steps[0], /marked pointer block/);
  connect(planFor(foo));
  assert.equal(fs.readFileSync(at('.foo', 'FOO.md'), 'utf8'), `# foo rules\n\n${POINTER}\n`);
  assert.match(planFor(found().find((a) => a.name === '.bar')).skip, /instructions file is not known[\s\S]*Add an agent/);
  const { planUninstall } = await import(`file://${SCRIPTS}/uninstall.mjs`);
  assert.ok(planUninstall().some((s) => s.file === at('.foo', 'FOO.md')), 'uninstall takes the pointer back out');
  clean();
});

test('check: agents with no adapter (known with hooks, or unknown) are named once with the procedure; install-hooks is offered only where an adapter exists', async () => {
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const repo = withMemory(repoAt('check'));
  fs.mkdirSync(at('.kiro'), { recursive: true });
  write(at('.foo', 'AGENTS.md'), '');
  fs.mkdirSync(at('.codex'), { recursive: true });
  const items = await check(repo);
  const line = items.find((t) => t.startsWith('agents: ')) || '';
  assert.match(line, /Kiro/, line);
  assert.match(line, /\.foo \(unknown/, line);
  assert.match(line, /Add an agent/);
  assert.match(line, /agent-adapter\.template\.mjs/);
  const hooks = items.find((t) => t.startsWith('hooks: ')) || '';
  assert.match(hooks, /Codex \(--agent codex\)/, hooks);
  assert.doesNotMatch(hooks, /Kiro|\.foo/, 'no adapter: nothing to install yet');
  clean();
});

test('session card: a new agent that is not prepared is said once; the next session says nothing', () => {
  const repo = withMemory(repoAt('card'));
  write(at('.foo', 'AGENTS.md'), '');
  const run = () => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8' }).stdout).hookSpecificOutput.additionalContext;
  const first = run();
  assert.match(first, /New agents on this machine[^\n]*\.foo/, first);
  assert.match(first, /waymark\.mjs" check/);
  assert.doesNotMatch(run(), /New agents on this machine/, 'said once');
  write(at('.qwen', 'settings.json'), '{}');
  assert.match(run(), /New agents on this machine[^\n]*Qwen Code/, 'a later one is said too');
  clean();
});

test('adapter template: it has every export of claude.mjs; the procedure to add an agent is in dept-devex', async () => {
  const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);
  const tpl = await import(`file://${path.join(SCRIPTS, '..', 'templates', 'agent-adapter.template.mjs')}`);
  for (const k of Object.keys(claude)) assert.ok(k in tpl, k);
  const proc = fs.readFileSync(path.join(ROOT, 'skills', 'dept-devex', 'procedures.md'), 'utf8');
  const section = proc.split('### Add an agent')[1]?.split('\n### ')[0] || '';
  for (const k of ['agents.json', 'agent-adapter.template.mjs', 'library-docs', 'connect-agents.mjs', 'install-hooks.mjs --agent']) assert.ok(section.includes(k), k);
  assert.match(fs.readFileSync(path.join(ROOT, 'skills', 'dept-devex', 'SKILL.md'), 'utf8'), /- Add an agent/);
});
