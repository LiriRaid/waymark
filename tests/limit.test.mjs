// Waymark 2.0.19 · point 12 (ADR 0048): a turn the quota or the provider cut is not a task that failed its testigos. The harness leaves a synthetic message
// as the turn's last (error rate_limit, or server_error for a dropped connection); the end-of-turn hook then blocks nothing, judges no testigo, records
// the task parcial for an external cause and leaves a handoff. Synthetic copies of the pattern: a logic case, a CSS/HTML case and the counter-examples.
// Run: node --test tests/limit.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-limit-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_ENGRAM = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { externalStop } = await import(`file://${SCRIPTS}/transcript.mjs`);

let calls = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const tool = (name, input) => { const id = `u${++calls}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
// what the harness writes when it cuts the turn: a synthetic assistant message no model produced
const cut = (error, text) => ({ type: 'assistant', timestamp: at(), isApiErrorMessage: true, error, message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text }] } });
const LIMIT = cut('rate_limit', "You've hit your session limit · resets 2:50pm (America/Tegucigalpa)");
const DROP = cut('server_error', 'API Error: Connection lost mid-response. The response above may be incomplete.');

test('12: the notice is read from the turn\'s last message: a usage limit, a dropped provider, nothing else', () => {
  const edit = tool('Edit', { file_path: '/work/a.ts' }).flat();
  assert.equal(externalStop([prompt('x'), say('Waymark → L2 · dept-backend'), ...edit, LIMIT])?.cause, 'usage limit');
  assert.equal(externalStop([prompt('x'), ...edit, DROP])?.cause, 'provider');
  assert.match(externalStop([prompt('x'), LIMIT]).text, /session limit/);
  assert.equal(externalStop([prompt('x'), ...edit, say('listo')]), null, 'a normal end');
  assert.equal(externalStop([prompt('x'), LIMIT, prompt('sigue'), say('Waymark → L1')]), null, 'counter-example: a notice from an earlier turn excuses nothing');
  assert.equal(externalStop([prompt('x'), say('el texto "session limit" en mi respuesta')]), null, 'counter-example: the words in a model reply are not the harness notice');
  assert.equal(externalStop([prompt('x'), cut('invalid_request', 'API Error: 400 bad request')]), null, 'counter-example: another API error');
});

const run = (script, payload) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  c.on('close', () => resolve(out));
  c.stdin.end(JSON.stringify(payload));
});
// a repo with one committed file the agent then changed, and a transcript that ends as given
const session = async (file, ending, { spec = false } = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-limit-')); temps.push(dir);
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.waymark')); fs.writeFileSync(path.join(dir, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), 'a\n');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: dir }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { cwd: dir });
  fs.writeFileSync(path.join(dir, file), 'b\n');
  const lines = [prompt('ajusta el archivo y deja los tests en verde'), say('Waymark → L2 · dept-backend'), ...tool('Skill', { skill: 'dept-backend' }), ...tool('Edit', { file_path: path.join(dir, file) }), ...(spec ? tool('Bash', { command: 'pnpm exec vitest run a.spec.ts' }) : []), ...ending];
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const session_id = `s-limit-${++calls}`;
  const out = await run('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id, stop_hook_active: false, last_assistant_message: ending.at(-1)?.message?.content?.[0]?.text || '' });
  return { dir, out, session_id, records: P.readRecords(P.projectHome(dir).log) };
};

for (const [kind, file] of [['logic', 'src/orders.service.ts'], ['css/html', 'src/app/shared/button.component.css']]) {
  test(`12: ${kind} — a turn cut by the usage limit blocks nothing, records parcial(usage limit) and leaves a handoff`, async () => {
    const { dir, out, records } = await session(file, [LIMIT]);
    assert.ok(!/"decision":"block"|"continue":false/.test(out), `no block: ${out.slice(0, 200)}`);
    const rec = records.find((r) => r.id);
    assert.ok(rec, 'the work has its record');
    assert.equal(rec.outcome.result, 'parcial');
    assert.equal(rec.outcome.cause, 'external');
    assert.match(rec.outcome.why, /usage limit/);
    assert.ok(rec.evaluation.steps?.every?.((s) => s.pass !== false) ?? true, 'no testigo is ✘: none was judged');
    const relay = fs.readFileSync(path.join(P.projectHome(dir).dir, 'next-prompt.md'), 'utf8');
    assert.match(relay, /Relevo de/);
    assert.match(relay, new RegExp(path.basename(file).replace(/\./g, '\\.')), 'names what was changed');
    assert.match(relay, /▶\d/, 'and what is left');
    assert.ok(!relay.includes('resets 2:50pm'), 'the quota notice itself is not copied');
  });
}

test('12: a dropped provider is the same: parcial(provider), no block', async () => {
  const { out, records } = await session('src/a.ts', [DROP]);
  assert.ok(!/"decision":"block"/.test(out));
  assert.match(records.find((r) => r.id).outcome.why, /provider/);
});

test('12: counter-example — a real red test with no notice still blocks the close', async () => {
  const { out, records } = await session('src/a.ts', [say('terminé')]);
  assert.match(out, /"decision":"block"/, 'no Cierre and no notice: the testigos still demand it');
  assert.ok(!records.some((r) => r.id), 'nothing recorded yet');
});

test('12: counter-example — a notice that comes after a close is no new task', async () => {
  const { dir, records } = await session('src/a.ts', [say('## Cierre · 2026-10-25 · T1\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y'), LIMIT]);
  assert.ok(!records.some((r) => r.outcome?.cause === 'external'), 'a turn that carries its Cierre is judged as any other');
  assert.ok(!fs.existsSync(path.join(P.projectHome(dir).dir, 'next-prompt.md')), 'and leaves no handoff for a cut that did not cost it anything');
});
