// Waymark 2.0.19 · point 2 (2e, 2f): one request is one task, closed by the user's "sí"; a step the user owns never leaves it
// parcial; a parcial for a cause outside the work does not chain. Synthetic copies of the patterns: a logic case, a CSS/HTML case
// and the counter-example for each. Run: node --test tests/boundaries.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-bnd-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { outcome, ownedSteps, confirmAsk } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { taskLine, YES } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-bnd-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'));
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  return d;
};
const hookRun = (script, payload) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, 60000);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  c.stdin.end(JSON.stringify(payload));
});
const transcript = (dir, lastReply) => {
  const file = path.join(dir, 't.jsonl');
  const now = new Date().toISOString();
  fs.writeFileSync(file, [{ type: 'user', timestamp: now, message: { role: 'user', content: 'ajusta el botón' } }, { type: 'assistant', timestamp: now, message: { content: [{ type: 'text', text: lastReply }] } }].map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
};
// a closed task of the session, as the end-of-turn hook leaves it
const closed = (dir, session, { result = 'hecho', file = 'src/a.mjs', extra = {} } = {}) => {
  const rec = { id: '2026-10-25 · T1', agent: 'claude', at: new Date().toISOString(), session, cwd: dir, level: 2, files: [file], cierre: `## Cierre · 2026-10-25 · T1\nResultado: ${result}\nAprendido: x ← y`, outcome: { result }, ...extra };
  P.appendRecord(dir, rec);
  return rec;
};
const ask = (dir, session, text, reply = 'Listo. Cierre arriba.') => hookRun('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', prompt: text, cwd: dir, session_id: session, transcript_path: transcript(dir, reply) });

// ---- 2e · the user's "sí" closes the task and the model never reads it ----
for (const [kind, file] of [['logic', 'src/orders.service.mjs'], ['CSS/HTML', 'src/app.css']]) {
  test(`2e: ${kind} — a bare "sí" after a hecho confirms the task, blocks the prompt and starts no task; the question is asked at the close`, async () => {
    const dir = tmpRepo(), session = `s-yes-${kind}`;
    closed(dir, session, { file });
    assert.match(confirmAsk({ outcome: { result: 'hecho' } }), /¿Se completó lo que pediste\?/);
    const r = await ask(dir, session, 'sí');
    assert.match(r.out, /"decision":"block"[^}]*2026-10-25 · T1 confirmada como hecha/, 'the prompt is stopped before the model');
    assert.deepEqual(P.readRecords(P.projectHome(dir).log).filter((x) => x.kind === 'confirm').map((x) => x.confirmed), [['2026-10-25 · T1']], 'the confirmation is chained');
    assert.ok(!fs.existsSync(path.join(dir, '.waymark', 'open.json')), 'no task was started by it');
    assert.equal(confirmAsk({ outcome: { result: 'parcial' } }), '', 'counter-example: only a hecho asks');
    const again = await ask(dir, session, 'sí');
    assert.ok(!/confirmada como hecha/.test(again.out), 'counter-example: a second "sí" confirms nothing, it is an ordinary message');
  });
}
test('2e: a "sí" that is not about the task is an ordinary message', async () => {
  const dir = tmpRepo();
  closed(dir, 's-a');
  const no = async (text, session, reply) => assert.ok(!/confirmada como hecha/.test((await ask(dir, session, text, reply)).out), text);
  await no('sí, y además agrega el filtro', 's-a'); // more than a yes
  await no('sí', 's-a', 'Apliqué el cambio.\n\n¿Lo subo ahora?\n- Sí\n- No'); // the reply asked something else: the yes answers that
  await no('sí', 's-other'); // another session's task
  const parcial = tmpRepo();
  closed(parcial, 's-p', { result: 'parcial' });
  assert.ok(!/confirmada como hecha/.test((await ask(parcial, 's-p', 'sí')).out), 'a parcial is not confirmed by a sí');
});
test('2e: a task with a line left in Work in progress loses it when the user confirms; the record keeps their words', async () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n- ▶ [2026-10-25 · T1] falta revisar el ancho\n');
  closed(dir, 's-line');
  await ask(dir, 's-line', 'confirmo');
  assert.ok(!/T1/.test(fs.readFileSync(path.join(dir, '.waymark', 'memory.md'), 'utf8').split('## Work in progress')[1] || ''), 'the line left');
  assert.equal(P.readRecords(P.projectHome(dir).log).filter((x) => x.kind === 'confirm')[0].said, 'confirmo');
});

// ---- 2e · a step the user owns never leaves a task parcial ----
const CONV = '## Conventions specific to this project\n- Deploys: the user (2026-10-25: «yo despliego»)\n- Commits: by topic\n';
test('2e: logic — the user\'s deploy is the only thing left: the task is hecho, with the step named', () => {
  const owned = ownedSteps(CONV);
  assert.deepEqual([...owned], ['deploy']);
  const r = outcome('Resultado: parcial (falta desplegar el API)', [], [], 2, owned);
  assert.deepEqual([r.result, r.said, r.userOwned], ['hecho', 'parcial', ['deploy']]);
  assert.equal(outcome('Resultado: parcial (falta el endpoint de pedidos)', [], [], 2, owned).result, 'parcial', 'counter-example: a gap that is not the user\'s step');
  assert.equal(outcome('Resultado: parcial (falta desplegar)', [], [], 2, new Set()).result, 'parcial', 'counter-example: no rule of the user says the deploy is theirs');
});
test('2e: CSS/HTML — the same for a styles task whose only gap is the user\'s PR; an unanswered item keeps it parcial', () => {
  const owned = ownedSteps('- PRs: the user\n- Merge: el usuario\n');
  assert.deepEqual([...owned].sort(), ['merge', 'pr']);
  assert.equal(outcome('Resultado: parcial (falta abrir el PR con el ajuste del botón)', [], [], 1, owned).result, 'hecho');
  const items = ['ajustar el ancho', 'cambiar el color'];
  assert.equal(outcome('Resultado: parcial (falta el PR)\nPedido: ✔1 ancho · ✘2 el color no cambió', items, [{ n: 1, ok: true }, { n: 2, ok: false }], 2, owned).result, 'parcial', 'counter-example: an item of the ask is not done');
  assert.deepEqual([...ownedSteps('<!-- "- Deploys: the user" is how you write it -->\n- …\n')], [], 'the template\'s own example is no rule');
});

test('2e: a task whose only gap is the user\'s step leaves no ▶ line; the same Cierre without that rule keeps it', () => {
  const dir = tmpRepo();
  const rec = { id: '2026-10-25 · T2', cierre: '## Cierre · 2026-10-25 · T2\nResultado: parcial (falta desplegar)\nAprendido: el cambio queda listo ← el despliegue es tuyo', unresolved: [] };
  P.writeTaskLine(P.projectHome(dir), { ...rec, outcome: { result: 'hecho', userOwned: ['deploy'] } });
  assert.ok(!/T2/.test(fs.readFileSync(path.join(dir, '.waymark', 'memory.md'), 'utf8')));
  P.writeTaskLine(P.projectHome(dir), { ...rec, outcome: { result: 'parcial' } });
  assert.match(fs.readFileSync(path.join(dir, '.waymark', 'memory.md'), 'utf8'), /▶ \[2026-10-25 · T2\]/, 'counter-example');
});

// ---- 2f · a parcial for a cause outside the work does not chain ----
test('2f: logic — parcial by the usage limit is marked external; a parcial of the work is not', () => {
  assert.equal(outcome('Resultado: parcial (usage limit reached: faltan 5 de 13 pasos)', [], [], 2).cause, 'external');
  assert.equal(outcome('Resultado: parcial (se agotó la cuota del plan)', [], [], 2).cause, 'external');
  assert.equal(outcome('Resultado: parcial (falta el filtro por fecha)', [], [], 2).cause, undefined, 'counter-example: the work itself is missing');
});
for (const [kind, file] of [['logic', 'src/orders.service.mjs'], ['CSS/HTML', 'src/app.css']]) {
  test(`2f: ${kind} — after a parcial by an external cause the next ask is a new task unless the user says it continues`, () => {
    const dir = tmpRepo();
    closed(dir, 's-ext', { result: 'parcial', file, extra: { outcome: { result: 'parcial', cause: 'external' } } });
    const line = (prompt) => taskLine(dir, new Date(), { session: 's-ext', prompt });
    assert.ok(!/follow-up/.test(line('cambia el color del título')), 'an unrelated ask: no follow-up offered');
    assert.match(line('cambia el color del título'), /parcial for a cause outside the work/);
    assert.match(line('sigue con lo que quedó'), /follow-up 2026-10-25 · T1b/, 'the user says it continues');
    assert.match(line('termina T1 por favor'), /follow-up 2026-10-25 · T1b/, 'the user names it');
    const own = tmpRepo();
    closed(own, 's-own', { result: 'parcial', file });
    assert.match(taskLine(own, new Date(), { session: 's-own', prompt: 'sí, agrégalo', reply: 'Falta el filtro. ¿Lo agrego?' }), /follow-up 2026-10-25 · T1b/, 'counter-example: a parcial of the work still offers its follow-up to the answer');
    assert.match(taskLine(dir, new Date(), { session: 's-ext', prompt: 'sí, agrégalo', reply: '¿Lo agrego?' }), /parcial for a cause outside the work/, 'a cut reply is no question the user answers');
  });
}

// ---- re-close step 2 · a follow-up only for the same request or one that redoes it ----
for (const [kind, file, other, redo] of [['logic', 'src/orders.service.mjs', 'agrega el filtro por fecha a los pedidos', 'no funciona, sigue fallando el total'], ['CSS/HTML', 'src/app.css', 'cambia el color del título', 'no se ve el cambio en móvil']]) {
  test(`step 2: ${kind} — a different ask on the same files is a new task; continuing, redoing or answering the last reply is its follow-up`, () => {
    const dir = tmpRepo(), session = `s-follow-${kind}`;
    closed(dir, session, { file });
    const line = (prompt, reply = 'Listo.') => taskLine(dir, new Date(), { session, prompt, reply });
    assert.doesNotMatch(line(other), /follow-up/, 'a different subject: only the new ID');
    assert.doesNotMatch(line('Sigue con H4 del plan 2.0.19'), /follow-up/, '"sigue con" a new item is a new ask');
    for (const p of ['sigue', 'continúa por donde quedaste', 'disculpa se interrumpió, termina', redo, 'T1 otra vez']) assert.match(line(p), /follow-up 2026-10-25 · T1b/, p);
    assert.match(line('hazlo', 'Faltan los tests de borde. ¿Los agrego?'), /follow-up 2026-10-25 · T1b/, 'it answers the question the last reply ended with');
    assert.doesNotMatch(line('hazlo', 'Listo, quedó aplicado.'), /follow-up/, 'counter-example: the same words with no question to answer');
    assert.doesNotMatch(taskLine(dir, new Date(), { session: 's-other', prompt: 'hazlo', reply: '¿Los agrego?' }), /follow-up/, 'counter-example: the reply of another session answers no task of this one');
  });
}
test('step 2: the per-prompt hook keeps the follow-up it offered (null when none) for the end-of-turn hook', async () => {
  const dir = tmpRepo(), session = 's-offer';
  closed(dir, session, { file: 'src/a.mjs' });
  await ask(dir, session, 'agrega un endpoint de reportes');
  assert.equal(P.openTurn(dir, session).followUp, null, 'nothing offered');
  P.clearTaskStart(session); // that turn ended with no task
  await ask(dir, session, 'sigue');
  assert.equal(P.openTurn(dir, session).followUp, '2026-10-25 · T1b', 'counter-example: offered');
  await ask(dir, session, 'la segunda opción, sin el campo extra');
  assert.equal(P.openTurn(dir, session).followUp, '2026-10-25 · T1b', 'a later prompt of the task in progress keeps its offer');
});

// ---- the review of point 2: what the first build got too wide ----
test('2e: go-ahead words and an offer are no confirmation; "Push notifications: the user" is no rule; "cuota" alone is no external cause', async () => {
  for (const w of ['dale', 'ok', 'vale', 'listo', 'perfecto']) assert.ok(!YES.test(w), w);
  for (const w of ['sí', 'Si.', 'yes', 'confirmo', 'completo']) assert.ok(YES.test(w), w);
  const dir = tmpRepo();
  closed(dir, 's-offer');
  const offered = await ask(dir, 's-offer', 'sí', 'Hecho el cambio.\n\nSi quieres, sigo con el punto 5.');
  assert.ok(!/confirmada como hecha/.test(offered.out), 'the yes answers the offer, so the prompt reaches the model');
  assert.deepEqual([...ownedSteps('- Push notifications: the user receives them\n- Release notes: el usuario las escribe\n')], [], 'the key names the step and nothing else');
  assert.deepEqual([...ownedSteps('- Push: the user\n- Merge a main: el usuario\n')], ['push'], 'a key with more words is not a step');
  assert.equal(outcome('Resultado: parcial (falta calcular la cuota del préstamo)', [], [], 2).cause, undefined);
  assert.equal(outcome('Resultado: parcial (falta el endpoint del proveedor de pagos)', [], [], 2).cause, undefined);
});

// ---- M3 (2e) · "sí T1, T2", "sí a las dos", "no", and a step the user says is theirs ----
const closedAs = (dir, session, id, file = 'src/a.mjs') => P.appendRecord(dir, { id, agent: 'claude', at: new Date().toISOString(), session, cwd: dir, level: 2, files: [file], cierre: `## Cierre · ${id}\nResultado: hecho\nAprendido: x ← y`, outcome: { result: 'hecho' } });
const confirmed = (dir) => P.readRecords(P.projectHome(dir).log).filter((x) => x.kind === 'confirm' && x.confirmed).flatMap((x) => x.confirmed);
test('2e: logic — "sí T1, T2" confirms both tasks of the session; a number that is no task of the session confirms nothing', async () => {
  const dir = tmpRepo(), s = 's-ids';
  closedAs(dir, s, '2026-10-26 · T1'); closedAs(dir, s, '2026-10-26 · T2', 'src/app.css');
  const r = await ask(dir, s, 'sí T1, T2');
  assert.match(r.out, /confirmadas? como hechas?/);
  assert.deepEqual(confirmed(dir).sort(), ['2026-10-26 · T1', '2026-10-26 · T2']);
  const other = tmpRepo();
  closedAs(other, s, '2026-10-26 · T1');
  assert.ok(!/confirmada/.test((await ask(other, s, 'sí T9')).out), 'counter-example: T9 is no task of the session');
});
test('2e: CSS/HTML — "sí a las dos" confirms the last two tasks that said hecho', async () => {
  const dir = tmpRepo(), s = 's-both';
  closedAs(dir, s, '2026-10-26 · T1', 'src/app.css'); closedAs(dir, s, '2026-10-26 · T2', 'src/index.html');
  await ask(dir, s, 'sí a las dos');
  assert.deepEqual(confirmed(dir).sort(), ['2026-10-26 · T1', '2026-10-26 · T2']);
});
test('2e: a bare "no" after a hecho reaches the model as a follow-up and is recorded as the user\'s word; after a question it is an answer', async () => {
  const dir = tmpRepo(), s = 's-no';
  closedAs(dir, s, '2026-10-26 · T1');
  const r = await ask(dir, s, 'no');
  assert.doesNotMatch(r.out, /"decision":"block"/, 'the model reads it');
  assert.match(JSON.parse(r.out).hookSpecificOutput.additionalContext, /said "no" to 2026-10-26 · T1/);
  assert.deepEqual(P.readRecords(P.projectHome(dir).log).filter((x) => x.refuted).map((x) => [x.refuted, x.said]), [[['2026-10-26 · T1'], 'no']]);
  const asked = tmpRepo();
  closedAs(asked, s, '2026-10-26 · T1');
  await ask(asked, s, 'no', 'Listo.\n\n¿Lo subo ahora?\n- Sí\n- No');
  assert.ok(!P.readRecords(P.projectHome(asked).log).some((x) => x.refuted), 'counter-example: the no answers the question');
});
test('2e: a step the user says is theirs ("los PR los abro yo", "yo despliego") is offered as a Conventions line, never written; one already there is not', async () => {
  const { ownedOffer } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
  const day = new Date('2026-10-26T12:00:00Z');
  assert.match(ownedOffer('ok, pero los PR los abro yo', '# P\n', day), /offer .*"- PRs: the user \(2026-10-26: «ok, pero los PR los abro yo»\)" under Conventions; never write it without their yes/);
  assert.match(ownedOffer('yo despliego a producción', '# P\n', day), /- Deploys: the user/);
  assert.equal(ownedOffer('yo despliego', '# P\n## Conventions specific to this project\n- Deploys: the user (2026-10-01: «yo despliego»)\n', day), '', 'counter-example: already written');
  assert.equal(ownedOffer('despliega tú a producción', '# P\n', day), '', 'counter-example: the agent is asked to do it');
});
