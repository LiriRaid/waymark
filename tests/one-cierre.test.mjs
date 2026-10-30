// Waymark 2.0.20 · point 31: one Cierre per task. The first real task of checkpoint B showed four Cierre-like messages and two blocks: a Cierre written while the
// review ran, then a block per turn. Every case is a synthetic copy of that run. Run: node --test tests/one-cierre.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-one-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-one-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  gitT(d, 'add', '-A'); gitT(d, 'commit', '-q', '-m', 'base');
  return d;
};
const hookRun = (script, payload, { wait = 60000 } = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, wait);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  c.stdin.end(JSON.stringify(payload));
});

const at = (ms = 0) => new Date(Date.now() + ms).toISOString();
const prompt = (text, when = at()) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: when, message: { role: 'user', content: text } });
const say = (text, when = at()) => ({ type: 'assistant', timestamp: when, message: { content: [{ type: 'text', text }] } });
let ids = 0;
const call = (name, input, when = at()) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: when, message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: when, message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
const launch = (toolUseId, agentId) => ({ type: 'user', timestamp: at(), toolUseResult: { isAsync: true, agentId }, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'launched' }] } });
const CIERRE = (id = '2026-10-30 · T1') => `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y`;
const FILE = 'src/orders.service.mjs';
const blocked = (r) => /"decision":"block"/.test(r.out);

const stopper = (dir, session) => {
  const transcript = path.join(dir, `${session}.jsonl`);
  return async (last, { active = false, extra = [] } = {}) => {
    fs.writeFileSync(transcript, [prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend'), ...call('Edit', { file_path: path.join(dir, FILE) }), ...extra, say(last)].map((l) => JSON.stringify(l)).join('\n') + '\n');
    return hookRun('stop-hook.mjs', { transcript_path: transcript, cwd: dir, session_id: session, last_assistant_message: last, stop_hook_active: active });
  };
};
const recordsOf = (dir) => P.readRecords(P.projectHome(dir).log);

test('31: a task is blocked once; the next turn that still lacks proofs is recorded in red, not blocked', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'one-block');
  assert.ok(blocked(await stop(CIERRE())), 'the first close lacks the review and the build: blocked');
  const again = await stop(CIERRE());
  assert.ok(!blocked(again), 'a second chain of the same task is not blocked');
  const rec = recordsOf(dir).find((r) => r.id);
  assert.ok(rec, 'the task is recorded');
  assert.ok(Object.values(rec.evaluation.steps).includes(false), 'what is still missing is red in the record: ' + JSON.stringify(rec.evaluation.steps));
  assert.ok((rec.findings || []).some((f) => /already blocked once/.test(f)), JSON.stringify(rec.findings));
  assert.ok((rec.unresolved || []).some((m) => /review|build/.test(m)), 'the record keeps what was left unresolved: ' + JSON.stringify(rec.unresolved));
});

test('31: counter-example — a reply with no Cierre is still blocked after the task used its block, and a new task has its block again', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'one-no-cierre');
  assert.ok(blocked(await stop(CIERRE())), 'first block');
  assert.ok(blocked(await stop('Listo, terminé el cambio.')), 'no Cierre: the task cannot end without one');
  const later = stopper(dir, 'one-no-cierre');
  await later(CIERRE()); // closes the task: its record is written and its block count ends with it
  assert.ok(blocked(await later(CIERRE('2026-10-30 · T2'))), 'a new task in the session starts with its block unspent');
});

test('31: a Cierre written while a review still runs in the background is deferred, not judged and not blocked; the closing turn judges it', async () => {
  const dir = tmpRepo({ [FILE]: 'x\n' }), stop = stopper(dir, 'one-wait');
  const bg = [...call('Agent', { run_in_background: true }), launch(`toolu_bg${ids}`, 'bg1')];
  bg[1] = launch(bg[0].message.content[0].id, 'bg1');
  const waiting = await stop(CIERRE().replace('hecho', 'parcial (la revisión sigue corriendo)'), { extra: bg });
  assert.ok(!blocked(waiting), 'no block while the review runs, even with a Cierre in the reply');
  assert.match(waiting.out, /se evaluará cuando termine la tarea en segundo plano/);
  assert.ok(!recordsOf(dir).some((r) => r.id), 'and no task is closed by it');
});

// ---- 2.0.20 point 32: more than 4 decisions or review findings are all asked, in calls of 4; the rule lives where the agent reads it before its first window ----
test('32: the instructions block says it, stays within its size, and says the block is once per task; the L2 protocol carries the review rule', () => {
  const block = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'instructions.md'), 'utf8');
  assert.match(block, /Over 4 items \(decisions, review findings\): list all, then calls of 4 until each is answered; never drop one/);
  assert.match(block, /blocks once per task naming the way out/);
  assert.ok(block.length <= 6500, `the block stays within its size (${block.length})`);
  const l2 = fs.readFileSync(path.join(SCRIPTS, '..', 'references', 'protocol', 'l2.md'), 'utf8');
  assert.match(l2, /Its findings are the user's to decide, all of them/);
  assert.match(l2, /"apply all recommended" or "one by one"/);
  assert.match(l2, /you never filter which are asked/);
});
