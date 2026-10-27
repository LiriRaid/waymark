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
const tool = (name, input, out = 'ok') => { const id = `u${++calls}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out }] } }]; };
// the other real shape: the harness tells the model in the middle of the turn, as a meta user message, and the model goes on for a short grace
const NOTICE = { type: 'user', isMeta: true, usageLimitNote: 'wrap_up', timestamp: at(), message: { role: 'user', content: [{ type: 'text', text: "[Usage limit reached; a short grace allowance remains, then this turn is cut off without warning. Judge what's left.]" }] } };
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

test('12: the grace notice in the middle of the turn (a meta user message with usageLimitNote) is a usage limit too, whatever the model says after it', () => {
  const edit = tool('Edit', { file_path: '/work/a.ts' }).flat();
  const s = externalStop([prompt('x'), ...edit, NOTICE, say('Resultado: parcial. No alcanzo a correr los tests.')]);
  assert.deepEqual([s?.cause, s?.grace], ['usage limit', true], JSON.stringify(s));
  assert.equal(externalStop([prompt('x'), { ...NOTICE, usageLimitNote: undefined }, say('ok')])?.cause, 'usage limit', 'the text alone, in a meta message, is the notice');
  assert.equal(externalStop([prompt('x'), NOTICE, say('ok'), prompt('sigue'), say('listo')]), null, 'counter-example: a notice of an earlier turn excuses nothing');
  assert.equal(externalStop([prompt('[Usage limit reached; esto lo escribí yo]'), say('ok')]), null, 'counter-example: the user typing the words is a prompt, not the notice');
  assert.equal(externalStop([prompt('x'), ...tool('Bash', { command: 'cat log' }, '[Usage limit reached; from a log]').flat(), say('ok')]), null, 'counter-example: a tool result with the words is not the notice');
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
  const lines = [prompt('ajusta el archivo y deja los tests en verde'), say('Waymark → L2 · dept-backend'), ...tool('Skill', { skill: 'dept-backend' }), ...tool('Edit', { file_path: path.join(dir, file) }), ...(spec ? tool('Bash', { command: 'pnpm exec vitest run a.spec.ts' }, spec === 'red' ? ' FAIL  src/a.spec.ts > a > works\n Tests  1 failed | 3 passed (4)' : ' Tests  4 passed (4)') : []), ...ending];
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

// a model's own answer before the cut, as the transcript has it
const answer = (text, model = 'claude-sonnet-5-5') => ({ type: 'assistant', timestamp: at(), message: { model, usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'text', text }] } });
for (const [kind, file] of [['logic', 'src/orders.service.ts'], ['css/html', 'src/app/shared/button.component.scss']]) {
  test(`12: ${kind} — the cut record names the model that worked and each step it would have judged as n/a, never 0/0 or <synthetic>`, async () => {
    const { records } = await session(file, [answer('sigo con el archivo'), LIMIT]);
    const rec = records.find((r) => r.id);
    assert.equal(rec.evaluation.model, 'claude-sonnet-5-5', 'the harness notice is no model');
    assert.equal(rec.inputs.model, 'claude-sonnet-5-5');
    assert.match(rec.evaluation.score, /^n\/a \(cut: usage limit\)$/);
    const steps = Object.values(rec.evaluation.steps);
    assert.ok(steps.length > 0 && steps.every((v) => v === 'na'), JSON.stringify(rec.evaluation.steps));
    const { incidents } = await import(`file://${SCRIPTS}/incidents.mjs`);
    const failed = { id: '2026-10-26 · T0', evaluation: { steps: Object.fromEntries(Object.keys(rec.evaluation.steps).map((k) => [k, false])) } };
    assert.equal(incidents([failed, rec]).open.length, Object.keys(rec.evaluation.steps).length, 'an n/a step neither opens nor closes an incident');
  });
}
test('12: counter-example — a turn that was not cut keeps its score as passed/applied and its steps as ✔/✘', async () => {
  const { evaluate } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const steps = [{ label: 'Cierre', applies: true, pass: true }, { label: 'Verificar', applies: true, pass: false }, { label: 'Revisar', applies: false, pass: null, na: 'usage limit' }];
  const ev = evaluate({ steps }, { total: 0 }, 'claude-sonnet-5-5');
  assert.equal(ev.score, '1/2');
  assert.deepEqual(ev.steps, { Cierre: true, Verificar: false }, 'a step that did not apply stays out, even with an na of its own');
});

for (const [kind, file] of [['logic', 'src/orders.service.ts'], ['css/html', 'src/app/shared/button.component.html']]) {
  test(`12: ${kind} — the real grace notice, then the model ends with no Cierre: no block, parcial(usage limit), a handoff`, async () => {
    const { dir, out, records } = await session(file, [NOTICE, say('Resultado: parcial. No pude cumplir los puntos del hook porque se acaba el límite.')]);
    assert.ok(!/"decision":"block"|"continue":false/.test(out), `no block: ${out.slice(0, 200)}`);
    const rec = records.find((r) => r.id);
    assert.deepEqual([rec?.outcome?.result, rec?.outcome?.cause], ['parcial', 'external']);
    assert.match(rec.outcome.why, /usage limit/);
    const relay = fs.readFileSync(path.join(P.projectHome(dir).dir, 'next-prompt.md'), 'utf8');
    assert.match(relay, new RegExp(path.basename(file).replace(/\./g, '\\.')));
    assert.ok(!relay.includes('grace allowance'), 'the quota notice itself is not copied');
  });
}

test('12: the grace notice and a Cierre that misses a testigo: judged and recorded as any other, but not blocked', async () => {
  const { out, records } = await session('src/a.ts', [NOTICE, say('## Cierre · 2026-10-26 · T1\nResultado: hecho\nEvidencia: observada el archivo cambiado\nAprendido: x ← y')]);
  assert.ok(!/"decision":"block"|"continue":false/.test(out), `no block: ${out.slice(0, 300)}`);
  const rec = records.find((r) => r.id);
  assert.ok(rec, 'recorded');
  assert.notEqual(rec.outcome?.cause, 'external', 'its Cierre is judged, not excused');
});

test('12: counter-example — a real red spec after the change with no notice still blocks the close', async () => {
  const { out, records } = await session('src/a.ts', [say('## Cierre · 2026-10-26 · T1\nResultado: hecho\nEvidencia: observada la spec\nAprendido: x ← y')], { spec: 'red' });
  assert.match(out, /"decision":"block"/, 'the red spec is judged');
  assert.ok(!records.some((r) => r.outcome?.cause === 'external'));
});

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

// ---- M3 (2b, 2c): a turn the hook could not judge leaves a record that keeps its files, and that record is no close ----
test('2b: logic — a turn deferred for a background task leaves an unevaluated record with its files and a notice; the next turn still judges it', async () => {
  const bg = [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id: 'bg1', name: 'Agent', input: { prompt: 'review' } }] } },
    { type: 'user', timestamp: at(), toolUseResult: { isAsync: true, agentId: 'a1' }, message: { content: [{ type: 'tool_result', tool_use_id: 'bg1', content: 'launched' }] } }];
  const { out, records } = await session('src/orders.service.ts', [...bg, say('Lanzado el agente en segundo plano.')]);
  const rec = records.find((r) => r.kind === 'unevaluated');
  assert.ok(rec, JSON.stringify(records).slice(0, 200));
  assert.match(rec.cause, /deferred/);
  assert.ok((rec.files || []).some((f) => /orders\.service\.ts$/.test(f)), `its files: ${JSON.stringify(rec.files)}`);
  assert.match(out, /se evaluará cuando termine/);
  assert.ok(!records.some((r) => r.id), 'counter-example: no task closed by it');
});
test('2b: CSS/HTML — the record of a turn that crashed carries the files it changed', async () => {
  const { unevaluatedRecord } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const rec = unevaluatedRecord(new Error('boom'), { agent: 'claude', session: 's', cwd: '/w', files: ['/w/src/app.css', '/w/src/index.html'] });
  assert.deepEqual([rec.kind, rec.files], ['unevaluated', ['/w/src/app.css', '/w/src/index.html']]);
  assert.equal(unevaluatedRecord(new Error('boom'), { session: 's' }).files, undefined, 'counter-example: none known, none written');
});
test('2c: an unevaluated record is no close: the open turn keeps its snapshot; a task record closes it', async () => {
  const { stillOpen } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
  const open = { at: '2026-10-26T10:00:00Z' };
  assert.equal(stillOpen(open, [{ session: 's', kind: 'unevaluated', at: '2026-10-26T10:05:00Z' }], 's'), true);
  assert.equal(stillOpen(open, [{ session: 's', id: '2026-10-26 · T1', at: '2026-10-26T10:05:00Z' }], 's'), false, 'counter-example: a real close');
  assert.equal(stillOpen(null, [], 's'), false);
});
