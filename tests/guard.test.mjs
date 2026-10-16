// Waymark 2.0.16 · point 8: the sensitive-path guard of the pre-tool hook. Run: node --test tests/*.test.mjs
// Temporary WAYMARK_HOME and repos; nothing reads or writes the real ~/.waymark or any real secret.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-guard-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { checkSensitive, commandSensitive, gate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { loadRisk } = await import(`file://${SCRIPTS}/lib/risk.mjs`);
const { deniedSince } = await import(`file://${SCRIPTS}/lib/denied.mjs`);
const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);
const codex = await import(`file://${SCRIPTS}/agents/codex.mjs`);
const cursor = await import(`file://${SCRIPTS}/agents/cursor.mjs`);

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-guard-proj-'));
temps.push(proj);
fs.mkdirSync(path.join(proj, 'cfg'));
for (const f of ['.env', '.env.local', '.env.example', '.env.sample', '.env.template', 'cfg/server.pem', 'cfg/id_rsa', 'cfg/store.p12', 'cfg/app.key', 'src.txt', 'environment.ts']) fs.writeFileSync(path.join(proj, f), 'x');
const read = (file) => ({ tool_name: 'Read', tool_input: { file_path: file }, cwd: proj, session_id: 's-guard' });
const edit = (file) => ({ tool_name: 'Edit', tool_input: { file_path: file }, cwd: proj, session_id: 's-guard' });
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command }, cwd: proj, session_id: 's-guard' });

test('guard: Read and Edit of every sensitive pattern are denied', () => {
  for (const f of ['.env', '.env.local', 'cfg/server.pem', 'cfg/id_rsa', 'cfg/store.p12', 'cfg/app.key', path.join(os.homedir(), '.ssh', 'id_ed25519'), path.join(os.homedir(), '.aws', 'credentials'), path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json'), path.join(os.homedir(), '.ssh')]) {
    assert.match(gate(read(path.resolve(proj, f)), claude) || '', /sensitive path/, `Read ${f}`);
    assert.match(gate(edit(path.resolve(proj, f)), claude) || '', /sensitive path/, `Edit ${f}`);
  }
});

test('guard: the templates and ordinary files pass', () => {
  for (const f of ['.env.example', '.env.sample', '.env.template', 'src.txt', 'environment.ts']) {
    assert.equal(checkSensitive({ reads: [path.join(proj, f)] }, proj), null, f);
  }
});

test('guard: a shell command that names an existing sensitive file is denied; a message that only mentions it is not', () => {
  const cfg = loadRisk(proj);
  assert.match(commandSensitive('cat .env', proj, cfg) || '', /\.env$/);
  assert.match(commandSensitive('cd cfg && cat id_rsa', proj, cfg) || '', /id_rsa$/);
  assert.match(commandSensitive('echo TOKEN=1 > .env.production', proj, cfg) || '', /\.env\.production$/, 'a redirect creating one');
  fs.mkdirSync(path.join(os.homedir(), '.ssh'), { recursive: true }); fs.writeFileSync(path.join(os.homedir(), '.ssh', 'known_hosts'), ''); // the sandbox home, never the real one
  assert.match(commandSensitive(`cat ~/.ssh/known_hosts`, proj, cfg) || '', /\.ssh/, '~ expands to the home folder');
  assert.equal(commandSensitive('cat .env.example', proj, cfg), null);
  assert.equal(commandSensitive('git commit -m "fix how .env is loaded"', proj, cfg), null, 'a word inside a message is no path');
  assert.equal(commandSensitive('cat .env.missing-file', proj, cfg), null, 'nothing there to leak');
  assert.match(gate(bash('cat .env'), claude) || '', /sensitive path/);
});

test('guard: the known limit — a search that reaches a secret without naming it is not stopped', () => {
  const cfg = loadRisk(proj);
  for (const c of ['grep -r SECRET .', 'find . -name "*.pem" -exec cat {} +', 'cat $(ls | grep env)', 'node -e "require(\'fs\').readFileSync(\'.env\')"']) {
    assert.equal(commandSensitive(c, proj, cfg), null, c);
  }
});

test('guard: the user allow list (preferences.md) and the project allow list lift the denial', () => {
  fs.writeFileSync(path.join(home, 'preferences.md'), '# Preferences\n\n- Sensitive allow: cfg/server.pem, /fixtures/\n');
  assert.equal(checkSensitive({ reads: [path.join(proj, 'cfg', 'server.pem')] }, proj), null, 'named by the user');
  assert.match(checkSensitive({ reads: [path.join(proj, 'cfg', 'id_rsa')] }, proj) || '', /sensitive path/, 'only what they named');
  assert.equal(checkSensitive({ reads: [path.join(proj, 'test', 'fixtures', 'a.pem')] }, proj), null, 'a fragment of the path');
  fs.rmSync(path.join(home, 'preferences.md'));
  assert.match(checkSensitive({ reads: [path.join(proj, 'cfg', 'server.pem')] }, proj) || '', /sensitive path/, 'removed from the file: denied again');
});

test('guard: a denial is kept for the task\'s record', () => {
  const before = deniedSince('s-record', 0).length;
  gate({ ...read(path.join(proj, '.env')), session_id: 's-record' }, claude);
  const got = deniedSince('s-record', 0);
  assert.equal(got.length, before + 1);
  assert.deepEqual([got.at(-1).tool, got.at(-1).path.endsWith('/.env')], ['read', true]);
});

test('guard: where the agent has no hook before that tool, nothing is stopped (the README says which)', () => {
  // Codex and Cursor read through their shell or their own tools: the read tool has no adapter call, only edits and commands do
  assert.equal(codex.call({ tool_name: 'Read', tool_input: { file_path: '.env' } }), null);
  assert.equal(cursor.call({ tool_name: 'Read', tool_input: { file_path: '.env' } }), null);
  assert.equal(gate({ tool_name: 'Read', tool_input: { file_path: path.join(proj, '.env') }, cwd: proj, session_id: 's-x' }, codex), null);
  // Claude Code's Read is covered, and the hook registration includes it
  const agents = JSON.parse(fs.readFileSync(path.join(SCRIPTS, 'agents', 'agents.json'), 'utf8')).agents;
  assert.match(agents.find((a) => a.key === 'claude').hooks.matcher, /\bRead\b/);
});
