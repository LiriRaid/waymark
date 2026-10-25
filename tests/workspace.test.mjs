// Waymark 2.0.19 · point 7: the link between sessions of sibling projects. The per-prompt hook adds one line when a sibling project closed a
// task or opened a turn since this session's previous prompt, and nothing otherwise. Synthetic copies of the pattern: a logic case, a CSS/HTML
// case and the counter-examples for each. Run: node --test tests/workspace.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-ws-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { siblingsLine } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
// a workspace folder holding two projects with memory, as an API and its FE are laid out
const workspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ws-')); temps.push(root);
  const ws = path.join(root, 'shop-workspace'), made = {};
  for (const name of ['api', 'web']) {
    const d = path.join(ws, name);
    fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); gitT(d, 'init', '-q');
    fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
    made[name] = d;
  }
  return made;
};
const MIN = 60000, T0 = Date.parse('2026-10-25T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const close = (repo, id, at, files, learned, agent = 'claude') => P.appendRecord(repo, { id, agent, at: iso(at), session: `s-${id}`, files, outcome: { result: 'hecho' }, cierre: `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida\nAprendido: ${learned}` });
let n = 0;
const sess = () => `s-ws-${++n}`;
const state = () => path.join(home, `siblings-${++n}.json`);

test('7: logic — a sibling that closed a task since the previous prompt is named once, with its Aprendido', () => {
  const { api, web } = workspace(), session = sess(), file = state();
  assert.equal(siblingsLine(web, session, { now: T0, stateFile: file }), '', 'the first prompt of a session only notes the time: the card already showed the workspace');
  close(api, '2026-10-25 · T3', T0 + 2 * MIN, ['src/orders.service.ts', 'src/orders.service.spec.ts'], 'el total se calcula en el servicio ← el FE lo recibe ya sumado');
  const line = siblingsLine(web, session, { now: T0 + 5 * MIN, stateFile: file });
  assert.match(line, /api/, 'names the sibling');
  assert.match(line, /T3/, 'names the task it closed');
  assert.match(line, /el total se calcula en el servicio/, 'carries what it learned');
  assert.ok(line.length < 400, 'about 60 tokens, never a record');
  assert.equal(siblingsLine(web, session, { now: T0 + 6 * MIN, stateFile: file }), '', 'nothing new since: it costs nothing');
});

test('7: CSS/HTML — the same for a task that only changed a style and a template', () => {
  const { api, web } = workspace(), session = sess(), file = state();
  siblingsLine(api, session, { now: T0, stateFile: file });
  close(web, '2026-10-25 · T1', T0 + MIN, ['src/app/shared/button/button.component.css', 'src/app/shared/button/button.component.html'], 'el botón ocupa todo el ancho en móvil ← la clase .wide ganaba por especificidad');
  const line = siblingsLine(api, session, { now: T0 + 3 * MIN, stateFile: file });
  assert.match(line, /web/);
  assert.match(line, /T1/);
  assert.match(line, /especificidad/);
});

test('7: counter-example — a task a sibling closed before the previous prompt is not repeated, nor is one from another day', () => {
  const { api, web } = workspace(), session = sess(), file = state();
  close(api, '2026-10-25 · T1', T0 - 30 * MIN, ['a.ts'], 'viejo ← ya contado');
  siblingsLine(web, session, { now: T0, stateFile: file });
  assert.equal(siblingsLine(web, session, { now: T0 + MIN, stateFile: file }), '', 'closed before the previous prompt: the previous line or the card had it');
  close(api, '2026-10-25 · T2', T0 + 2 * MIN, ['b.ts'], 'nuevo ← sí');
  assert.match(siblingsLine(web, session, { now: T0 + 3 * MIN, stateFile: file }), /T2/);
  assert.doesNotMatch(siblingsLine(web, session, { now: T0 + 4 * MIN, stateFile: file }), /T2/, 'said once');
  assert.equal(siblingsLine(web, sess(), { now: T0 + 5 * MIN, stateFile: file }), '', 'another session starts from its own prompt, not this one\'s');
});

test('7: a sibling\'s open turn is said as "T<n> en curso", once, and a stale one not at all', () => {
  const { api, web } = workspace(), session = sess(), file = state();
  siblingsLine(web, session, { now: T0, stateFile: file });
  P.markOpen(api, 's-api', 'agrega el campo total', new Date(T0 + 2 * MIN), 'codex');
  const line = siblingsLine(web, session, { now: T0 + 3 * MIN, stateFile: file });
  assert.match(line, /api/);
  assert.match(line, /T\d+ en curso/, 'says where the sibling is');
  assert.doesNotMatch(line, /agrega el campo total/, 'the prompt of another project is not carried');
  assert.equal(siblingsLine(web, session, { now: T0 + 4 * MIN, stateFile: file }), '', 'the same open turn is not repeated');
  const { api: api2, web: web2 } = workspace(), s2 = sess(), f2 = state();
  siblingsLine(web2, s2, { now: T0 + 6 * 3600000, stateFile: f2 });
  P.markOpen(api2, 's-old', 'abandonado', new Date(T0), 'claude');
  assert.equal(siblingsLine(web2, s2, { now: T0 + 7 * 3600000, stateFile: f2 }), '', 'an open turn older than two hours was interrupted: not news');
});

test('7: counter-example — a project outside a workspace, or beside a sibling with no memory, has no line', () => {
  const lone = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-lone-')); temps.push(lone);
  fs.mkdirSync(path.join(lone, '.waymark')); fs.writeFileSync(path.join(lone, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  const file = state(), session = sess();
  siblingsLine(lone, session, { now: T0, stateFile: file });
  assert.equal(siblingsLine(lone, session, { now: T0 + MIN, stateFile: file }), '');
});

test('7: the per-prompt hook carries the line in what it hands the model, and a broken state file only drops it', async () => {
  const { api, web } = workspace(), session = sess();
  const run = (cwd, prompt) => new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.on('close', () => resolve(out));
    c.stdin.end(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt, cwd, session_id: session }));
  });
  await run(web, 'primer prompt');
  close(api, '2026-10-25 · T9', Date.now() + 1000, ['x.ts'], 'el contrato cambió ← el FE lo lee');
  const out = await run(web, 'segundo prompt');
  assert.match(out, /Workspace/, 'the line reaches the model');
  assert.match(out, /T9/);
  fs.writeFileSync(path.join(home, '.siblings.json'), '{not json');
  assert.doesNotMatch(await run(web, 'tercer prompt'), /Error|undefined/, 'a broken state file never breaks the prompt');
});
