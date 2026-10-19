// Waymark 2.0.18 · point 9: what the guard could not stop is detected at the end of the turn, from the transcript of any agent (docs/adr/0037).
// Run: node --test tests/*.test.mjs. Temporary WAYMARK_HOME; nothing reads or writes the real ~/.waymark or any real secret.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-guarded-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_BACKUPS = path.join(home, 'backups');
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const G = await import(`file://${SCRIPTS}/lib/guard.mjs`);
const { loadRisk } = await import(`file://${SCRIPTS}/lib/risk.mjs`);
const { readLog } = await import(`file://${SCRIPTS}/provenance.mjs`);
const MX = await import(`file://${SCRIPTS}/matrix.mjs`);

const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-guarded-'));
temps.push(proj);
fs.writeFileSync(path.join(proj, '.env'), 'x');
fs.writeFileSync(path.join(proj, 'app.txt'), 'x');
const cfg = loadRisk(proj);
// Fake values, assembled so that no real-looking secret sits in this file.
const AWS = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const KEY = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
const detect = (tools, extra = {}) => G.detectGuarded(tools, { cwd: proj, cfg, ...extra });

test('detectGuarded: a read, an edit and a shell command that got through are found, with the tool and the path and never a value', () => {
  const found = detect([
    { id: 'a', name: 'Read', input: { file_path: path.join(proj, '.env') } },
    { id: 'b', name: 'Edit', input: { file_path: path.join(proj, 'cfg', 'server.pem') } },
    { id: 'c', name: 'Bash', input: { command: 'cat .env*' } },
    { id: 'd', name: 'PowerShell', input: { command: 'Get-Content .env' } },
    { id: 'e', name: 'Read', input: { file_path: path.join(proj, 'app.txt') } },
    { id: 'f', name: 'Bash', input: { command: 'ls' } },
  ]);
  assert.deepEqual(found.map((f) => [f.kind, f.tool, f.path]), [['read', 'Read', '.env'], ['edit', 'Edit', 'cfg/server.pem'], ['shell', 'Bash', '.env'], ['shell', 'PowerShell', '.env']]);
});

test('detectGuarded: a call the hook refused is not found again, and the home folder is shown as ~', () => {
  const tools = [{ id: 'a', name: 'Read', input: { file_path: path.join(proj, '.env') } }, { id: 'b', name: 'Read', input: { file_path: path.join(os.homedir(), '.ssh', 'id_ed25519') } }];
  assert.deepEqual(detect(tools, { denied: (t) => t.id === 'a' }).map((f) => f.path), ['~/.ssh/id_ed25519']);
});

test('detectGuarded: a secret in strong format printed by any tool is found by its kind and line, never by its value', () => {
  const out = { a: `line one\nAWS_ACCESS_KEY_ID=${AWS}`, b: `${KEY}\nabc`, c: 'password=hunter2 and nothing else', d: 'nothing' };
  const found = detect(['a', 'b', 'c', 'd'].map((id) => ({ id, name: 'Bash', input: { command: 'run' } })), { outputOf: (t) => out[t.id] });
  assert.deepEqual(found.map((f) => [f.kind, f.secret, f.line]), [['output', 'AWS access key', 2], ['output', 'llave privada', 1]], 'password= is not a strong format (the user chose the strong ones only)');
  assert.equal(JSON.stringify(found).includes(AWS), false, 'the value is never kept');
});

test('detectGuarded: the allow list lifts it, the same call twice is one finding, and there are at most 20', () => {
  assert.deepEqual(detect([{ id: 'a', name: 'Read', input: { file_path: path.join(proj, '.env') } }], { cfg: { ...cfg, allow: [...cfg.allow, '.env'] } }), []);
  assert.equal(detect([1, 2, 3].map((i) => ({ id: `${i}`, name: 'Read', input: { file_path: path.join(proj, '.env') } }))).length, 1);
  assert.equal(detect(Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, name: 'Read', input: { file_path: path.join(proj, `k${i}.pem`) } }))).length, 20);
});

// ---- end to end: the end-of-turn hook of two agents, one with its own read tool and one with the Claude shapes ----

const day = new Date().toLocaleDateString('sv');
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const use = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const got = (id, text) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
const FILE = '/work/proj/src/orders.service.mjs';
const body = (cwd, extra) => [prompt('agrega reintentos al servicio de pedidos'), say('Waymark → L2 · dept-backend · skills: code-review'), use('s1', 'Skill', { skill: 'dept-backend' }),
  use('p1', 'Read', { file_path: '/skills/dept-backend/procedures.md' }), use('m1', 'Bash', { command: 'node "/s/waymark/scripts/waymark.mjs" pack src/orders.service.mjs' }),
  use('q1', 'AskUserQuestion', { questions: [{ question: '¿Cómo?', options: [{ label: 'Backoff' }, { label: 'Cola' }] }] }),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'Backoff' }, { label: 'Cola' }] }], answers: { '¿Cómo?': 'Backoff' } } },
  ...extra, use('e1', 'Edit', { file_path: FILE }), use('b1', 'Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), use('r1', 'Skill', { skill: 'code-review' }),
  use('w1', 'Edit', { file_path: path.join(os.homedir(), '.waymark', 'projects', 'proj.md') })];
const cierre = (id) => `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada timeouts en el log de pedidos\nAprendido: "backoff ← timeouts"`;

test('stop hook: what got through is recorded in the task, with a finding that is not a block', () => {
  const cwd = path.join(proj, 'e2e'); fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, '.env'), 'x'); // `cat .env` names a file that exists
  const lines = body(cwd, [use('x1', 'Read', { file_path: path.join(cwd, '.env') }), got('x1', `AWS_ACCESS_KEY_ID=${AWS}`), use('x2', 'Bash', { command: 'cat .env' }), got('x2', 'done')]);
  const transcript = path.join(home, 'guarded-claude.jsonl');
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'sg1', last_assistant_message: cierre(`${day} · T1`) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const rec = readLog(cwd).pop();
  assert.ok(rec, 'the task was recorded, not blocked');
  assert.deepEqual(rec.observed.guarded.map((f) => [f.kind, f.tool, f.path || f.secret]), [['read', 'Read', '.env'], ['output', 'Read', 'AWS access key'], ['shell', 'Bash', '.env']]);
  assert.ok(rec.findings.some((f) => /no hook stopped it \(recorded, not blocked\): read \.env/.test(f)), JSON.stringify(rec.findings));
  assert.equal(JSON.stringify(rec).includes(AWS), false, 'never the value');
});

test('stop hook --agent gemini: its read_file of a protected path, which no hook of Gemini stops, is found in its transcript', () => {
  const cwd = path.join(proj, 'e2e-gemini'); fs.mkdirSync(cwd, { recursive: true });
  const gm = (id, type, extra = {}) => ({ id, timestamp: '2026-10-05T20:00:00.000Z', type, ...extra });
  const rows = [gm('u1', 'user', { content: 'agrega reintentos al servicio de pedidos' }),
    gm('a1', 'gemini', { content: 'Waymark → L1 · dept-backend', model: 'gemini-3-pro', tokens: { input: 2000, output: 100, cached: 1500 }, toolCalls: [
      { id: 'c1', name: 'read_file', args: { file_path: 'C:/s/dept-backend/SKILL.md' }, status: 'success', result: 'x' },
      { id: 'c2', name: 'read_file', args: { file_path: 'C:/s/dept-backend/procedures.md' }, status: 'success', result: '### Endpoint' },
      { id: 'c2b', name: 'run_shell_command', args: { command: 'node C:/s/waymark/scripts/waymark.mjs pack src/orders.service.mjs' }, status: 'success', result: 'x' },
      { id: 'c3', name: 'ask_user', args: { questions: [{ question: '¿Cómo?', options: [{ label: 'Backoff' }, { label: 'Cola' }] }] }, status: 'success', result: JSON.stringify({ answers: { 0: 'Backoff' } }) },
      { id: 'c3b', name: 'read_file', args: { file_path: path.join(cwd, '.env') }, status: 'success', result: 'TOKEN=1' },
      { id: 'c4', name: 'replace', args: { file_path: FILE }, status: 'success', result: 'ok' },
      { id: 'c5', name: 'run_shell_command', args: { command: 'node --check src/orders.service.mjs && npm run build' }, status: 'success', result: 'ok' }] })];
  const transcript = path.join(home, 'guarded-gemini.jsonl');
  fs.writeFileSync(transcript, rows.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs'), '--agent', 'gemini'], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'sg2', prompt_response: cierre(`${day} · T1`) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const rec = readLog(cwd).pop();
  assert.equal(rec.agent, 'gemini');
  assert.deepEqual(rec.observed.guarded.map((f) => [f.kind, f.tool, f.path]), [['read', 'Read', '.env']]);
});

test('stop hook: a clean turn records no finding of this kind', () => {
  const cwd = path.join(proj, 'e2e-clean'); fs.mkdirSync(cwd, { recursive: true });
  const transcript = path.join(home, 'guarded-clean.jsonl');
  fs.writeFileSync(transcript, body(cwd, []).map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'sg3', last_assistant_message: cierre(`${day} · T1`) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const rec = readLog(cwd).pop();
  assert.deepEqual(rec.observed.guarded, []);
  assert.equal(rec.findings.some((f) => /no hook stopped it/.test(f)), false);
});

// ---- the matrix: prevent or detect, never none ----

test('matrix: every guarded action of every agent with an adapter is prevented or detected, never none', async () => {
  const rows = (await MX.agentMatrix()).filter((r) => r.adapter);
  assert.ok(rows.length >= 8);
  for (const r of rows) for (const k of ['guard', 'reads', 'secrets']) assert.match(r.cells[k], /^(prevent|detect)$/, `${r.name}: ${k}`);
  assert.equal(rows.find((r) => r.key === 'claude').cells.reads, 'prevent', 'Claude Code reads go through a hook before the tool');
  assert.equal(rows.find((r) => r.key === 'codex').cells.reads, 'detect');
  assert.equal(rows.find((r) => r.key === 'gemini').cells.guard, 'prevent', 'its edits and shell');
  assert.deepEqual([...new Set(rows.map((r) => r.cells.secrets))], ['detect']);
});

test('matrix: an agent with no hook at all would be told apart, not given a cell that says it is guarded', () => {
  const ev = MX.eventsOf({ adapter: 'x', hooks: { format: 'flat', events: { SessionStart: 's', UserPromptSubmit: 'u' } } });
  assert.equal(ev.Stop, false);
  assert.equal(ev.PreToolUse, false);
});
