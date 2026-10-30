// Waymark 2.0.20 · point 17(c): a turn the hook deferred (a review still running in the background) or could not judge is listed in tasks.md until a later close of its session
// covers it, instead of being left blank. Synthetic copy of the real records (ADR 0042). Run: node --test tests/unjudged.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-unjudged-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { tasksMarkdown } = await import(`file://${SCRIPTS}/provenance/taskmd.mjs`);

const repo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-uj-')); temps.push(d);
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  return d;
};
const at = (min) => new Date(Date.parse('2026-10-29T10:00:00Z') + min * 60000).toISOString();
const deferred = (d, session, prompt, min, cause = 'unevaluated:deferred: a background task is still running') => P.appendRecord(d, { kind: 'unevaluated', cause, agent: 'claude', at: at(min), session, cwd: d, prompt, files: ['src/orders.service.mjs'] });
const close = (d, session, id, min) => P.appendRecord(d, { schema: 'waymark.record/v2', id, agent: 'claude', at: at(min), session, cwd: d, level: 2, prompt: 'p', cierre: `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada ok\nAprendido: x ← y`, inputs: { waymark: '2.0.19' }, outcome: { result: 'hecho' } });
const md = (d) => tasksMarkdown(P.projectHome(d), new Date(at(600)));

test('17c: a deferred or unjudged turn that no later close of its session covers is listed with its prompt and its cause', () => {
  const d = repo();
  deferred(d, 's1', 'revisa el módulo de pedidos y aplica los hallazgos', 0);
  const out = md(d);
  assert.match(out, /## Started, not closed[\s\S]*not evaluated[\s\S]*revisa el módulo de pedidos y aplica los hallazgos[\s\S]*a background task is still running/);
});

test('17c: counter-examples — a close of the same session after it covers it; another session\'s close does not; only the newest four are shown', () => {
  const d = repo();
  deferred(d, 's1', 'primer turno diferido', 0);
  close(d, 's1', '2026-10-29 · T1', 5);
  assert.ok(!/primer turno diferido/.test(md(d)), 'the session closed after it: evaluated with its turn');
  deferred(d, 's2', 'turno de otra sesión', 10);
  close(d, 's1', '2026-10-29 · T2', 15);
  assert.match(md(d), /turno de otra sesión/, 'a close of another session says nothing about this one');
  for (let i = 0; i < 6; i++) deferred(d, `x${i}`, `diferido número ${i}`, 20 + i);
  const shown = (md(d).match(/^- not evaluated ·/gm) || []).length;
  assert.equal(shown, 4, 'the newest four, not a wall of rows');
  assert.match(md(d), /diferido número 5/);
  assert.ok(!/diferido número 0/.test(md(d)));
});
