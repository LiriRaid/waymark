// Waymark 2.0.20 · point 17(b), decision 5 (the user's choice A, 2026-10-29): the context brake never stops a prompt. Past its size or after an idle stretch it advises, once per
// step, and saves the job's state in .waymark/ first, so a prompt with screenshots is never rejected. WAYMARK_BRAKE_MODE=block keeps the old stop for whoever wants it.
// Synthetic copy of the real pattern (ADR 0042). Run: node --test tests/brake-advice.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-brakeadvice-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
delete process.env.WAYMARK_BRAKE_MODE;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { brake } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);

const repo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-brake-')); temps.push(d);
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  return d;
};
const hook = (cwd, session, prompt = 'sigue con el siguiente paso') => ({ cwd, session_id: session, prompt });

test('17b: past 300k a prompt is advised, never stopped, and the advice says the work is saved; once per step', () => {
  const d = repo(), state = path.join(home, 'brake-a.json');
  assert.equal(brake(hook(d, 's1'), claude, { context: 299999 }, state), null, 'below the size: nothing');
  const told = brake(hook(d, 's1'), claude, { context: 300000 }, state);
  assert.equal(told.block, undefined, 'a prompt is never stopped');
  assert.match(told.line, /~300k tokens[\s\S]*a new session is cheaper[\s\S]*saved in \.waymark\//);
  assert.equal(brake(hook(d, 's1'), claude, { context: 310000 }, state), null, 'once per step');
  assert.match(brake(hook(d, 's1'), claude, { context: 400000 }, state).line, /~400k tokens/, 'and again at the next step');
});

test('17b: the state of an open job is on disk when the advice is given (tasks.md names it); a prompt with images is never held', () => {
  const d = repo(), state = path.join(home, 'brake-b.json');
  P.markOpen(d, 's2', 'construye el módulo de pedidos con las seis pantallas del diseño');
  brake(hook(d, 's2'), claude, { context: 350000 }, state);
  const tasks = fs.readFileSync(path.join(d, '.waymark', 'tasks.md'), 'utf8');
  assert.match(tasks, /Started, not closed[\s\S]*construye el módulo de pedidos/, 'the open job is in tasks.md before anyone is asked to leave');
  assert.ok(!fs.existsSync(path.join(d, '.waymark', 'next-prompt.md')), 'the message is not taken from the session: it is being answered here');
});

test('17b: the idle brake advises too, with its reason; a task in progress hears it only past 500k', () => {
  const d = repo(), state = path.join(home, 'brake-c.json'), t0 = Date.parse('2026-10-15T10:00:00Z'), H = 3600000;
  const idle = brake(hook(d, 's3'), claude, { context: 150000, lastAt: t0 }, state, t0 + 2 * H);
  assert.equal(idle.block, undefined);
  assert.match(idle.line, /idle 2 h: its cache expired[\s\S]*a new session is cheaper/);
  P.markTaskStart('s4');
  assert.equal(brake(hook(d, 's4'), claude, { context: 450000 }, state), null, 'a task in progress under 500k continues untouched');
  const mid = brake(hook(d, 's4'), claude, { context: 650000 }, state);
  assert.equal(mid.block, undefined);
  assert.match(mid.line, /~650k tokens/);
  P.clearTaskStart('s4');
});

test('17b: WAYMARK_BRAKE_MODE=block keeps the old stop for whoever asks for it', () => {
  const d = repo(), state = path.join(home, 'brake-d.json');
  process.env.WAYMARK_BRAKE_MODE = 'block';
  try { assert.equal(brake(hook(d, 's5'), claude, { context: 300000 }, state).block.decision, 'block'); } finally { delete process.env.WAYMARK_BRAKE_MODE; }
});
