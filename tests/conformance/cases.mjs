// The behavioural cases every adapter must pass (docs/adr/0039). Each runs the real hook scripts through a world (harness.mjs) and sees only what
// the agent can do (`needs`: a capability the driver declares in its `caps`), never which agent it is. cases.json lists them (id, area, behaviour,
// needs); this file implements each by id, and a test fails when the two differ.
import assert from 'node:assert/strict';
import path from 'node:path';
import { SCRIPTS, day } from './harness.mjs';
import { procedurePath } from './agents/common.mjs';

const W = path.join(SCRIPTS, 'waymark.mjs').replace(/\\/g, '/');

const QS = [{ question: '¿Cómo?', options: [{ label: 'Backoff (Recommended)', description: 'Reintentos con espera. Archivos: 2, riesgo bajo.' }, { label: 'Cola', description: 'Una cola aparte. Costo alto, riesgo medio, 5 archivos.' }] }];
const PICK = { '¿Cómo?': 'Backoff (Recommended)' };
const ROUTING = (level = 'L2') => `Waymark → ${level} · dept-backend · skills: ${level === 'Q' ? 'ninguna' : 'code-review'}`;
const SRC = (w) => w.files('src/orders.service.mjs');
const CIERRE = (extra = '') => `## Cierre · ${day} · T1\nResultado: hecho\n${extra}Evidencia: observada timeouts en el log de pedidos\nAprendido: "backoff ← timeouts"`;
const PEDIDO = 'Pedido: 1) agregar reintentos 2) registrar cada intento 3) documentar el límite · Captura: sin captura';
const records = async (w) => w.records();
const last = async (w) => w.records().at(-1);

// The routing line and the department of an L2 task, as the agent says them.
const routed = async (w, { level = 'L2', say = null } = {}) => {
  await w.prompt('agrega reintentos al servicio de pedidos');
  if (say) await w.say(say);
  await w.say(ROUTING(level));
  await w.skill('dept-backend');
};
// The work of an L2 task: the choice window, one edit, the gate, the review and the memory note.
const work = async (w, { gate = true, ask = true } = {}) => {
  if (ask) await w.ask(QS, PICK);
  const edit = await w.tool('edit', { file: SRC(w) });
  if (gate) await w.tool('shell', { command: 'node --check src/orders.service.mjs && npm run build' });
  await w.tool('shell', { command: `node "${W}" review src/orders.service.mjs` });
  await w.tool('edit', { file: w.memoryFile });
  return edit;
};
const probe = async (w, ev) => (await w.fire(ev, { probe: true })).raw;

export const CASES = {
  // ---- the card at the start of a session ----
  async 'card.session-start'(w) {
    const r = await w.start();
    assert.match(r.context, /Waymark context card/, 'the session card is handed to the agent');
    assert.match(r.context, /Project memory/, 'with what the project knows');
  },
  async 'card.rule-zero-where-there-is-no-file'(w) {
    const r = await w.start();
    assert.match(r.context, /Rule 0 — Waymark on every request/, 'an agent with no instructions file gets the Rule 0 block in the card');
  },
  async 'card.probe-answers'(w) {
    for (const ev of ['start', 'prompt', 'pre', 'stop']) {
      const r = await w.fire(ev, { probe: true, kind: 'shell', input: { command: 'ls' } });
      assert.match(r.raw.stdout, /waymark_probe_ok|"ok"|probe/i, `${ev}: the hook answers its probe, so a dead hook is found by check`);
    }
  },
  // ---- the prompt ----
  async 'prompt.reminder-with-task-id'(w) {
    const r = await w.prompt('agrega reintentos al servicio de pedidos');
    assert.match(r.context, /Waymark Rule 0/, 'the per-prompt reminder');
    assert.match(r.context, new RegExp(`ID: new ${day} · T1`), 'with the ID the task will be recorded under');
  },
  async 'prompt.reminder-kept-for-the-first-result'(w) {
    const r = await w.prompt('agrega reintentos al servicio de pedidos');
    assert.equal(r.context, '', 'the prompt hook cannot add context here');
    const t = await w.tool('shell', { command: 'ls src' });
    assert.match(t.context, /Waymark Rule 0/, 'the reminder rides on the first tool result');
  },
  async 'prompt.output-dropped-by-the-agent'(w) {
    const r = await w.prompt('agrega reintentos al servicio de pedidos');
    assert.equal(w.agent.caps.reminder, null);
    assert.equal(w.agent.caps.promptContext, false, 'the agent drops a prompt hook\'s output: no reminder reaches it, and the card and the instructions carry Rule 0');
    assert.ok(r.raw.status === 0 || r.raw.status === null, 'the hook still runs without failing');
  },
  // ---- the decision gate ----
  async 'gate.edit-denied-before-the-choice-window'(w) {
    await routed(w);
    const r = await w.tool('edit', { file: SRC(w) });
    assert.equal(r.denied, true);
    assert.match(r.deny, /L2 decision gate/);
    assert.match(r.deny, /choice window/);
  },
  async 'gate.edit-allowed-after-the-choice-window'(w) {
    await routed(w);
    await w.ask(QS, PICK);
    const r = await w.tool('edit', { file: SRC(w) });
    assert.equal(r.denied, false, r.deny || '');
  },
  async 'gate.shell-change-denied-before-the-choice-window'(w) {
    await routed(w);
    const r = await w.tool('shell', { command: 'sed -i s/a/b/ src/orders.service.mjs' });
    assert.equal(r.denied, true);
    assert.match(r.deny, /decision gate/);
  },
  async 'gate.read-only-shell-passes'(w) {
    await routed(w);
    const r = await w.tool('shell', { command: 'ls src' });
    assert.equal(r.denied, false, 'a command that changes nothing is no change');
  },
  async 'gate.memory-edit-is-exempt'(w) {
    await routed(w);
    const r = await w.tool('edit', { file: w.memoryFile });
    assert.equal(r.denied, false, 'Waymark\'s own memory is no project change');
  },
  async 'gate.question-turned-change-asks-to-reroute'(w) {
    await routed(w, { level: 'Q' });
    const r = await w.tool('edit', { file: SRC(w) });
    assert.equal(r.denied, true);
    assert.match(r.deny, /routed as a question/);
  },
  async 'gate.nothing-before-the-routing-line'(w) {
    await w.prompt('agrega reintentos al servicio de pedidos');
    const r = await w.tool('edit', { file: SRC(w) });
    assert.equal(r.denied, false, 'a turn with no routing line has no level to gate');
  },
  async 'gate.blind-without-the-reply'(w) {
    await routed(w);
    const r = await w.tool('edit', { file: SRC(w) });
    assert.equal(r.denied, false, 'no hook carries the reply, so the gate cannot see the routing line and lets the change through (lacks: cierre)');
  },
  // ---- the commit trailer ----
  async 'trailer.commit-without-it-is-sent-back-once'(w) {
    await routed(w);
    const first = await w.tool('shell', { command: 'git commit -m "agrega reintentos"' });
    assert.equal(first.denied, true);
    assert.match(first.deny, /Waymark-Task: <task ID>|"Waymark-Task: /);
    const again = await w.tool('shell', { command: 'git commit -m "agrega reintentos"' });
    assert.equal(again.denied, false, 'sent again without it, the commit goes through');
  },
  async 'trailer.commit-with-it-passes'(w) {
    await routed(w);
    const r = await w.tool('shell', { command: `git commit -m "agrega reintentos" -m "Waymark-Task: ${day} · T1"` });
    assert.equal(r.denied, false);
  },
  // ---- the sensitive-path guard ----
  async 'guard.shell-naming-a-secret-is-denied'(w) {
    const r = await w.tool('shell', { command: 'cat .env' });
    assert.equal(r.denied, true);
    assert.match(r.deny, /sensitive path/);
  },
  async 'guard.edit-of-a-secret-is-denied'(w) {
    const r = await w.tool('edit', { file: w.files('.env') });
    assert.equal(r.denied, true);
    assert.match(r.deny, /sensitive path/);
  },
  async 'guard.read-of-a-secret-is-prevented'(w) {
    const r = await w.tool('read', { file: w.files('.env') });
    assert.equal(r.denied, true);
    assert.match(r.deny, /sensitive path/);
  },
  async 'guard.read-of-a-secret-is-detected'(w) {
    await routed(w);
    const r = await w.tool('read', { file: w.files('.env') });
    assert.equal(r.denied, false, 'no hook before this tool: it goes through');
    await work(w);
    await w.stop(CIERRE());
    const rec = await last(w);
    assert.ok(rec.observed.guarded.some((f) => /\.env$/.test(f.path)), `the end-of-turn hook finds it in the transcript: ${JSON.stringify(rec?.observed?.guarded)}`);
    assert.ok(rec.findings.some((f) => /no hook stopped it/.test(f)));
  },
  async 'guard.secret-printed-by-a-tool-is-detected'(w) {
    await routed(w);
    await w.tool('shell', { command: 'node scripts/show.mjs' }, { out: `KEY=${['AKIA', 'IOSFODNN7EXAMPLE'].join('')}` });
    await work(w);
    await w.stop(CIERRE());
    const rec = await last(w);
    assert.ok(rec.observed.guarded.some((f) => f.kind === 'output' && f.secret === 'AWS access key'), JSON.stringify(rec?.observed?.guarded));
    assert.equal(JSON.stringify(rec).includes(['AKIA', 'IOSFODNN7EXAMPLE'].join('')), false, 'never the value');
  },
  // ---- the memory the hook hands over ----
  async 'memory.pack-at-the-first-edit-once'(w) {
    await routed(w);
    await w.ask(QS, PICK);
    const first = await w.tool('edit', { file: SRC(w) });
    assert.match(first.context, /Waymark memory for the file you are changing/, `the pack of the file, handed ${w.agent.caps.packAt === 'pre' ? 'before' : 'with the result of'} the first edit`);
    const second = await w.tool('edit', { file: SRC(w) });
    assert.doesNotMatch(second.context, /Waymark memory for the file/, 'handed once per file');
  },
  async 'memory.procedures-handed-with-the-first-edit'(w) {
    await routed(w);
    await w.ask(QS, PICK);
    const r = await w.tool('edit', { file: SRC(w) });
    assert.match(r.context, /Waymark procedures of dept-backend/, 'the owner\'s procedures, which count as read');
  },
  // ---- the choice window ----
  async 'decision.answer-is-recorded'(w) {
    await routed(w);
    await work(w);
    await w.stop(CIERRE());
    const rec = await last(w);
    assert.equal(rec.decisions.length, 1);
    assert.equal(rec.decisions[0].question, '¿Cómo?');
    assert.equal(rec.decisions[0].chosen, w.agent.caps.answer === false ? rec.decisions[0].chosen : 'Backoff (Recommended)');
  },
  async 'decision.options-with-their-attributes'(w) {
    await routed(w);
    await work(w);
    await w.stop(CIERRE());
    const rec = await last(w);
    const [a, b] = rec.decisions[0].options;
    assert.deepEqual([a.label, a.recommended, a.risk], ['Backoff (Recommended)', true, 'bajo']);
    assert.deepEqual([b.label, b.recommended, b.risk], ['Cola', false, 'medio']);
  },
  // ---- the end of the turn and the record ----
  async 'stop.complete-cierre-is-recorded'(w) {
    await routed(w);
    await work(w);
    const r = await w.stop(CIERRE());
    assert.equal(r.block, null, r.block || '');
    const rec = await last(w);
    assert.ok(rec, 'the task has a record');
    assert.equal(rec.id, `${day} · T1`);
    assert.deepEqual(rec.files.map((f) => path.basename(f)).filter((f) => f === 'orders.service.mjs'), ['orders.service.mjs']);
    assert.equal(rec.schema, 'waymark.record/v2');
  },
  async 'stop.record-names-the-agent'(w) {
    await routed(w);
    await work(w);
    await w.stop(CIERRE());
    assert.equal((await last(w)).agent, w.agent.key);
  },
  async 'stop.department-and-skills-are-read-from-the-calls'(w) {
    await routed(w);
    await work(w);
    await w.stop(CIERRE());
    const rec = await last(w);
    assert.equal(rec.department.declared, 'dept-backend');
    assert.ok(rec.skills.includes('dept-backend'), JSON.stringify(rec.skills));
  },
  async 'stop.no-cierre-is-sent-back'(w) {
    await routed(w);
    await work(w);
    const r = await w.stop('Listo.');
    assert.ok(r.block, 'the turn is sent back');
    assert.match(r.block, /Cierre/);
    assert.equal((await records(w)).length, 0, 'nothing is recorded until it closes');
  },
  async 'stop.second-stop-records-what-stayed-open'(w) {
    await routed(w);
    await work(w);
    await w.stop('Listo.');
    const r = await w.stop('Listo.', { again: true });
    assert.equal(r.block, null, 'sent back once, never twice');
    const rec = await last(w);
    assert.ok(rec.unresolved.some((u) => /Cierre/.test(u)), JSON.stringify(rec.unresolved));
  },
  async 'stop.gate-is-required-after-the-last-change'(w) {
    await routed(w);
    await work(w, { gate: false });
    const r = await w.stop(CIERRE());
    assert.ok(r.block, 'a change with no gate run after it is sent back');
    assert.match(r.block, /gate|typecheck|build/i);
  },
  async 'stop.a-question-leaves-no-task-record'(w) {
    await w.prompt('¿qué hace el servicio de pedidos?');
    await w.say(ROUTING('Q'));
    await w.tool('read', { file: SRC(w) });
    await w.stop('Reintenta tres veces con espera.');
    assert.equal((await records(w)).filter((r) => r.id).length, 0, 'a Q is no task: no ID, no T<n>');
  },
  async 'stop.every-item-of-the-ask-is-answered'(w) {
    await routed(w, { say: PEDIDO });
    await work(w);
    const r = await w.stop(CIERRE('Pedido: ✔1 reintentos en orders.service.mjs · ✔2 log por intento\n'));
    assert.ok(r.block, 'an item with no answer is sent back');
    assert.match(r.block, /answer each numbered item of the ask \(missing 3\)/);
  },
  // ---- resuming ----
  async 'resume.the-card-of-the-next-session-names-the-last-task'(w) {
    await routed(w);
    await work(w);
    await w.stop(CIERRE());
    const next = await w.fire('start', { session: `${w.session}-next` });
    assert.match(next.context, new RegExp(`${day} · T1`), 'a new session of the same project starts from the record of the last task');
  },
  async 'resume.the-next-task-takes-the-next-number'(w) {
    await routed(w);
    await work(w);
    await w.stop(CIERRE());
    const r = await w.prompt('agrega un límite de reintentos');
    const text = w.agent.caps.reminder === 'post' ? (await w.tool('shell', { command: 'ls src' })).context : r.context; // where the reminder rides on the first result
    if (w.agent.caps.prompt === false) assert.match(text, new RegExp(`ID: new ${day} · T2; follow-up ${day} · T1b`), 'the ask cannot be read: both IDs offered');
    else assert.match(text, new RegExp(`ID: new ${day} · T2\\.`), 'a different ask, even on the same files, is a new task: no follow-up offered');
  },
  // ---- the adapter against its own claims ----
  async 'adapter.capabilities-are-what-the-adapter-says'(w) {
    const a = await import(`file://${SCRIPTS}/agents/${w.agent.key}.mjs`), caps = w.agent.caps;
    assert.equal(a.name, w.agent.key);
    assert.equal(caps.reply, !a.lacks.includes('cierre'), 'a reply that no hook carries is a lack the adapter declares');
    assert.equal(caps.brake, !!a.out.blockPrompt, 'a prompt brake exists only where the agent lets a hook stop a prompt');
    assert.equal(caps.packAt === 'pre', !!a.preContext, 'the pack goes before the tool only where a pre-tool hook can add context');
    assert.equal(caps.prompt === false, !!a.promptless, 'an agent whose hooks do not carry the ask says so (both task IDs are offered)');
    for (const f of ['context', 'deny', 'block', 'notice']) assert.equal(typeof a.out[f], 'function', `out.${f}`);
    assert.equal(typeof a.call, 'function');
    assert.equal(typeof a.read, 'function');
    assert.equal(typeof a.sessions, 'function');
    assert.ok(Array.isArray(a.lacks));
    assert.ok(a.instructions, 'where the agent reads the user\'s instructions (or the card carries Rule 0)');
  },
  async 'adapter.pre-tool-call-maps-to-files-or-a-command'(w) {
    const a = await import(`file://${SCRIPTS}/agents/${w.agent.key}.mjs`);
    const edit = w.agent.payload('pre', { cwd: w.cwd, session: 's', kind: 'edit', input: { file: w.files('src/orders.service.mjs') } });
    const shell = w.agent.payload('pre', { cwd: w.cwd, session: 's', kind: 'shell', input: { command: 'ls' } });
    const mapped = (p) => a.call(a.input ? { ...a.input(p), tool_name: p.tool_name || p.toolCall?.name, tool_input: p.tool_input || p.toolCall?.args } : p);
    const e = mapped(edit), s = mapped(shell);
    assert.ok(e?.files?.some((f) => /orders\.service\.mjs$/.test(f)), `an edit names its file: ${JSON.stringify(e)}`);
    assert.equal(s?.command, 'ls', 'a shell call names its command');
  },
};

// The pieces a test that builds on the cases (the handoff across agents) reuses.
export { routed, work, CIERRE, QS, PICK, SRC, PEDIDO, ROUTING, W };
