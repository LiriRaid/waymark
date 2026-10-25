// Waymark 2.0.19 · point 4: the procedure is handed, not remembered. The hook hands the section of the department the task is routed to (the
// routing line, or a re-route by Skill call), a session that changes department gets the new one, and a task that changed no file owes none.
// Synthetic copies of the patterns: a logic case, a CSS/HTML case and the counter-example for each. Run: node --test tests/procedure.test.mjs
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
process.env.WAYMARK_ENGRAM = '';
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { packContext } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { procDelivered } = await import(`file://${SCRIPTS}/lib/packed.mjs`);
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);
const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const repo = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-proc-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark')); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  gitT(d, 'add', '-A'); gitT(d, 'commit', '-q', '-m', 'base');
  return d;
};
let ids = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
const transcript = (dir, lines) => { const f = path.join(dir, `t${++ids}.jsonl`); fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); return f; };
const edit = (dir, file, session, lines, state) => packContext({ cwd: dir, session_id: session, tool_name: 'Edit', tool_input: { file_path: path.join(dir, file) }, transcript_path: transcript(dir, lines) }, claude, state);
const handed = (text) => [...String(text || '').matchAll(/Waymark procedures of (dept-[\w-]+)/g)].map((m) => m[1]);

// ---- the department of the route, not the last one the session loaded ----
for (const [kind, file, now, before] of [['logic', 'src/orders.service.mjs', 'dept-backend', 'dept-frontend'], ['CSS/HTML', 'src/app.css', 'dept-frontend', 'dept-backend']]) {
  test(`4: ${kind} — a ${now} task after a ${before} one in the same session is handed ${now}'s section, though only the line routed it`, async () => {
    const d = repo({ [file]: 'a\n' }), state = path.join(d, 'packed.json');
    const earlier = [prompt('primera tarea'), say(`Waymark → L2 · ${before}`), ...call('Skill', { skill: before })];
    const lines = [...earlier, prompt('segunda tarea'), say(`Waymark → L2 · ${now} · skills: ninguna`)];
    const text = await edit(d, file, `s-route-${kind}`, lines, state);
    assert.deepEqual(handed(text), [now], 'the routed department\'s section, not the loaded one\'s');
    assert.ok(procDelivered(`s-route-${kind}`, 0, state).has(now));
    // counter-example: the line is not in the transcript yet (it lags a second or two): the department the session loaded stands in
    const d2 = repo({ [file]: 'a\n' }), state2 = path.join(d2, 'packed.json');
    const lagging = await edit(d2, file, `s-lag-${kind}`, [...earlier, prompt('segunda tarea')], state2);
    assert.deepEqual(handed(lagging), [before], 'until the line shows, the last department invoked');
  });
}
test('4: a department change in the middle of a task hands the new section too, once each', async () => {
  const d = repo({ 'src/a.mjs': 'a\n', 'src/b.css': 'b\n' }), state = path.join(d, 'packed.json');
  const base = [prompt('arregla el servicio y el estilo'), say('Waymark → L2 · dept-backend')];
  assert.deepEqual(handed(await edit(d, 'src/a.mjs', 's-mid', base, state)), ['dept-backend']);
  const rerouted = [...base, ...call('Skill', { skill: 'dept-frontend', args: 'L2' })];
  assert.deepEqual(handed(await edit(d, 'src/b.css', 's-mid', rerouted, state)), ['dept-frontend'], 'the new department\'s section');
  fs.writeFileSync(path.join(d, 'src', 'c.mjs'), 'c\n');
  assert.deepEqual(handed(await edit(d, 'src/c.mjs', 's-mid', rerouted, state)), [], 'counter-example: a section already handed in this task is not handed again');
  assert.deepEqual([...procDelivered('s-mid', 0, state)].sort(), ['dept-backend', 'dept-frontend']);
});

// ---- the procedure is owed only to a task that changed a file ----
const judged = (lines, ctx = {}) => cierreGaps(currentTurn(lines), '## Cierre · 2026-10-25 · T1\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el log)\nAprendido: x ← y', undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [], outside: true, cwd: '/work/proj', ...ctx });
const proc = (g) => g.steps.find((s) => s.id === 'procedure');
test('4: logic — a task that changed no file is not asked for its procedure; one that changed a file and never got it still is', () => {
  const noFile = judged([prompt('sube el cambio'), say('Waymark → L2 · dept-devops'), ...call('Bash', { command: 'git push origin develop' })]);
  assert.equal(proc(noFile).applies, false, 'no file changed: nothing to guide');
  const changed = judged([prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend'), ...call('Edit', { file_path: '/work/proj/src/orders.service.mjs' })]);
  assert.equal(proc(changed).applies, true);
  assert.equal(proc(changed).pass, false, 'counter-example: a task whose section could not be handed is still flagged');
  const handedOne = judged([prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend'), ...call('Skill', { skill: 'dept-backend' }), ...call('Edit', { file_path: '/work/proj/src/orders.service.mjs' })], { procDelivered: ['dept-backend'] });
  assert.equal(proc(handedOne).pass, true, 'handed by the hook: it counts as read');
});
test('4: CSS/HTML — the same for a styles task: handed it passes, none handed it is flagged, a task that changed nothing owes none', () => {
  const css = (ctx) => judged([prompt('ajusta el margen'), say('Waymark → L1 · dept-frontend'), ...call('Skill', { skill: 'dept-frontend' }), ...call('Edit', { file_path: '/work/proj/src/app.css' })], ctx);
  assert.equal(proc(css({ procDelivered: ['dept-frontend'] })).pass, true);
  assert.equal(proc(css({})).pass, false, 'counter-example: nothing handed, nothing read');
  const none = judged([prompt('revisa el margen'), say('Waymark → L1 · dept-frontend'), ...call('Bash', { command: 'git push' })]);
  assert.equal(proc(none).applies, false);
});
