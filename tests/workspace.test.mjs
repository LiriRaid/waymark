// Waymark 2.0.19 · point 7: the link between sessions of sibling projects. The per-prompt hook adds one line when a sibling project closed a
// task or opened a turn since this session's previous prompt, and nothing otherwise. Synthetic copies of the pattern: a logic case, a CSS/HTML
// case and the counter-examples for each. Run: node --test tests/workspace.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
process.env.WAYMARK_BRAKE_MODE = 'block'; // the cases here are the brake that stops a prompt (opt-in now); the default advice is tests/brake-advice.test.mjs
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

// ---- 7 · the handoff file: .waymark/next-prompt.md carries the ✔/▶ steps for whoever starts next, any agent or account ----
const { writeRelay, readRelay } = P;
const { heldPrompt } = await import(`file://${SCRIPTS}/session-hook.mjs`);
const rec = (id, result, aprendido, extra = {}) => ({ id, agent: 'claude', at: iso(Date.now()), outcome: { result }, cierre: `## Cierre · ${id}\nResultado: ${result}\nEvidencia: inferida\nAprendido: ${aprendido}`, ...extra });
const card = (cwd) => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd }), encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout).hookSpecificOutput.additionalContext;
const relayFile = (repo) => path.join(P.projectHome(repo).dir, 'next-prompt.md');

test('7: logic — an L3 close with steps leaves a handoff the next session\'s card shows, and reading it does not consume it', () => {
  const { api } = workspace(), h = P.projectHome(api);
  assert.equal(writeRelay(h, rec('2026-10-25 · T4', 'hecho', 'el servicio ya no consulta dos veces ← pasos ✔1 · ▶2 · 3 (falta el controlador y su spec)')), 'written');
  assert.match(fs.readFileSync(relayFile(api), 'utf8'), /^<!-- handoff /, 'the file says what it is');
  const text = readRelay(h);
  assert.match(text, /T4/);
  assert.match(text, /▶2/);
  assert.ok(text.length <= 600, 'a handoff, not a record');
  assert.match(card(api), /Handoff[^\n]*T4[^\n]*▶2/, 'the card brings it');
  assert.equal(heldPrompt(h), '', 'the brake\'s reader does not take a handoff for the user\'s held message');
  assert.ok(fs.existsSync(relayFile(api)), 'it stays for the next session, whichever agent opens it');
});

test('7: the card\'s handoff is bounded and keeps the next step; the last close does not repeat an Aprendido the handoff carries', () => {
  const { api } = workspace(), h = P.projectHome(api);
  const long = `${'el detalle de lo que pasó con la medida y sus causas, '.repeat(6)}Siguiente: firmar el tag ▶2`;
  P.appendRecord(api, rec('2026-10-25 · T5', 'parcial', long));
  writeRelay(h, rec('2026-10-25 · T5', 'parcial (falta firmar el tag y empujarlo al remoto, y el PR del usuario a main con su revisión)', long));
  const line = card(api).split('\n').find((l) => l.startsWith('Handoff'));
  assert.ok(line.length <= 340, `bounded: ${line.length}`);
  assert.match(line, /Siguiente: firmar el tag ▶2 \(whole: \.waymark\/next-prompt\.md\)$/, 'the tail, with the next step, stays');
  const last = card(api).split('\n').find((l) => l.startsWith('Last closed'));
  assert.doesNotMatch(last, /el detalle/, 'the Aprendido is in the handoff, not twice');
  writeRelay(h, rec('2026-10-25 · T5', 'parcial', 'corto ▶2'));
  assert.doesNotMatch(card(api), /whole: \.waymark\/next-prompt\.md/, 'counter-example: a short handoff is shown whole');
});

test('7: CSS/HTML — a parcial style-only task leaves what is missing', () => {
  const { web } = workspace(), h = P.projectHome(web);
  assert.equal(writeRelay(h, rec('2026-10-25 · T2', 'parcial (falta el estado hover en el .html)', 'el botón móvil ya mide 390 ← falta el hover', { files: ['button.component.css', 'button.component.html'] })), 'written');
  assert.match(readRelay(h), /falta el estado hover/);
});

test('7: counter-examples — a clean close writes none and clears a stale one; a held message is never overwritten; an old handoff is not shown', () => {
  const { api } = workspace(), h = P.projectHome(api);
  assert.equal(writeRelay(h, rec('2026-10-25 · T1', 'hecho', 'un cambio de una línea ← sin pasos')), '', 'nothing to hand over');
  assert.ok(!fs.existsSync(relayFile(api)));
  writeRelay(h, rec('2026-10-25 · T2', 'parcial (falta el spec)', 'avance ← ▶2'));
  assert.equal(writeRelay(h, rec('2026-10-25 · T3', 'hecho', 'otra tarea ← sin pasos')), '', 'another task\'s clean close leaves the steps for whoever starts next');
  assert.ok(fs.existsSync(relayFile(api)));
  assert.equal(writeRelay(h, rec('2026-10-25 · T2b', 'hecho', 'terminado ← todo ✔')), 'removed', 'the close of the task it is about takes it away');
  assert.ok(!fs.existsSync(relayFile(api)));
  fs.writeFileSync(relayFile(api), '<!-- 2026-10-25T10:00:00Z · held by the context brake (~320k) · session s1 -->\nagrega un buscador al FAQ\n');
  assert.equal(writeRelay(h, rec('2026-10-25 · T4', 'parcial (falta)', 'a ← ▶1')), 'kept', 'the user\'s own words win');
  assert.match(fs.readFileSync(relayFile(api), 'utf8'), /buscador al FAQ/);
  fs.rmSync(relayFile(api));
  writeRelay(h, rec('2026-10-25 · T5', 'parcial (falta)', 'a ← ▶1'));
  assert.equal(readRelay(h, Date.now() + 8 * 86400000), '', 'a week-old handoff is another cycle\'s');
});

// the whole path: the end-of-turn hook of a real close writes the handoff, the next session's card shows it
let calls = 0;
for (const [kind, file] of [['logic', 'src/orders.service.ts'], ['css/html', 'src/shared/button.css']]) {
  test(`7: ${kind} — the end-of-turn hook leaves the handoff of a task that closes with steps, and the next card shows it`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-relay-')); temps.push(dir); gitT(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, '.waymark')); fs.writeFileSync(path.join(dir, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
    fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), 'a\n');
    gitT(dir, 'add', '-A'); gitT(dir, 'commit', '-qm', 'base'); fs.writeFileSync(path.join(dir, file), 'b\n');
    const at = new Date().toISOString(), id = P.taskIds(dir).next, transcript = path.join(dir, 't.jsonl');
    const tool = { type: 'tool_use', id: `u${++calls}`, name: 'Edit', input: { file_path: path.join(dir, file) } };
    fs.writeFileSync(transcript, [
      { type: 'user', uuid: 'p1', timestamp: at, message: { role: 'user', content: 'ajusta el archivo' } },
      { type: 'assistant', timestamp: at, message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-frontend' }] } },
      { type: 'assistant', timestamp: at, message: { content: [tool] } },
      { type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: tool.id, content: 'ok' }] } },
    ].map((l) => JSON.stringify(l)).join('\n') + '\n');
    await new Promise((resolve) => {
      const c = spawn(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
      c.on('close', resolve);
      c.stdin.end(JSON.stringify({ transcript_path: transcript, cwd: dir, session_id: `s-relay-${kind}`, stop_hook_active: true, last_assistant_message: `## Cierre · ${id}\nResultado: parcial (falta el spec)\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: el ajuste está hecho ← pasos ✔1 · ▶2 · 3` }));
    });
    assert.match(fs.readFileSync(relayFile(dir), 'utf8'), /Relevo de [\s\S]*▶2/, 'the close wrote it');
    assert.match(card(dir), /Handoff[^\n]*▶2/, 'and the next session\'s card carries it');
  });
}

test('7: the context brake keeps a handoff behind the held message, and the card takes the message and leaves the handoff', async () => {
  const { brake } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
  const { api } = workspace(), h = P.projectHome(api);
  writeRelay(h, rec('2026-10-25 · T2', 'parcial (falta el spec)', 'avance ← ✔1 · ▶2'));
  const agent = { out: { blockPrompt: (m) => ({ block: m }) } };
  const held = brake({ session_id: 's-brake', cwd: api, prompt: 'agrega un buscador al FAQ' }, agent, { context: 400000, lastAt: Date.now() }, path.join(home, 'brake-ws.json'));
  assert.ok(held?.block, 'the message is held');
  assert.equal(heldPrompt(h), 'agrega un buscador al FAQ', 'the card brings the user\'s message');
  assert.match(readRelay(h), /▶2/, 'and the handoff survived it');
  assert.equal(heldPrompt(h), '', 'nothing else is held');
});
