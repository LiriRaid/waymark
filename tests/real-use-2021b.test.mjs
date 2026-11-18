// Waymark 2.0.21 · failures 1, 13, 6, 20 and the leftovers of 10 of docs/plans/2.0.21.md. Every case is a synthetic copy of a pattern seen in
// the real use (ADR 0042): no project name, path or prompt of a real project. Run: node --test tests/real-use-2021b.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-ru21b-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const R0 = await import(`file://${SCRIPTS}/rule0-hook.mjs`);

// ---- failure 1: a question that asks for a change is told to route as a change, from the prompt ----
test('1: asksChange reads a request to change something, in Spanish and English, and leaves a plain question alone', () => {
  for (const p of ['corrige el botón de login', 'agrega un filtro por fecha a la tabla', 'please fix the retry in src/queue.ts', '¿puedes cambiar el color del encabezado?', 'could you add a test for the parser?', 'refactoriza el módulo de pagos'])
    assert.ok(R0.asksChange(p), `change: ${p}`);
  for (const p of ['¿cómo funciona el guard de ego?', 'what does the stop hook do when a build fails?', '¿por qué falla el test de kiro?', 'explícame el flujo del registro', 'sí', '', 'where is the card written?'])
    assert.ok(!R0.asksChange(p), `question: ${p}`);
});

test('1: changeLine names the level by the size of the ask: L1 for a named file, L2 for several, L3 for a refactor', () => {
  assert.match(R0.changeLine('corrige el typo en README.md'), /route it as L1/);
  assert.match(R0.changeLine('agrega el campo en src/a.ts, src/b.ts y src/c.ts'), /route it as L2/);
  assert.match(R0.changeLine('refactoriza el módulo de pagos'), /route it as L3/);
  assert.equal(R0.changeLine('¿cómo funciona el guard?'), '');
});

test('1: the prompt hook adds the line to the reminder of a request to change, and not to a question; the Q rule of the block is unchanged', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ru21b-')); temps.push(dir);
  const run = (prompt, session) => spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { input: JSON.stringify({ cwd: dir, session_id: session, prompt }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' }).stdout;
  assert.match(run('corrige el typo en README.md', 's-ch'), /asks for a change: route it as L1/);
  assert.doesNotMatch(run('¿cómo funciona el guard de ego?', 's-q'), /asks for a change/);
  assert.match(fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'instructions.md'), 'utf8'), /Q/, 'the block still defines Q');
});

// ---- failure 13: the record keeps the level the route line declared next to the level the hook measured ----
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps, provenanceRecord } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);
let ids = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const edit = (file) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name: 'Edit', input: { file_path: file } }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
const CIERRE = '## Cierre · 2026-11-18 · T1\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y';
const recordOf = (route, files) => {
  const lines = [prompt('ajusta el servicio'), say(route), ...files.flatMap((f) => edit(f))];
  const ctx = { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: [] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1 };
  const turn = T.currentTurn(lines);
  return provenanceRecord(turn, cierreGaps(turn, CIERRE, undefined, undefined, ctx), ctx, { session: 's', cwd: '/work/proj' });
};

test('13: a turn routed L1 that changed four files is recorded measured L2 and declared L1', () => {
  const r = recordOf('Waymark → L1 · dept-backend', ['/work/proj/src/a.mjs', '/work/proj/src/b.mjs', '/work/proj/src/c.mjs', '/work/proj/src/d.mjs']);
  assert.equal(r.level, 2, 'measured');
  assert.equal(r.declared, 1, 'declared by the line');
});

test('13: a turn routed Q that changed files is recorded declared Q, so the next reading can count the questions that became changes', () => {
  const r = recordOf('Waymark → Q · dept-backend', ['/work/proj/src/a.mjs']);
  assert.equal(r.declared, 'Q');
  assert.ok(r.level >= 1);
});

test('13: a turn with no routing line records declared null, never a guess', () => {
  const r = recordOf('ajusto el servicio', ['/work/proj/src/a.mjs']);
  assert.equal(r.declared, null);
});

// ---- failure 6: the Kiro IDE reads hooks from the workspace as .kiro/hooks/<id>.kiro.hook (when/then) and gives a runCommand hook only USER_PROMPT ----
const KW = await import(`file://${SCRIPTS}/kiro-workspace.mjs`);
const gitK = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const kiroProject = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-kiro-ws-')); temps.push(d); gitK(d, 'init', '-q'); return d; };
const env = (extra = {}) => ({ ...process.env, WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: home, WAYMARK_BACKUPS: path.join(home, 'bk'), KIRO_HOME: path.join(home, 'kiro-home'), WAYMARK_KIRO_HOOKS: path.join(home, 'kiro-home', 'hooks', 'waymark.json'), ...extra });
const node = (script, args, opts = {}) => spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], { encoding: 'utf8', env: env(opts.env), cwd: opts.cwd, input: opts.input ?? '' });

test('6: the workspace hooks are .kiro.hook files in the format the IDE reads: when/then, runCommand, the core event on the command line', () => {
  const plan = KW.planWorkspace('/p', { scripts: '/s/waymark/scripts' });
  const hooks = plan.files.filter((f) => /\.kiro\.hook$/.test(f.file));
  assert.deepEqual(hooks.map((h) => path.basename(h.file)).sort(), ['waymark-prompt.kiro.hook', 'waymark-stop.kiro.hook']);
  const prompt = JSON.parse(hooks.find((h) => /prompt/.test(h.file)).text), stop = JSON.parse(hooks.find((h) => /stop/.test(h.file)).text);
  assert.equal(prompt.version, '1'); assert.equal(prompt.enabled, true);
  assert.equal(prompt.when.type, 'promptSubmit'); assert.equal(stop.when.type, 'agentStop');
  assert.equal(prompt.then.type, 'runCommand');
  assert.match(prompt.then.command, /rule0-hook\.mjs" --agent kiro --event UserPromptSubmit$/);
  assert.match(stop.then.command, /stop-hook\.mjs" --agent kiro --event Stop$/);
  assert.ok(Number(prompt.then.timeout) > 0, 'a timeout the IDE honors');
  assert.ok(!hooks.some((h) => /preToolUse|postToolUse/.test(h.text)), 'no tool hooks: the IDE gives a runCommand hook no tool name, so they would journal nothing');
});

test('6: the plan also writes the Rule 0 block as a workspace steering file kept out of git, and says what it does without writing', () => {
  const dir = kiroProject(), plan = KW.planWorkspace(dir, { scripts: '/s/waymark/scripts' });
  const steer = plan.files.find((f) => /steering[\\/]waymark\.md$/.test(f.file));
  assert.match(steer.text, /^---\ninclusion: always\n---\n/);
  assert.match(steer.text, /waymark:begin/);
  assert.equal(plan.exclude, true);
  assert.ok(!fs.existsSync(path.join(dir, '.kiro')), 'a plan writes nothing');
});

test('6: install-hooks --agent kiro --project <dir> writes the three files and the exclude line once, registers the folder, and a second run changes nothing', () => {
  const dir = kiroProject();
  const dry = node('install-hooks.mjs', ['--agent', 'kiro', '--project', dir]);
  assert.match(dry.stdout, /IDE/); assert.match(dry.stdout, /CLI/); assert.match(dry.stdout, /Plan only/);
  assert.ok(!fs.existsSync(path.join(dir, '.kiro')));
  const run = node('install-hooks.mjs', ['--agent', 'kiro', '--project', dir, '--apply']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  for (const f of ['hooks/waymark-prompt.kiro.hook', 'hooks/waymark-stop.kiro.hook', 'steering/waymark.md']) assert.ok(fs.existsSync(path.join(dir, '.kiro', f)), f);
  const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.equal(exclude.split('\n').filter((l) => l === '/.kiro/').length, 1);
  assert.ok(KW.workspaces().includes(path.resolve(dir)), 'registered for the uninstall');
  node('install-hooks.mjs', ['--agent', 'kiro', '--project', dir, '--apply']);
  assert.equal(fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8'), exclude, 'idempotent');
  assert.match(node('install-hooks.mjs', ['--agent', 'kiro', '--project', dir]).stdout, /already/);
});

test("6: uninstall removes every workspace file the adapter wrote and nothing else: the user's own hook and steering stay", () => {
  const dir = kiroProject();
  node('install-hooks.mjs', ['--agent', 'kiro', '--project', dir, '--apply']);
  fs.writeFileSync(path.join(dir, '.kiro', 'hooks', 'mine.kiro.hook'), '{"name":"mine"}');
  fs.writeFileSync(path.join(dir, '.kiro', 'steering', 'product.md'), '# mine');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '/node_modules/\n');
  const plan = node('uninstall.mjs', []);
  assert.match(plan.stdout, /waymark-prompt\.kiro\.hook/); assert.match(plan.stdout, /steering\/waymark\.md/);
  assert.ok(fs.existsSync(path.join(dir, '.kiro', 'steering', 'waymark.md')), 'the plan removes nothing');
  const r = node('uninstall.mjs', ['--apply']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ['hooks/waymark-prompt.kiro.hook', 'hooks/waymark-stop.kiro.hook', 'steering/waymark.md']) assert.ok(!fs.existsSync(path.join(dir, '.kiro', f)), `${f} removed`);
  assert.ok(fs.existsSync(path.join(dir, '.kiro', 'hooks', 'mine.kiro.hook')) && fs.existsSync(path.join(dir, '.kiro', 'steering', 'product.md')), "the user's files stay");
  const exclude = fs.readFileSync(path.join(dir, '.git', 'info', 'exclude'), 'utf8');
  assert.ok(!/^\/\.kiro\/$/m.test(exclude) && /node_modules/.test(exclude), "only Waymark's exclude line goes");
  assert.ok(!KW.workspaces().includes(path.resolve(dir)), 'and the folder leaves the registry');
});

test("6: a hook of the IDE carries no JSON: the prompt comes from USER_PROMPT and the session is the workspace's, so the turn and its Stop meet in one journal", () => {
  const dir = kiroProject(), ev = (script, event, extra) => node(script, ['--agent', 'kiro', '--event', event], { cwd: dir, env: extra, input: '' });
  ev('rule0-hook.mjs', 'UserPromptSubmit', { USER_PROMPT: 'corrige el typo en README.md' });
  ev('stop-hook.mjs', 'Stop', {});
  const journals = path.join(home, 'kiro');
  const rows = fs.readdirSync(journals).flatMap((f) => fs.readFileSync(path.join(journals, f), 'utf8').split('\n').filter(Boolean).map((l) => ({ f, ...JSON.parse(l) })));
  const prompt = rows.find((r) => r.event === 'prompt' && /typo en README/.test(r.prompt)), stop = rows.find((r) => r.event === 'stop' && String(r.cwd).toLowerCase() === path.resolve(dir).toLowerCase());
  assert.ok(prompt, 'the prompt is journaled from the environment: ' + JSON.stringify(rows));
  assert.ok(stop, 'the Stop is journaled');
  assert.equal(prompt.f, stop.f, 'one session for both');
});

test('6: connect-agents and install-hooks say which surface each agent has', async () => {
  const { AGENTS, surfaceLine } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  const kiro = AGENTS().find((a) => a.key === 'kiro');
  assert.match(surfaceLine(kiro), /IDE/); assert.match(surfaceLine(kiro), /CLI/);
  for (const a of AGENTS()) assert.ok(a.surface, `${a.key} says its surface`);
});

// ---- the findings of the review of 2.0.21's build ----
test('review: verbs that name no change (escribe, write, make, haz, hazlo) do not make a request, and a follow-up of a task in progress gets no line', () => {
  for (const p of ['dale, hazlo', 'revisa qué escribe el hook en el log', 'make sure the hook is fast', 'haz un resumen de lo que pasó']) assert.ok(!R0.asksChange(p), p);
  assert.ok(R0.asksChange('corrige el typo en README.md'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ru21c-')); temps.push(dir);
  const run = (prompt) => spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { input: JSON.stringify({ cwd: dir, session_id: 's-follow', prompt }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' }).stdout;
  assert.match(run('corrige el typo en README.md'), /asks for a change/);
  assert.doesNotMatch(run('agrega también el filtro por fecha en src/a.ts y src/b.ts'), /asks for a change/, 'the task is in progress: its level is already routed');
});

test('review: hookCommand lives in one place (lib/paths.mjs) and install-hooks and the Kiro workspace write the same launcher', async () => {
  const L = await import(`file://${SCRIPTS}/lib/paths.mjs`), I = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  assert.equal(L.hookCommand('/s', 'stop-hook.mjs'), 'node "/s/hook-run.cjs" "/s/stop-hook.mjs"');
  assert.equal(I.hookCommand, L.hookCommand);
  assert.ok(JSON.parse(KW.planWorkspace('/p', { scripts: '/s' }).files.find((f) => /prompt\.kiro\.hook$/.test(f.file)).text).then.command.startsWith(L.hookCommand('/s', 'rule0-hook.mjs')));
});

test('review: a steering file the user edited is backed up before Waymark rewrites it', () => {
  const dir = kiroProject();
  node('install-hooks.mjs', ['--agent', 'kiro', '--project', dir, '--apply']);
  const steer = path.join(dir, '.kiro', 'steering', 'waymark.md');
  fs.writeFileSync(steer, '# my own edit\n');
  node('install-hooks.mjs', ['--agent', 'kiro', '--project', dir, '--apply']);
  assert.match(fs.readFileSync(steer, 'utf8'), /waymark:begin/, 'rewritten');
  assert.equal(fs.readFileSync(`${steer}.waymark-bak`, 'utf8'), '# my own edit\n', 'the edit kept');
});

// ---- failure 8 (ADR 0065): the Stop hook's own typecheck is not run again where it was too slow the last time ----
test('8: a typecheck that took longer than the slow limit is not re-run by the hook next time: it is skipped with the time it takes, and the agent is asked to run it', async () => {
  const { rerunGate } = await import(`file://${SCRIPTS}/testigos.mjs`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-slow-')); temps.push(dir); gitK(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, '.waymark'));
  const memory = path.join(dir, '.waymark', 'memory.md');
  fs.writeFileSync(memory, '# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | `node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1500)"` | 2026-11-18 |\n');
  fs.writeFileSync(path.join(dir, 'a.mjs'), 'a\n'); gitK(dir, 'add', '-A'); gitK(dir, 'commit', '-q', '-m', 'base');
  process.env.WAYMARK_SLOW_GATE_S = '1';
  try {
    const h = { root: dir, memory };
    const first = rerunGate([path.join(dir, 'a.mjs')], h);
    assert.equal(first.ok, true); assert.ok(first.s >= 1 && !first.skipped, 'the first run is made and measured');
    fs.writeFileSync(path.join(dir, 'a.mjs'), 'b\n'); // another tree: the pass is not cached
    const t0 = Date.now(), second = rerunGate([path.join(dir, 'a.mjs')], h);
    assert.equal(second.skipped, true); assert.equal(second.ok, null); assert.equal(second.timedOut, true);
    assert.ok(second.s >= 1, 'it says how long the gate takes'); assert.ok(Date.now() - t0 < 1000, 'and does not run it');
    process.env.WAYMARK_SLOW_GATE_S = '60'; // a limit above what it takes: it runs again
    assert.equal(rerunGate([path.join(dir, 'a.mjs')], h).skipped, undefined);
  } finally { delete process.env.WAYMARK_SLOW_GATE_S; }
});

// ---- check 10.3 (ADR 0065): a short ask continues the session's recent work, not only its last task ----
test('10.3: a short ask is searched with the session\'s last three tasks beside it, never a longer ask, and never another session\'s tasks', async () => {
  const { queryOf } = await import(`file://${SCRIPTS}/precedent.mjs`);
  const rec = (id, session, prompt, files = []) => ({ id, session, prompt, files, cierre: '## Cierre\nAprendido: x ← y' });
  const records = [rec('T1', 's', 'ajusta el planner de turnos'), rec('T2', 's', 'revisa el calendario semanal'), rec('T3', 's', 'corrige el mapper'), rec('T4', 's', 'agrega el filtro'), rec('T9', 'other', 'tarea ajena distinta')];
  const q = queryOf('sigue con el punto 2', records, 's');
  assert.match(q, /calendario/); assert.match(q, /mapper/); assert.match(q, /filtro/, 'the last three of the session');
  assert.doesNotMatch(q, /planner/, 'not the fourth back');
  assert.doesNotMatch(q, /ajena/, 'not another session');
  const long = 'ajusta el planner de turnos para que el calendario semanal muestre el filtro por colaborador y por franja horaria completa';
  assert.equal(queryOf(long, records, 's'), long, 'a long ask names enough by itself');
});

test('8: a slow time older than a day is measured again, so a cold-cache first run does not keep a gate skipped for a week', async () => {
  const { rerunGate } = await import(`file://${SCRIPTS}/testigos.mjs`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-slow2-')); temps.push(dir); gitK(dir, 'init', '-q');
  fs.mkdirSync(path.join(dir, '.waymark'));
  const memory = path.join(dir, '.waymark', 'memory.md'), cmd = 'node -e "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200)"';
  fs.writeFileSync(memory, `# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | \`${cmd}\` | 2026-11-18 |\n`);
  fs.writeFileSync(path.join(dir, 'a.mjs'), 'a\n'); gitK(dir, 'add', '-A'); gitK(dir, 'commit', '-q', '-m', 'base');
  const file = path.join(home, '.gate-time.json');
  process.env.WAYMARK_SLOW_GATE_S = '1';
  try {
    const h = { root: dir, memory };
    const probe = rerunGate([path.join(dir, 'a.mjs')], h); // measured: fast, so kept as fast
    assert.ok(!probe.skipped);
    const all = JSON.parse(fs.readFileSync(file, 'utf8')), k = Object.keys(all).find((x) => x.endsWith(`|${cmd}`));
    assert.ok(k, 'the time is kept');
    all[k] = { s: 99, at: Date.now() - 2 * 86400000 }; fs.writeFileSync(file, JSON.stringify(all));
    fs.writeFileSync(path.join(dir, 'a.mjs'), 'b\n');
    assert.equal(rerunGate([path.join(dir, 'a.mjs')], h).skipped, undefined, 'two days old: measured again');
    all[k] = { s: 99, at: Date.now() - 3600000 }; fs.writeFileSync(file, JSON.stringify(all));
    fs.writeFileSync(path.join(dir, 'a.mjs'), 'c\n');
    assert.equal(rerunGate([path.join(dir, 'a.mjs')], h).skipped, true, 'an hour old: still skipped');
  } finally { delete process.env.WAYMARK_SLOW_GATE_S; }
});
