// Waymark hooks · scenario tests with synthetic transcripts. Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME; nothing reads or writes the real ~/.waymark or ~/.claude.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-test-'));
process.env.WAYMARK_ENGRAM = ''; // never the real engram: a test that needs it points this at a fake
process.env.WAYMARK_HOME = home;
const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-agents-')); // never the real ~/.codex, ~/.gemini…
process.env.WAYMARK_AGENTS_HOME = agentsHome;
process.env.WAYMARK_BACKUPS = path.join(home, 'backups');
const temps = [home, agentsHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { taskIds, validId, decisionsIn, projectSlug, readLog, appendRecord, taskLines, taskStart, taskFiles, verifyChain, turnInputs, commitsFor, gitSnapshot, snapshotDiff, mutatesFiles, changesProject } = await import(`file://${SCRIPTS}/provenance.mjs`);
const { checkDecision } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { checkCierre, cierreGaps, provenanceRecord, branchesOf, evaluate, summaryLine } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { taskLine } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
const { currentTurn, routedLevel, routedDept, readSomething, turnUsage, sessionTools, isPrompt: isPromptT } = await import(`file://${SCRIPTS}/transcript.mjs`);

const NOW = new Date(2026, 9, 2, 12, 0); // 2026-10-02 local
const DAY = '2026-10-02';
const FILE = '/work/proj/src/orders.service.mjs'; // a project file: not exempt, no spec folder on disk
const PROC = (dept) => call('Read', { file_path: `/skills/${dept}/procedures.md` }); // the owner's procedure, read
const PACK = () => call('Bash', { command: 'node "/s/waymark/scripts/waymark.mjs" pack src/orders.service.mjs' }); // the project memory, searched before the change
const MEM = () => call('Edit', { file_path: path.join(os.homedir(), '.waymark', 'projects', 'proj.md') }); // Aprendido written to project memory
let n = 0;
const fresh = () => { const cwd = `/work/proj-${++n}`; return { cwd, log: path.join(home, 'provenance', `proj-${n}.jsonl`) }; };

// Synthetic transcript lines (Claude Code .jsonl shapes).
const prompt = (text, uuid = `p${Math.random()}`) => ({ type: 'user', uuid, message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const call = (name, input = {}) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
const answered = (question, labels, chosen) => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } });
const record = (cwd, id) => appendRecord(cwd, { id });

test('task IDs: first of the day, next number, follow-up letters', () => {
  const { cwd } = fresh();
  assert.deepEqual([taskIds(cwd, NOW).next, taskIds(cwd, NOW).followUp], [`${DAY} · T1`, null]);
  record(cwd, `${DAY} · T1`); record(cwd, `${DAY} · T2`); record(cwd, `${DAY} · T2b`);
  const ids = taskIds(cwd, NOW);
  assert.equal(ids.next, `${DAY} · T3`);
  assert.equal(ids.last, `${DAY} · T2`);
  assert.equal(ids.followUp, `${DAY} · T2c`);
  assert.equal(taskIds(cwd, new Date(2026, 9, 3, 9)).next, '2026-10-03 · T1', 'the counter restarts each day');
  assert.ok(validId(`${DAY} · T3`, ids));
  assert.ok(validId(`${DAY} · T1b`, ids), 'a follow-up of an older recorded task');
  assert.ok(!validId(`${DAY} · T2b`, ids), 'already recorded');
  assert.ok(!validId(`${DAY} · T9`, ids), 'never offered');
  assert.ok(!validId(`${DAY} · T7b`, ids), 'follow-up of a task that does not exist');
});

test('project slug: the project memory whose Path holds the folder, else the folder name', () => {
  fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
  fs.writeFileSync(path.join(home, 'projects', 'shop-api.md'), '# Project: shop-api\n\nPath: C:/Work/Shop API\n');
  assert.equal(projectSlug('c:\\work\\shop api\\src'), 'shop-api');
  assert.equal(projectSlug('/home/me/My App'), 'my-app');
});

test('decisions: chosen and discarded options from the choice window', () => {
  const d = decisionsIn([answered('¿Dónde?', ['Hook (Recomendado)', 'Respuesta', 'Agente'], 'Hook (Recomendado)')]);
  assert.deepEqual(d, [{ question: '¿Dónde?', chosen: 'Hook (Recomendado)', discarded: ['Respuesta', 'Agente'] }]);
  // Multi-select: Claude Code joins the labels with "," and no space (observed in this repo's own session).
  const m = decisionsIn([answered('¿Qué piezas?', ['Manifiesto (Recomendado)', 'Trailer (Recomendado)', 'Cadena', 'Verify'], 'Manifiesto (Recomendado),Trailer (Recomendado),Cadena')]);
  assert.deepEqual(m[0].discarded, ['Verify']);
  const s = decisionsIn([answered('¿Cómo?', ['Cola', 'Cola con reintentos'], 'Cola con reintentos')]);
  assert.deepEqual(s[0].discarded, ['Cola'], 'a label inside another label is still discarded');
});

test('chained log: each record links the previous one; an edited record breaks the chain', () => {
  const { cwd, log } = fresh();
  record(cwd, `${DAY} · T1`); record(cwd, `${DAY} · T2`); record(cwd, `${DAY} · T3`);
  const recs = readLog(cwd);
  assert.equal(recs[0].prev, null);
  assert.equal(recs[1].prev, recs[0].hash);
  assert.deepEqual(verifyChain(recs), { ok: true });
  const tampered = fs.readFileSync(log, 'utf8').replace(`${DAY} · T2"`, `${DAY} · T9"`);
  fs.writeFileSync(log, tampered);
  assert.deepEqual(verifyChain(readLog(cwd)), { ok: false, at: 1 });
  assert.deepEqual(verifyChain(readLog(cwd).filter((_, i) => i !== 1)), { ok: false, at: 1 }, 'a deleted record breaks it too');
});

test('inputs manifest: Waymark and agent version, model, MCP servers used', () => {
  const lines = [{ ...prompt('x'), version: '2.1.300' }, { type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'mcp__engram__mem_search', input: {} }, { type: 'tool_use', name: 'Read', input: {} }] } }];
  const inputs = turnInputs(lines, home);
  assert.equal(inputs.waymark, fs.readFileSync(path.join(SCRIPTS, '..', 'VERSION'), 'utf8').trim());
  assert.equal(inputs.agent, '2.1.300');
  assert.equal(inputs.model, 'claude-opus-5-5');
  assert.deepEqual(inputs.mcp, ['engram']);
  assert.equal(inputs.instructions.project, null);
});

test('commits: found by their Waymark-Task trailer', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-git-'));
  temps.push(repo);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', `feat: x\n\nWaymark-Task: ${DAY} · T4`);
  git('commit', '-q', '--allow-empty', '-m', 'chore: no trailer');
  const hits = commitsFor(repo, `${DAY} · T4`);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /^[0-9a-f]{40}$/);
  assert.deepEqual(commitsFor(repo, `${DAY} · T5`), []);
  assert.deepEqual(commitsFor(path.join(home, 'no-repo'), `${DAY} · T4`), []);
});

test('task lines: from the third-last prompt', () => {
  const lines = [prompt('a'), say('x'), prompt('b'), prompt('c'), say('y'), prompt('d')];
  assert.equal(taskLines(lines).length, 4);
});

// 3e-1 test (a real project, T3): a new task carried T2's answers and read its own question as "after" T2's first change.
test('3e-1b task lines: a new task starts after the session\'s last close; a follow-up inherits its task', () => {
  const t = (d, s) => ({ ...d, timestamp: `2026-10-04T10:${String(s).padStart(2, '0')}:00.000Z` });
  const lines = [t(prompt('haz T2'), 1), t(call('AskUserQuestion'), 2), t(answered('¿Cómo?', ['A', 'B'], 'A'), 3), t(call('Edit', { file_path: FILE }), 4), t(say('## Cierre · x'), 5),
    t(prompt('haz otra cosa'), 10), t(call('Edit', { file_path: FILE }), 11)];
  const records = [{ id: '2026-10-04 · T2', session: 's', at: '2026-10-04T10:06:00.000Z' }, { kind: 'Q', session: 's', at: '2026-10-04T10:08:00.000Z' }, { id: '2026-10-04 · T1', session: 'other', at: '2026-10-04T10:09:00.000Z' }];
  const fresh3 = taskLines(lines, { since: taskStart(records, 's', '2026-10-04 · T3') });
  assert.deepEqual([fresh3.length, decisionsIn(fresh3).length], [2, 0], 'a new task: after T2\'s close (a Q record and another session do not close it)');
  assert.equal(taskStart(records, 's'), Date.parse('2026-10-04T10:06:00.000Z'), 'no ID yet (the gate): the last close');
  assert.equal(decisionsIn(taskLines(lines, { since: taskStart(records, 's', '2026-10-04 · T2b') })).length, 1, 'a follow-up of T2 reads back to its task');
  assert.equal(taskLines(lines, { since: taskStart([], 's') }).length, lines.length, 'no close in this session: every line read');
});

test('3e-1b decision gate: the previous task\'s question does not open a new task after its close', () => {
  const { cwd } = fresh();
  const ts = (d, s) => ({ ...d, timestamp: `2026-10-04T11:${String(s).padStart(2, '0')}:00.000Z` });
  const lines = [ts(prompt('haz T2', 'g1'), 1), ts(say('Waymark → L2 · dept-backend'), 2), ts(call('AskUserQuestion'), 3), ts(answered('¿Cómo?', ['A', 'B'], 'A'), 4), ts(say('## Cierre · x'), 5),
    ts(prompt('ahora otra cosa', 'g2'), 10), ts(say('Waymark → L1 · dept-backend'), 11)];
  assert.equal(checkDecision(FILE, lines, 's-close', path.join(home, `gate-${n++}.json`), cwd), null, 'no close recorded: the 3e-1 window still sees the question');
  appendRecord(cwd, { id: `${DAY} · T2`, session: 's-close', at: '2026-10-04T11:06:00.000Z' });
  assert.match(checkDecision(FILE, lines, 's-close', path.join(home, `gate-${n++}.json`), cwd) || '', /L1 decision gate/);
});

test('decision gate (strict): denies every change until the user was asked in the choice window', () => {
  const state = path.join(home, `gate-${n++}.json`);
  const lines = [prompt('agrega reintentos', 'u1'), say('Waymark → L2 · dept-backend · skills: …'), call('Read', { file_path: FILE })];
  const deny = checkDecision(FILE, lines, 's1', state);
  assert.match(deny, /decision gate/);
  assert.match(deny, /AskUserQuestion/);
  assert.match(checkDecision(FILE, lines, 's1', state) || '', /decision gate/, 'the retry is denied too');
  assert.match(checkDecision(FILE, [...lines, prompt('otra cosa', 'u2'), say('Waymark → L2 · dept-backend')], 's1', state) || '', /decision gate/, 'a new prompt is gated again');
});

test('decision gate: L1 too (the user decides every real decision); silent after a choice, for Q and for memory files', () => {
  const state = path.join(home, `gate-${n++}.json`);
  const asked = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), PROC('dept-backend'), PACK(), call('AskUserQuestion', { questions: [] }), answered('Q', ['A', 'B'], 'A')];
  assert.equal(checkDecision(FILE, asked, 's2', state), null);
  assert.match(checkDecision(FILE, [prompt('typo'), say('Waymark → L1 · dept-frontend')], 's2', state) || '', /L1 decision gate/);
  assert.equal(checkDecision(FILE, [prompt('¿cómo?'), say('Waymark → Q · dept-qa')], 's2', path.join(home, `gate-${n++}.json`)) === null, false, 'a Q turn that edits is stopped');
  assert.equal(checkDecision(path.join(os.homedir(), '.waymark', 'projects', 'x.md'), [prompt('x'), say('Waymark → L3 · dept-architecture')], 's2', state), null);
});

test('decision gate: a turn routed Q that edits must re-route (once), then the normal gate applies', () => {
  const state = path.join(home, `gate-${n++}.json`);
  const q = [prompt('¿se puede mover el modal?', 'uq'), say('Waymark → Q · dept-frontend · skills: dept-frontend')];
  assert.match(checkDecision(FILE, q, 's3', state), /routed as a question/);
  assert.match(checkDecision(FILE, q, 's3', state) || '', /L2 decision gate|decision gate/, 'after the re-route notice the strict gate still applies');
  assert.match(checkDecision(FILE, [...q, say('Waymark → L2 · dept-frontend · skills: ui-build')], 's3', state) || '', /L2 decision gate/, 'the last routing line wins');
  assert.match(checkDecision(FILE, [...q, call('Skill', { skill: 'dept-frontend', args: 'L2' })], 's3', state) || '', /L2 decision gate/, 'a re-route by tool call wins (mid-turn text is not persisted)');
});

test('decision gate: procedure and mem_search are not denied any more (recorded and scored at the end)', () => {
  const asked = [prompt('agrega reintentos', 'up'), say('Waymark → L2 · dept-backend'), call('mcp__engram__mem_save', {}), call('AskUserQuestion'), answered('Q', ['A', 'B'], 'A')];
  assert.equal(checkDecision(FILE, asked, 's4', path.join(home, `gate-${n++}.json`)), null);
});

test('3c: the gate asks every work-shaping decision first and offers the browser; the branch is the user\'s, never pushed', () => {
  const repo = fs.mkdtempSync(path.join(os.homedir(), '.wm-branch-')); // outside temp, which the gate exempts
  temps.push(repo);
  spawnSync('git', ['init', '-q', '-b', 'feat/other-work'], { cwd: repo });
  const deny = checkDecision(path.join(repo, 'a.ts'), [prompt('x', 'ubr'), say('Waymark → L2 · dept-backend')], 's7', path.join(home, `gate-${n++}.json`));
  assert.ok(!/feat\/other-work|include where the work goes/.test(deny), 'no branch option pushed');
  assert.match(deny, /every decision that shapes the work/);
  assert.match(deny, /Never offer, recommend or run browser verification[^.]*unless the user asks/, 'T2l: the browser is never offered');
  assert.ok(!/test user|Playwright when/.test(deny));
  assert.match(deny, /Later questions only confirm; the user's answer is recorded as is/);
  assert.ok(!/→ confirmada|sub-decision/.test(deny), '3e-1: no prose markers left to write');
});

test('decision gate: shell commands that change project files are gated like edits', () => {
  const state = path.join(home, `gate-${n++}.json`);
  const lines = [prompt('quita el toggle', 'ub'), say('Waymark → L1 · dept-frontend')];
  assert.match(checkDecision({ command: 'git checkout HEAD -- src/app/modal.html src/app/modal.ts' }, lines, 's5', state) || '', /decision gate/);
  assert.equal(checkDecision({ command: 'npx vitest run src/app 2>&1 | tail -5' }, lines, 's5', state), null, 'read-only commands pass');
  assert.equal(checkDecision({ command: 'rm -rf "$T"; mktemp -d' }, lines, 's5', state), null, 'temp work passes');
});

test('shell mutations: what counts as changing files', () => {
  for (const c of ['git checkout HEAD -- a.ts', 'git restore a.ts', "sed -i 's/a/b/' x.ts", 'rm src/a.ts', 'echo x > src/a.ts', 'Set-Content src/a.ts x', 'git reset --hard']) assert.ok(mutatesFiles(c), c);
  for (const c of ['git status --short', 'npx tsc --noEmit 2>&1 | tail', 'grep -n x a.ts > /dev/null', 'git checkout develop', 'cat a.ts', 'node x.mjs 2>$null']) assert.ok(!mutatesFiles(c), c);
  assert.ok(!changesProject('rm -rf "$TMP/wm-1"'), 'temp folders are not the project');
  assert.ok(!changesProject('rm -rf /tmp/wm-1 C:/Users/u/AppData/Local/Temp/x'), 'system temp paths');
  assert.ok(changesProject('rm src/app/templates/old.html'), 'src/templates is the project, not temp');
  assert.ok(mutatesFiles('echo x > src/templates/a.html'), 'a redirect into src/templates changes the project');
});

test('git snapshot: files changed between the prompt and the end of the turn, by any tool', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-git-'));
  temps.push(repo);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  for (const f of ['a.ts', 'b.ts', 'c.ts']) fs.writeFileSync(path.join(repo, f), f);
  git('add', '.'); git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'dirty before the prompt');
  fs.writeFileSync(path.join(repo, 'b.ts'), 'dirty before, untouched by the turn');
  const before = gitSnapshot(repo);
  git('checkout', '-q', 'HEAD', '--', 'a.ts'); // reverted by the shell: back to clean
  fs.writeFileSync(path.join(repo, 'c.ts'), 'changed by the turn');
  fs.writeFileSync(path.join(repo, 'new.spec.ts'), 'untracked, new');
  const changed = snapshotDiff(before, gitSnapshot(repo)).map((p) => path.basename(p)).sort();
  assert.deepEqual(changed, ['a.ts', 'c.ts', 'new.spec.ts']);
  assert.equal(gitSnapshot(path.join(home, 'no-repo')), null);
});

// A complete L2 turn: routed, department invoked, choice asked and answered, file edited, code-review run.
const l2 = (extra = []) => currentTurn([
  prompt('agrega reintentos al servicio de pedidos'), say('Waymark → L2 · dept-backend · skills: code-review'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(),
  call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
  call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Skill', { skill: 'code-review' }), MEM(), ...extra,
]);
// The 3e-1 Cierre: Resultado · Evidencia · Aprendido. `decision` and `sub` add the old lines, which the hook no longer reads.
const cierre = (id, decision = null, resultado = 'Resultado: hecho\n', sub = null) =>
  `## Cierre · ${id}\n${resultado}${decision ? `Decisión: ${decision}\n` : ''}${sub ? `Sub-decisiones: ${sub}\n` : ''}Evidencia: observada timeouts en el log de pedidos\nAprendido: "backoff ← timeouts"`;
const ctxFor = (cwd, decisions = [{ question: '¿Cómo?', chosen: 'Backoff', discarded: ['Cola'] }]) => ({ ids: taskIds(cwd), decisions });

test('Cierre: a complete L2 record passes', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  assert.equal(checkCierre(l2(), cierre(ids.next), undefined, undefined, ctxFor(cwd)), null);
});

// A choice-window call and its answer with the ids Claude Code writes (the testigo places each answer by its call).
const askWithId = (id, question, labels, chosen) => [
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', id, input: { questions: [] } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } }];

test('3e-1 testigo decision: an answer before the first change passes; a later one is recorded "after" and does not count against it', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const head = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK()];
  const tail = [call('Bash', { command: 'node --check x && npm run build' }), call('Skill', { skill: 'code-review' }), MEM()];
  const lines = [...head, ...askWithId('q1', '¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), ...askWithId('q2', '¿Confirmo 3?', ['Sí', 'Otra cosa'], 'Sí'), ...tail];
  const ctx = { ids, decisions: decisionsIn(lines), taskTools: sessionTools(lines) };
  const g = cierreGaps(currentTurn(lines), cierre(ids.next), undefined, undefined, ctx);
  assert.deepEqual(g.missing, []);
  assert.equal(g.steps.find((s) => s.id === 'decision').pass, true);
  const rec = provenanceRecord(currentTurn(lines), g, ctx, {});
  assert.deepEqual(rec.decisions.map((d) => [d.chosen, d.position]), [['Backoff', 'before'], ['Sí', 'after']], 'recorded as is, with its position');
  const late = [...head, call('Edit', { file_path: FILE }), ...askWithId('q3', '¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), ...tail];
  const g2 = cierreGaps(currentTurn(late), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(late), taskTools: sessionTools(late) });
  assert.deepEqual(g2.missing, [], 'cannot be undone: not blocked');
  assert.equal(g2.steps.find((s) => s.id === 'decision').pass, false);
  assert.ok(g2.findings.some((f) => /first choice-window question came after the task's first change/.test(f)));
  const denied = [...head, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', id: 'e0', input: { file_path: FILE } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'e0', is_error: true, content: 'Waymark: L2 decision gate' }] } }, ...askWithId('q4', '¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), ...tail];
  assert.equal(cierreGaps(currentTurn(denied), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(denied), taskTools: sessionTools(denied) }).steps.find((s) => s.id === 'decision').pass, true, 'an edit the gate denied changed nothing');
});

// A shell run with its result: ok, or failed (is_error).
const ran = (id, command, failed = false) => [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: failed, content: failed ? 'exit 1' : 'ok' }] } }];

test('red by action: at L2+ a spec and code changed need the spec run before the first code change (or in a clean worktree); the word "rojo" means nothing', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd), SPECF = FILE.replace(/\.mjs$/, '.spec.mjs');
  const turn = ({ before = [], after = [], spec = true, route = 'L2' } = {}) => currentTurn([prompt('agrega reintentos'), say(`Waymark → ${route} · dept-backend`), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'),
    call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), ...(spec ? [call('Edit', { file_path: SPECF })] : []), ...before, call('Edit', { file_path: FILE }),
    call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Bash', { command: 'npm test -- orders' }), ...after, call('Skill', { skill: 'code-review' }), MEM()]);
  const step = (t, reply = cierre(ids.next)) => cierreGaps(t, reply, undefined, undefined, ctxFor(cwd)).steps.find((x) => x.id === 'red');
  assert.deepEqual([step(turn()).applies, step(turn()).pass], [true, false], 'spec and code changed, the spec never ran first');
  assert.match(checkCierre(turn(), cierre(ids.next), undefined, undefined, ctxFor(cwd)) || '', /never ran before the code it tests: show it red now in a clean copy/);
  assert.equal(step(turn({ before: [call('Bash', { command: 'npm test -- orders' })] })).pass, true, 'spec written, run red, then the code: test-first');
  assert.equal(step(turn({ after: [call('Bash', { command: 'git worktree add -q /tmp/w HEAD && (cd /tmp/w && npm test)' })] })).pass, true, 'shown red in a clean copy');
  assert.equal(step(turn({ spec: false }), cierre(ids.next).replace('observada timeouts', 'observada spec en rojo y luego verde')).applies, false, 'the word alone triggers nothing');
  assert.equal(step(turn({ route: 'L1' })).applies, false, 'L1 (2 files): recorded only');
  const why = `${cierre(ids.next)}\nTests: no (el spec nuevo cubre un caso que el código viejo no tenía)`;
  assert.equal(cierreGaps(turn(), why, undefined, undefined, { ...ctxFor(cwd), blocked: true }).steps.find((x) => x.id === 'red').pass, true, 'the way out its message names, after the block');
  assert.equal(step(turn(), why).pass, false, 'written before the block, it does not count');
});

test('pre-existing and docs by action: a failing gate asks for a clean copy; the same command failing twice asks for docs before the next run', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const head = [prompt('agrega reintentos'), say('Waymark → L1 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'),
    call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE })];
  const judge = (lines, reply = cierre(id), extra = {}) => cierreGaps(currentTurn(lines), reply, undefined, undefined, { ...ctx, ...extra });
  const pre = (g) => g.steps.find((x) => x.id === 'preexisting');
  // pre-existing: from the gate's exit, never from "ya fallaba"
  const failing = [...head, ...ran('g1', 'npx tsc --noEmit', true)];
  assert.deepEqual([pre(judge(failing)).applies, pre(judge(failing)).pass], [true, false]);
  assert.ok(judge(failing).missing.some((m) => /show the same failure in a clean copy now \(git worktree add <tmp> HEAD/.test(m)));
  assert.equal(pre(judge([...failing, ...ran('w1', 'git worktree add ../clean HEAD && cd ../clean && npx tsc --noEmit', true)])).pass, true);
  assert.equal(pre(judge(failing, `${cierre(id)}\nno comprobado (sin permiso para correr la suite)`, { blocked: true })).pass, true, 'or not checked, in the reply after the block');
  assert.equal(pre(judge([...head, ...ran('g2', 'npx tsc --noEmit')], `${cierre(id)}\nNota: contact-center.spec.ts ya fallaba antes`)).applies, false, 'a passing gate: the words trigger nothing');
  // docs: two failures of the same command, then a third run
  const docs = (g) => g.steps.find((x) => x.id === 'docs');
  const twice = [...head, ...ran('t1', 'npx tsc --noEmit', true), call('Edit', { file_path: FILE }), ...ran('t2', 'npx tsc --noEmit', true), call('Edit', { file_path: FILE })];
  const waiting = judge(twice);
  assert.deepEqual([docs(waiting).applies, docs(waiting).pass], [true, false]);
  assert.ok(waiting.missing.some((m) => /the same command failed twice \(npx tsc --noEmit\): consult the docs/.test(m)), 'not retried yet: blocks, docs first');
  const blind = judge([...twice, ...ran('t3', 'npx tsc --noEmit')]);
  assert.deepEqual([docs(blind).pass, blind.missing.some((m) => /consult the docs/.test(m))], [false, false], 'retried blind: too late to undo, recorded not blocked');
  assert.ok(blind.findings.some((m) => /failed twice and ran again without docs/.test(m)));
  assert.equal(docs(judge([...twice, call('Skill', { skill: 'library-docs' }), ...ran('t3', 'npx tsc --noEmit')])).pass, true, 'docs between the second failure and the next run');
  assert.equal(docs(judge([...twice, ...ran('t3', 'npx tsc --noEmit'), call('Skill', { skill: 'library-docs' })])).pass, false, 'docs after the retry is too late');
  assert.equal(docs(judge([...head, ...ran('t1', 'npx tsc --noEmit', true), call('Edit', { file_path: FILE }), ...ran('t2', 'npx tsc --noEmit')])).applies, false, 'one failure: no docs needed');
  assert.equal(docs(judge(failing, cierre(id).replace('observada timeouts en el log de pedidos', 'inferida de la doc de Meta Cloud API (check: x)'))).applies, false, '"inferida de docs" alone triggers nothing');
});
test('2b: a .ts with a sibling template counts as UI; a service does not', () => {
  const dir = fs.mkdtempSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '.tmp-ui-')); // the OS temp folder is exempt
  temps.push(dir);
  for (const f of ['article-form.ts', 'article-form.html', 'articles.service.ts']) fs.writeFileSync(path.join(dir, f), '');
  const ui = (file) => cierreGaps(currentTurn([prompt('x'), say('Waymark → L2 · dept-frontend'), call('Edit', { file_path: path.join(dir, file) })]), '## Cierre · x').observed.browser.ui;
  assert.equal(ui('article-form.ts'), true);
  assert.equal(ui('articles.service.ts'), false);
});

test('Cierre: task ID missing or reused, Resultado missing', () => {
  const { cwd } = fresh();
  record(cwd, `${taskIds(cwd).next}`);
  const ids = taskIds(cwd);
  const noId = checkCierre(l2(), cierre('').replace('## Cierre · ', '## Cierre'), undefined, undefined, ctxFor(cwd));
  assert.match(noId, /task ID in the heading/);
  assert.ok(noId.includes(ids.next) && noId.includes(ids.followUp), 'it offers both IDs');
  assert.match(checkCierre(l2(), cierre(ids.last), undefined, undefined, ctxFor(cwd)), /already recorded/);
  assert.match(checkCierre(l2(), cierre(ids.followUp, undefined, ''), undefined, undefined, ctxFor(cwd)), /Resultado:/);
});

test('3e-1: the decision is the choice window\'s answer, never the Cierre\'s words', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const prompts = ['hazlo con backoff exponencial, nada de colas'];
  assert.match(checkCierre(l2(), cierre(id), undefined, prompts, ctxFor(cwd, [])), /no choice-window answer in this task: ask the user now/);
  assert.match(checkCierre(l2(), cierre(id, 'del usuario ("hazlo con backoff exponencial")'), undefined, prompts, ctxFor(cwd, [])) || '', /no choice-window answer/, 'a quote in the Cierre no longer stands for the window');
  assert.match(checkCierre(l2(), cierre(id, 'única (el servicio ya expone retry())'), undefined, prompts, ctxFor(cwd, [])) || '', /no choice-window answer/);
  assert.equal(checkCierre(l2(), cierre(id, 'algo que el hook no lee'), undefined, prompts, ctxFor(cwd)), null, 'with an answer, whatever the old Decisión line says is ignored');
});

test('3e-1: an L1 Cierre is Resultado · Evidencia · Aprendido; older callers without ctx skip the ID and decision checks', () => {
  const turn = currentTurn([prompt('typo en el título'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend'), PACK(), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx eslint src/orders.service.mjs' }), MEM()]);
  const base = '## Cierre\nResultado: hecho\nEvidencia: observada el typo en el título\nAprendido: "x ← y"';
  assert.equal(checkCierre(turn, base), null);
  assert.match(checkCierre(turn, base.replace(/Evidencia: [^\n]*\n/, '')) || '', /Evidencia: observada/);
});

test('Cierre: a turn routed Q that changed files is checked as L2 and the routing blocks (Enrutar)', () => {
  const close = '## Cierre\nResultado: hecho · Decisión: única (x y z)\nSub-decisiones: ninguna\nEvidencia: observada el modal en /chat\nAprendido: "a ← b"';
  const head = [prompt('¿se puede mover el modal?'), say('Waymark → Q · dept-frontend · skills: dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend')];
  const tail = [call('Edit', { file_path: FILE }), call('Bash', { command: 'npx eslint src' }), MEM()];
  const g = cierreGaps(currentTurn([...head, ...tail]), close);
  assert.equal(g.level, 2);
  assert.ok(g.missing.some((f) => /routed as a question/.test(f)));
  assert.ok(g.missing.some((m) => /no review ran/.test(m)) && g.missing.some((m) => /run the build once/.test(m)), 'L2 with code: review and build block');
  assert.equal(cierreGaps(currentTurn([...head, call('Skill', { skill: 'dept-frontend', args: 'L1' }), ...tail]), close).level, 1, 're-routed to L1 by tool call');
});

test('routing: a routing line quoted mid-sentence does not override the real one', () => {
  const texts = ['Waymark → L2 · dept-devex · skills: dept-devex', 'Evidencia: la única línea de ruta fue `Waymark → Q · dept-frontend`, ver transcript'];
  assert.equal(routedLevel(texts), 2);
  assert.equal(routedDept(texts), 'dept-devex');
  assert.equal(routedLevel([...texts, 'Waymark → L1 · dept-qa · skills: …']), 1, 'a real re-route still wins');
});

test('3e-1: Sub-decisiones are not read any more (no prose markers to parse)', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  for (const sub of ['íconos en modales angostos → no preguntada', 'íconos', 'a → preguntada · b → no preguntada', 'x → única'])
    assert.equal(checkCierre(l2(), cierre(id, undefined, undefined, sub), undefined, undefined, ctx), null, sub);
});

test('owner department by action: the dept-* invoked, not the one the text names; none invoked blocks', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const noDept = currentTurn([prompt('x'), say('Waymark → L2 · dept-frontend · skills: ui-build'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Skill', { skill: 'code-review' })]);
  assert.ok(cierreGaps(noDept, cierre(id), undefined, undefined, ctx).missing.some((f) => /no owner department was invoked: invoke the owner dept-\* skill/.test(f)), 'named in the text but never invoked');
  const gaps = cierreGaps(l2(), cierre(id), undefined, undefined, ctx);
  assert.deepEqual(provenanceRecord(l2(), gaps, ctx, {}).department, { declared: 'dept-backend', invoked: ['dept-backend'] });
  const other = currentTurn([prompt('x'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx tsc --noEmit' })]);
  assert.equal(cierreGaps(other, cierre(id), undefined, undefined, ctx).dept.declared, 'dept-backend', 'the invocation wins over the text');
});

test('level by action: the declared level is a floor raised by the files the agent changed; L3 and a one-file L0 as declared', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const files = (k) => Array.from({ length: k }, (_, i) => call('Edit', { file_path: FILE.replace('.mjs', `${i}.mjs`) }));
  const turn = (route, k) => currentTurn([prompt('x'), say(`Waymark → ${route} · dept-backend`), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), ...files(k), call('Bash', { command: 'npx tsc --noEmit' })]);
  const level = (route, k) => cierreGaps(turn(route, k), cierre(id), undefined, undefined, ctx)?.level ?? null;
  assert.deepEqual([level('L1', 2), level('L1', 5), level('L2', 1), level('L3', 1)], [1, 2, 2, 3]);
  assert.deepEqual([level('L0', 1), level('L0', 3)], [null, 2], 'L0 keeps its skip for one file only');
  const unrouted = currentTurn([prompt('x'), ...files(3)]);
  assert.equal(cierreGaps(unrouted, 'listo', undefined, undefined, ctx)?.level, 2, 'no routing line and no Cierre: still judged by what changed');
});
test('observed: memory, procedure and review are computed from the tool calls, not declared', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const opened = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('mcp__engram__mem_search', { query: 'retries' }), call('Read', { file_path: path.join(os.homedir(), '.waymark', 'projects', 'shop.md') }), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Skill', { skill: 'code-review' }), MEM(), call('mcp__engram__mem_save', { topic_key: 'waymark/tasks/proj' })]);
  const g = cierreGaps(opened, cierre(id), undefined, undefined, { ...ctx, engram: true });
  assert.deepEqual(g.missing, []);
  assert.deepEqual(g.observed.memory, { searched: true, opened: true, written: true, saved: true, indexed: true });
  const noIndex = { ...opened, tools: opened.tools.filter((t) => t.name !== 'mcp__engram__mem_save') };
  assert.equal(checkCierre(noIndex, cierre(id), undefined, undefined, { ...ctx, engram: true }), null, '3e-2: one index, the git notes; no engram index required');
  assert.deepEqual(g.observed.procedure, { owner: 'dept-backend', read: ['dept-backend/procedures.md'], readBeforeChange: true });
  assert.equal(g.observed.review, true);
  assert.equal(g.observed.gates[0].cmd, 'node --check src/orders.service.mjs && npm run build');
  const noProc = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check x' }), call('Skill', { skill: 'code-review' })]);
  assert.ok(cierreGaps(noProc, cierre(id), undefined, undefined, ctx).missing.some((f) => /dept-backend\/procedures\.md never read/.test(f)));
});

test('observed: gate time and failures come from the tool results; the slowest command is kept', () => {
  const { cwd } = fresh();
  const t0 = Date.parse('2026-10-02T12:00:00Z');
  const at = (sec, line) => ({ ...line, timestamp: new Date(t0 + sec * 1000).toISOString() });
  const use = (id, name, input, sec) => at(sec, { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const res = (id, sec, isError = false) => at(sec, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'error TS2322' : 'ok', is_error: isError }] } });
  const turn = currentTurn([at(0, prompt('x')), say('Waymark → L1 · dept-backend'), use('a', 'Skill', { skill: 'dept-backend' }, 1), res('a', 1), use('b', 'Read', { file_path: '/skills/dept-backend/procedures.md' }, 2), res('b', 2),
    use('c', 'Edit', { file_path: FILE }, 3), res('c', 4), use('d', 'Bash', { command: 'npx tsc --noEmit' }, 5), res('d', 545, true), use('e', 'Bash', { command: 'npx eslint src' }, 546), res('e', 552)]);
  const g = cierreGaps(turn, '## Cierre\nResultado: hecho · Decisión: única (un solo cambio)\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a ← b"', undefined, undefined, ctxFor(cwd, []));
  assert.deepEqual(g.observed.gates.map((x) => [x.cmd, x.s, x.error]), [['npx tsc --noEmit', 540, true], ['npx eslint src', 6, false]]);
  assert.equal(g.observed.time.slowest.s, 540);
  assert.equal(g.observed.time.toolMinutes, 9.1);
});

test('Cierre: bold field names are read like plain ones', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const bold = cierre(id).replace(/^(Resultado|Decisión|Sub-decisiones|Evidencia|Aprendido):/gm, '**$1:**').replace('Resultado:', '**Resultado:**');
  assert.equal(checkCierre(l2(), bold, undefined, undefined, ctxFor(cwd)), null);
});


test('blocks: a spec next to the changed code untouched, unless Tests: no (<why>)', () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), '.wm-spec-near-')); // outside temp so it is not exempt
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'orders.spec.ts'), '');
  const code = path.join(dir, 'orders.ts');
  const lines = (extra = []) => currentTurn([prompt('x'), say('Waymark → L1 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('Edit', { file_path: code }), ...extra, call('Bash', { command: 'npx eslint src' }), MEM()]);
  const close = '## Cierre\nResultado: hecho · Decisión: única (un solo cambio)\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a ← b"';
  const near = (turn, reply, blocked = false) => cierreGaps(turn, reply, undefined, undefined, { blocked }).missing.some((f) => /sits next to the changed code/.test(f));
  assert.ok(near(lines(), close));
  assert.ok(!near(lines(), `${close}\nTests: no (solo cambia un texto de log)`, true));
  assert.ok(near(lines(), `${close}\nTests: no (solo cambia un texto de log)`), 'only in the reply after the block');
  assert.ok(!near(lines([call('Edit', { file_path: path.join(dir, 'orders.spec.ts') }), call('Bash', { command: 'npx vitest related orders.ts --run' })]), close));
});

test('Cierre: fields and claims are read from the Cierre block only, not the prose above it', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const prose = 'Cambios:\n1. la decisión: tuya, siempre\n- navegador, docs, fallos previos: se registran\n\n';
  const g = cierreGaps(l2(), prose + cierre(id), undefined, undefined, ctxFor(cwd));
  assert.deepEqual(g.missing, []);
  assert.ok(!g.findings.some((f) => /pre-existing/.test(f)));
});

test('Cierre: an empty field does not take the next line as its value', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  assert.match(checkCierre(l2(), cierre(id, undefined, 'Resultado:\n'), undefined, undefined, ctxFor(cwd)), /Resultado: hecho \| parcial/);
});

test('branches: the branch of each repo that holds a changed file', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-git-'));
  temps.push(repo);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'feat/replies'); fs.writeFileSync(path.join(repo, 'a.ts'), 'a'); git('add', '.'); git('commit', '-q', '-m', 'i');
  const b = branchesOf([path.join(repo, 'a.ts')]);
  assert.deepEqual(Object.values(b), ['feat/replies']);
});

test('Cierre: gates run after the last change (typecheck after code, tests after a spec)', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  assert.match(checkCierre(l2([call('Edit', { file_path: '/work/proj/src/late.ts' })]), cierre(id), undefined, undefined, ctx), /no typecheck, lint or build ran after the last code change/);
  assert.match(checkCierre(l2([call('Bash', { command: 'npx vitest run src' }), call('Write', { file_path: '/work/proj/src/a.spec.ts' }), call('Bash', { command: 'npx tsc --noEmit' })]), cierre(id), undefined, undefined, ctx), /spec changed after the last test run/);
  assert.match(checkCierre(l2([call('Bash', { command: 'git checkout HEAD -- src/a.ts' })]), cierre(id), undefined, undefined, { ...ctx, gitChanged: ['/work/proj/src/a.ts'] }), /after the last code change/, 'a shell change counts as a change');
});

test('Cierre: files changed through the shell are checked and recorded', () => {
  const { cwd } = fresh();
  const ctx = { ...ctxFor(cwd), gitChanged: ['/work/proj/src/modal.html', '/work/proj/src/modal.ts'] };
  const turn = currentTurn([prompt('x'), say('Waymark → L2 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), call('Bash', { command: 'git checkout HEAD -- src/modal.html src/modal.ts' })]);
  const gaps = cierreGaps(turn, '## Cierre\nResultado: hecho', undefined, undefined, ctx);
  assert.deepEqual(gaps.changed, ['/work/proj/src/modal.html', '/work/proj/src/modal.ts']);
  assert.ok(gaps.missing.some((m) => /code-review/.test(m)), 'shell-changed code still needs review');
  assert.ok(gaps.missing.some((m) => /after the last code change/.test(m)), 'and still needs a gate after it');
});

test('findings: a commit made in the turn without the Waymark-Task trailer', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, withCommit = l2([call('Bash', { command: 'git add -A && git commit -F msg.txt' })]);
  const trailer = (turn, commits) => cierreGaps(turn, cierre(id), undefined, undefined, { ...ctxFor(cwd), commits }).findings.some((f) => /Waymark-Task/.test(f));
  assert.ok(trailer(withCommit, []));
  assert.ok(!trailer(withCommit, ['abc']));
  assert.ok(!trailer(l2(), []), 'no commit, no trailer needed');
});

test('3e-2: the Aprendido is not the agent\'s memory edit any more: the hook writes the line', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const noMem = currentTurn([prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check x' })]);
  assert.doesNotMatch(checkCierre(noMem, cierre(id), undefined, undefined, ctxFor(cwd)) || '', /project memory/);
});

test('bugs of test 2.0-4: an empty search is not a read; a commit is not a change', () => {
  assert.equal(readSomething({ name: 'Grep', out: 'No matches found' }), false);
  assert.equal(readSomething({ name: 'Grep', out: '19:### Bug fix (L1/L2)' }), true);
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const emptyGrep = currentTurn([prompt('x'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx eslint x' }), MEM()]);
  const all = [...emptyGrep.tools.slice(0, 1), { name: 'Grep', input: { pattern: '^## Bug fix', path: '/skills/dept-frontend/procedures.md' }, out: 'No matches found' }, ...emptyGrep.tools.slice(1)];
  const g = cierreGaps(emptyGrep, '## Cierre\nResultado: hecho · Decisión: única (uno)\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a"', all, undefined, ctxFor(cwd, []));
  assert.ok(g.missing.some((f) => /procedures\.md never read/.test(f)));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-git-'));
  temps.push(repo);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
  git('init', '-q'); fs.writeFileSync(path.join(repo, 'a.ts'), 'a'); git('add', '.'); git('commit', '-q', '-m', 'i');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'edited before the prompt');
  const before = gitSnapshot(repo);
  git('commit', '-q', '-am', 'commit only');
  assert.deepEqual(snapshotDiff(before, gitSnapshot(repo)), [], 'committing keeps the content: not a change');
});

test('evaluation: one ✔/✘ per routine step, a score, tokens and the estimated quota', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const noSearch = currentTurn([prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Skill', { skill: 'code-review' }), MEM()]);
  const ev = evaluate(cierreGaps(noSearch, cierre(id), undefined, undefined, ctx), { total: 2700000 });
  assert.deepEqual(ev.steps, { Decision: true, Verificar: true, Cierre: true, Secretos: true, Recordar: false, Review: true, Build: true, Enrutar: true, Cadena: true });
  assert.equal(ev.score, '8/9');
  assert.deepEqual([ev.quotaPct, ev.quotaBy], [null, 'none'], 'a model without calibration pairs: no %');
  assert.match(summaryLine(id, ev), /Recordar ✘ .* 8\/9 · 2\.70M tokens · ¿qué % marcó tu cuota/);
  assert.match(checkCierre(noSearch, cierre(id), undefined, undefined, ctx), /the project memory was not searched before the first change: run waymark\.mjs pack/, 'one memory: Waymark\'s, with or without engram');
  assert.equal(checkCierre(l2(), cierre(id), undefined, undefined, ctx), null, 'waymark.mjs pack is the search');
  const viaEngram = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('mcp__engram__mem_search', { query: 'retries' }), call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: 'npm run build' }), call('Skill', { skill: 'code-review' }), MEM()]);
  assert.equal(checkCierre(viaEngram, cierre(id), undefined, undefined, ctx), null, 'or mem_search, for whoever uses engram');
});

test('turn usage: each streamed message counted once', () => {
  const u = (id, usage) => ({ type: 'assistant', message: { id, usage, content: [] } });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 };
  assert.deepEqual(turnUsage([prompt('x'), u('m1', usage), u('m1', usage), u('m2', usage)]), { total: 2230, fresh: 230, input: 20, cacheWrite: 200, cacheRead: 2000, output: 10, responses: 2 });
});

test('calibration: the user\'s pairs per model drive the quota estimate (mean, then a fit of new vs cached tokens)', async () => {
  const { estimate, addPair, pairsFile } = await import(`file://${SCRIPTS}/calibrate.mjs`);
  const M = 'claude-test-model';
  assert.deepEqual(estimate({ total: 2700000 }, M), { pct: null, by: 'none' }, 'no pairs for the model: no scale, no %');
  const repo = tmpRepo('calib');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  fs.writeFileSync(path.join(repo, '.waymark', 'provenance.jsonl'), [
    { id: '2026-10-03 · T1', inputs: { model: M }, evaluation: { tokens: 7200000 } }, // an old record: total only
    { id: '2026-10-03 · T2', inputs: { model: M }, evaluation: { tokens: 3000000, usage: { input: 0, cacheWrite: 0, cacheRead: 2000000, output: 1000000 } } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.equal(addPair('2026-10-03 · T1', 9, repo).total, 7200000);
  assert.deepEqual(estimate({ total: 1600000 }, M), { pct: 2, by: 'pairs:1' }, '800k per 1% from the pair');
  assert.deepEqual(estimate({ total: 1600000 }, 'other-model'), { pct: null, by: 'none' }, 'per model: another model (another agent\'s quota window) borrows no scale');
  const p2 = addPair('2026-10-03 · T2', 3, repo);
  assert.deepEqual([p2.fresh, p2.cacheRead], [1000000, 2000000]);
  fs.appendFileSync(pairsFile(), [{ model: M, pct: 2, total: 3000000, fresh: 500000, cacheRead: 2500000 }, { model: M, pct: 4, total: 4000000, fresh: 1500000, cacheRead: 2500000 }].map((p) => JSON.stringify(p)).join('\n') + '\n');
  const fit = estimate({ total: 3000000, fresh: 1000000, cacheRead: 2000000 }, M);
  assert.equal(fit.by, 'fit:3', 'three pairs with a split: new and cached tokens weighed apart');
  assert.ok(fit.pct > 2.5 && fit.pct < 3.5, String(fit.pct));
  assert.throws(() => addPair('2026-10-03 · T9', 5, repo), /not in/);
});

test('provenance record: what the transcript proves, the hook assigns an ID when the reply has none', () => {
  const { cwd } = fresh();
  const ctx = ctxFor(cwd), turn = l2();
  const rec = provenanceRecord(turn, cierreGaps(turn, '## Cierre\nResultado: hecho', undefined, undefined, ctx), ctx, { session: 's', cwd });
  assert.equal(rec.id, ctx.ids.next);
  assert.equal(rec.idBy, 'hook');
  assert.deepEqual(rec.files, [FILE]);
  assert.deepEqual(rec.skills, ['dept-backend', 'code-review']);
  assert.equal(rec.decisions[0].chosen, 'Backoff');
  assert.ok(rec.unresolved.length > 0);
});

test('catalog of testigos: each states its claim; the instructions block quotes every claim that blocks, and the guide points to the catalog', () => {
  const routine = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'routine.json'), 'utf8'));
  const block = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'instructions.md'), 'utf8');
  assert.ok(!('steps' in routine) && routine.testigos.every((t) => t.id && t.label && t.claim && t.levels?.length && /^(block|record)$/.test(t.enforce)), 'routine.json is the catalog (3e-1)');
  for (const id of ['decision', 'gate', 'review', 'chain', 'secrets', 'trailer']) assert.ok(routine.testigos.some((t) => t.id === id), `ADR 0012 first testigo: ${id}`);
  for (const st of routine.testigos.filter((x) => x.enforce === 'block')) assert.ok(block.includes(st.claim.replace(/^the Cierre complete \(.*\)$/, 'the Cierre complete (Resultado · Evidencia · Aprendido)')), `instructions.md must quote: "${st.claim}"`);
  const guide = fs.readFileSync(path.join(SCRIPTS, '..', 'references', 'evaluation.md'), 'utf8');
  assert.ok(guide.includes('routine.json'), 'evaluation.md must defer to routine.json');
  assert.ok(!/^\| Check \| ✔ when/m.test(guide), 'evaluation.md must not define its own rubric table');
});

test('per-prompt line: new task and follow-up IDs', () => {
  const { cwd } = fresh();
  assert.match(taskLine(cwd, NOW), new RegExp(`new task → ${DAY} · T1\\.$`));
  record(cwd, `${DAY} · T1`);
  assert.match(taskLine(cwd, NOW), new RegExp(`new task → ${DAY} · T2 · follow-up of ${DAY} · T1 → ${DAY} · T1b`));
});

// End to end: the Stop hook as Claude Code runs it (stdin JSON, transcript file).
function runStop(lines, last, extra = {}) {
  const { cwd, log } = fresh();
  const transcript = path.join(home, `t-${n}.jsonl`);
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 's9', last_assistant_message: last, ...extra }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  return { out: r.stdout, records: fs.existsSync(log) ? readLog(cwd) : [], ids: taskIds(cwd) };
}
const l2Lines = [prompt('agrega reintentos al servicio de pedidos'), say('Waymark → L2 · dept-backend · skills: code-review'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Skill', { skill: 'code-review' }), MEM()];

test('stop hook: a backed Cierre is recorded and not blocked', () => {
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const { out, records } = runStop(l2Lines, cierre(id));
  assert.match(JSON.parse(out).systemMessage, /^Waymark .* · 9\/9 · /);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, id);
  assert.deepEqual(records[0].unresolved, []);
  assert.equal(records[0].evaluation.score, '9/9');
  assert.match(records[0].cierre, /^## Cierre · /);
});

test('stop hook: an unbacked Cierre is blocked once, then recorded with what stayed unbacked', () => {
  const first = runStop(l2Lines, '## Cierre\nGates: ✔');
  assert.equal(JSON.parse(first.out).decision, 'block');
  assert.equal(first.records.length, 0);
  const second = runStop(l2Lines, '## Cierre\nGates: ✔', { stop_hook_active: true });
  assert.match(JSON.parse(second.out).systemMessage, /Cierre ✘/);
  assert.equal(second.records.length, 1);
  assert.equal(second.records[0].idBy, 'hook');
  assert.ok(second.records[0].unresolved.some((m) => /Resultado/.test(m)));
});

test('stop hook: the block reason fed back as a user line does not split the turn', () => {
  const fed = { type: 'user', message: { role: 'user', content: 'Stop hook feedback:\nWaymark: this L2 turn changed files but its Cierre is not backed…' } };
  const second = runStop([...l2Lines, say('## Cierre'), fed], '## Cierre\nGates: ✔', { stop_hook_active: true });
  assert.equal(second.records.length, 1);
  assert.deepEqual(second.records[0].files, [FILE]);
});

test('stop hook: without project memory, a Q turn leaves no record (with memory: the short Q record, step 3 below)', () => {
  assert.equal(runStop([prompt('¿qué hace esto?'), say('Waymark → Q · dept-qa'), call('Read', { file_path: FILE })], 'Respuesta').records.length, 0);
});

// ---- Step 2: project memory in <project>/.waymark/ (docs/adr/0007) ----
const { projectHome, ensureLocal, tasksMarkdown, taskSummary, refreshTasks, readRecords, closeOpen, readTaskRecords, writeTaskLine, readNotes, tidyWip, confirmTasks, workspaceSiblings, expireOpen: expireOpenT } = await import(`file://${SCRIPTS}/provenance.mjs`);
const { planFor, apply } = await import(`file://${SCRIPTS}/migrate-memory.mjs`);
const tmpRepo = (name) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `waymark-${name}-`));
  temps.push(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  return repo;
};
const oldMemory = (slug, root, wip = '- ▶ task A (2026-10-01 · T2): NEXT step 2') => {
  fs.mkdirSync(path.join(home, 'projects'), { recursive: true });
  const file = path.join(home, 'projects', `${slug}.md`);
  fs.writeFileSync(file, `# Project: ${slug}\n\nPath: ${root}\n\n## Work in progress\n${wip}\n\n## Identity\n- Stack: test\n`);
  return file;
};
const excludeOf = (repo) => fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'); // where Waymark keeps .waymark/ out of git
const same = (a, b) => assert.equal(path.resolve(a).toLowerCase(), path.resolve(b).toLowerCase());

test('project home: nearest .waymark/memory.md walking up, else the old memory (bridge), else the git root, else the home layout', () => {
  const repo = tmpRepo('home');
  const sub = path.join(repo, 'src', 'app');
  fs.mkdirSync(sub, { recursive: true });
  const none = projectHome(sub);
  same(none.dir, path.join(repo, '.waymark'));
  assert.equal(none.legacy, false, 'git repo without memory → <git root>/.waymark/');
  const old = oldMemory('legacy-proj', repo);
  const bridge = projectHome(sub);
  assert.equal(bridge.legacy, true);
  assert.equal(bridge.memory, old);
  assert.equal(bridge.log, path.join(home, 'provenance', 'legacy-proj.jsonl'));
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# Project: legacy-proj\n');
  const now = projectHome(sub);
  assert.equal(now.legacy, false, 'the project folder wins over the old file');
  same(now.log, path.join(repo, '.waymark', 'provenance.jsonl'));
  assert.equal(projectHome('/work/nowhere-1').dir, null, 'outside git and without memory → the home layout');
  fs.rmSync(old);
});

test('ensureLocal: .waymark/ added once to the project\'s .gitignore (created if missing, kept if there), README written', () => {
  const repo = tmpRepo('exclude');
  const h = projectHome(repo);
  ensureLocal(h); ensureLocal(h);
  const ignore = fs.readFileSync(path.join(repo, '.gitignore'), 'utf8');
  assert.equal(ignore.match(/^\.waymark\/$/gm).length, 1);
  assert.match(fs.readFileSync(path.join(repo, '.waymark', 'README.md'), 'utf8'), /tasks\.md/);
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), 'x');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout.trim(), '?? .gitignore', 'git sees only the .gitignore, never .waymark/');
  const other = tmpRepo('exclude-own');
  fs.writeFileSync(path.join(other, '.gitignore'), 'node_modules/');
  ensureLocal(projectHome(other));
  assert.equal(fs.readFileSync(path.join(other, '.gitignore'), 'utf8'), 'node_modules/\n# Waymark: project memory, local only\n.waymark/\n', 'appended after the user\'s lines');
});

test('quota: a model with no pairs of its own gets an uncalibrated estimate from a calibrated model of its family, and the % is still asked', async () => {
  const { estimate, pairsFile } = await import(`file://${SCRIPTS}/calibrate.mjs`);
  fs.mkdirSync(path.dirname(pairsFile()), { recursive: true });
  fs.appendFileSync(pairsFile(), JSON.stringify({ model: 'claude-big-9', pct: 2, total: 2000000 }) + '\n');
  const est = estimate({ total: 3000000 }, 'claude-small-9');
  assert.ok(est.pct > 0 && est.by.startsWith('family:claude-'), `the family's pairs give it an estimate: ${JSON.stringify(est)}`);
  assert.deepEqual(estimate({ total: 3000000 }, 'gpt-other'), { pct: null, by: 'none' }, 'another family borrows nothing');
  const line = summaryLine('x', { steps: { Decision: true }, score: '1/1', tokens: 3e6, quotaPct: 3, quotaBy: 'family:claude-big-9' });
  assert.match(line, /≈ 3% de la cuota \(sin calibrar, factor de claude-big-9\) · ¿qué % marcó tu cuota/);
});

test('workspace: the card of a project shows the other projects of its workspace (open ▶ and the last closed); a generic parent is no workspace', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-acme-workspace-'));
  temps.push(ws);
  const mk = (name, wip = '') => { const d = path.join(ws, name); fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), `# P\n\n## Work in progress\n${wip}\n## Identity\n- x\n`); return d; };
  const api = mk('acme-api', '- ▶ [2026-10-05 · T3] el FE debe usar /v2/login'), fe = mk('acme-web');
  appendRecord(api, { id: '2026-10-05 · T2', agent: 'claude', cierre: '## Cierre · 2026-10-05 · T2\nResultado: hecho\nEvidencia: e\nAprendido: login con OTP en /v2/login' });
  assert.deepEqual(P.workspaceSiblings(fe).map((h) => path.basename(h.root)), ['acme-api']);
  const card = JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: fe }), encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout).hookSpecificOutput.additionalContext;
  assert.match(card, /Workspace \(projects next to this one[^\n]*\n- acme-api \(open ▶ 2026-10-05 · T3\):\n {2}- 2026-10-05 · T2 · claude · login con OTP en \/v2\/login/);
  const generic = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-projects-'));
  temps.push(generic);
  for (const n of ['a', 'b']) { fs.mkdirSync(path.join(generic, n, '.waymark'), { recursive: true }); fs.writeFileSync(path.join(generic, n, '.waymark', 'memory.md'), '# P\n'); }
  assert.deepEqual(P.workspaceSiblings(path.join(generic, 'a')), [], 'a parent that is no workspace: unrelated projects stay out');
  fs.writeFileSync(path.join(generic, 'x.code-workspace'), '{}');
  assert.deepEqual(P.workspaceSiblings(path.join(generic, 'a')).map((h) => path.basename(h.root)), ['b'], 'a .code-workspace file makes it one');
});

test('migration: dry run writes nothing; apply moves memory and log byte for byte, chain intact, stub, exclude, backup', () => {
  const repo = tmpRepo('migrate');
  const backups = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-bk-'));
  temps.push(backups);
  process.env.WAYMARK_BACKUPS = backups;
  const oldFile = oldMemory('mig', repo);
  fs.writeFileSync(path.join(home, 'projects.md'), '| Project | Path | Memory |\n| mig | x | projects/mig.md |\n');
  const oldLog = path.join(home, 'provenance', 'mig.jsonl');
  appendRecord(repo, { id: '2026-10-01 · T1', prompt: 'first', cierre: '## Cierre\nResultado: hecho', evaluation: { score: '5/5' } });
  appendRecord(repo, { id: '2026-10-01 · T2', prompt: 'second', cierre: '## Cierre\nResultado: parcial (x)', evaluation: { score: '4/5' } });
  const bytes = fs.readFileSync(oldLog, 'utf8');
  const plan = planFor({ slug: 'mig', file: oldFile, root: repo });
  assert.equal(plan.skip, undefined);
  assert.equal(plan.records, 2);
  assert.ok(plan.chain.ok);
  assert.ok(!fs.existsSync(path.join(repo, '.waymark')), 'the plan writes nothing');
  const bk = apply(plan);
  assert.equal(fs.readFileSync(path.join(repo, '.waymark', 'provenance.jsonl'), 'utf8'), bytes, 'log copied byte for byte');
  assert.ok(verifyChain(readRecords(path.join(repo, '.waymark', 'provenance.jsonl'))).ok);
  assert.match(fs.readFileSync(path.join(repo, '.waymark', 'memory.md'), 'utf8'), /task A \(2026-10-01 · T2\): NEXT step 2/);
  assert.match(fs.readFileSync(oldFile, 'utf8'), /^Moved: .*\.waymark\/memory\.md/m);
  assert.ok(!fs.existsSync(oldLog), 'old log removed');
  assert.ok(fs.existsSync(path.join(bk, 'mig.md')) && fs.existsSync(path.join(bk, 'mig.jsonl')), 'backup first');
  assert.match(fs.readFileSync(path.join(home, 'projects.md'), 'utf8'), /\| mig \| x \| .*\.waymark\/memory\.md \|/);
  assert.match(excludeOf(repo), /^\.waymark\/$/m);
  const tasks = fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8');
  assert.match(tasks, /## In progress \/ pending\n- 2026-10-01 · T2 · en curso · próximo: step 2/);
  assert.match(tasks, /\| 2026-10-01 · T2 \| parcial \(x\) \| 4\/5 \| second \|\n\| 2026-10-01 · T1 \| hecho \| 5\/5 \| first \|/);
  assert.equal(projectHome(repo).legacy, false);
  assert.equal(taskIds(repo, new Date(2026, 9, 1)).next, '2026-10-01 · T3', 'IDs continue from the migrated record');
  assert.match(planFor({ slug: 'mig', file: oldFile, root: repo }).skip || '', /already exists/, 'never overwritten');
  delete process.env.WAYMARK_BACKUPS;
});

test('tasks.md: generated from memory and the log, never for the bridge', () => {
  const repo = tmpRepo('tasks');
  const old = oldMemory('bridge-only', repo);
  assert.equal(refreshTasks(projectHome(repo)), false, 'bridge: nothing written into the project');
  assert.ok(!fs.existsSync(path.join(repo, '.waymark')));
  fs.rmSync(old);
  fs.mkdirSync(path.join(repo, '.waymark'));
  const mem = path.join(repo, '.waymark', 'memory.md');
  fs.writeFileSync(mem, '# P\n\n## Work in progress\n'
    + `- ▶ Big step (2026-10-03 · T2, L3): plan ✔a · ▶b-gate · c. ${'detail '.repeat(300)}NEXT run the gate ${'x'.repeat(400)}\n`
    + '- [2026-10-03 · T3] KB form: fixed. Pendiente: verificación visual del usuario\n'
    + '- STEP SPEC (2026-10-03): long notes\n- PLAN: next session as 2026-10-02 · T2b\n- Last request: old\n');
  const h = projectHome(repo);
  const md = tasksMarkdown(h);
  const lines = md.split('\n');
  assert.ok(lines.includes('- 2026-10-03 · T3 · pendiente · próximo: verificación visual del usuario'), md);
  const t2 = lines.find((l) => l.startsWith('- 2026-10-03 · T2 · en curso · paso b-gate · próximo: run the gate'));
  assert.ok(t2 && t2.length <= 300 && t2.endsWith('…'), 'one task line, compact');
  assert.match(md, /- \(3 more notes in memory\.md, not tasks\)[\s\S]*## Done \(last 0/);
  assert.ok(!/STEP SPEC|T2b|Last request/.test(md), 'notes stay in memory.md, also one that quotes a task ID');
  assert.equal(taskSummary('- [2026-10-03 · T1] Next.js upgrade: router done. Pendiente: deploy'), '- 2026-10-03 · T1 · pendiente · próximo: deploy');
  assert.equal(taskSummary('- ▶ X (2026-10-03 · T4): rendered as NEXT/Pendiente: fragment. NEXT ship it'), '- 2026-10-03 · T4 · en curso · próximo: fragment · ship it', '3c: every pending part is kept, in order');
  assert.equal(taskSummary('- ▶ Y (2026-10-03 · T5): Pendiente: paso 2 (spec) · Pendiente: paso 3'), '- 2026-10-03 · T5 · en curso · próximo: paso 2 (spec) · paso 3', '3c: "paso 2" is no longer lost');
  assert.equal(taskSummary('- ▶ Z (2026-10-03 · T6): bug: the last "Pendiente:" won, fixed. NEXT ✔ push'), '- 2026-10-03 · T6 · en curso · próximo: ✔ push', 'a marker inside quotes is text');
  assert.equal(refreshTasks(h), true);
  assert.equal(refreshTasks(h), false, 'up to date: not rewritten');
  fs.writeFileSync(h.log, JSON.stringify({ id: '2026-10-03 · T3', at: '2026-10-03T15:00:00Z', prompt: 'p',
    cierre: `## Cierre · 2026-10-03 · T3\nResultado: hecho · **Decisión:** del usuario ("Backoff")\nSub-decisiones: límite → preguntada\nEvidencia: observada ${'e'.repeat(300)}\nAprendido: backoff ← timeouts`,
    evaluation: { score: '6/7', steps: { Decision: true, Review: false } } }) + '\n');
  const last = tasksMarkdown(h);
  assert.match(last, /## Last closed: 2026-10-03 · T3 \([^)]*full record: last line of provenance\.jsonl\)\n- Resultado: hecho\n- Decisión: del usuario \("Backoff"\)\n- Sub-decisiones: límite → preguntada\n- Evidencia: observada e+…\n- Aprendido: backoff ← timeouts\n- Evaluación: 6\/7 \(✘ Review\)/);
  assert.ok(last.split('\n').find((l) => l.startsWith('- Evidencia:')).length <= 234, '~220 per field');
  fs.rmSync(h.log);
  fs.writeFileSync(mem, '# P\n\n## Work in progress\n- Updated: 2026-10-02\n- Task 3: Clientes multiselect\n- Decision 3: x\n- Next: probar en navegador\n');
  assert.match(tasksMarkdown(h), /- Task 3: Clientes multiselect\n- Next: probar en navegador\n- \(2 more notes/, 'no IDs (old format): its Task/Next lines');
});

test('tasks.md: stays within ~3,000 characters: done rows down to 3, then the oldest in-progress lines (+n more)', () => {
  const repo = tmpRepo('tasks-budget');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n'
    + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `- ▶ T (2026-10-03 · T${n}): NEXT ${'y'.repeat(400)}`).join('\n') + '\n');
  const h = projectHome(repo);
  fs.writeFileSync(h.log, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => JSON.stringify({ id: `2026-10-02 · T${n}`, cierre: `Resultado: hecho ${'z'.repeat(80)}`, prompt: 'p'.repeat(200) })).join('\n') + '\n');
  const md = tasksMarkdown(h);
  assert.ok(md.length <= 3000, `${md.length}`);
  assert.match(md, /## Done \(last 3, newest first\)\n[^\n]*\n[^\n]*\n\| 2026-10-02 · T8 \|/, 'three done rows kept');
  const shown = md.split('\n').filter((l) => l.startsWith('- 2026-10-03'));
  assert.ok(shown.length < 9 && shown.some((l) => l.startsWith('- 2026-10-03 · T9 ')) && !shown.some((l) => l.startsWith('- 2026-10-03 · T1 ')), 'the oldest task lines leave first');
  assert.match(md, new RegExp(`- \\(\\+${9 - shown.length} more tasks in memory\\.md\\)`));
});

test('stop hook: with memory in the project, the record and tasks.md go to <project>/.waymark/ and memory edits are not changes', () => {
  const repo = tmpRepo('stop');
  fs.mkdirSync(path.join(repo, '.waymark'));
  const mem = path.join(repo, '.waymark', 'memory.md');
  fs.writeFileSync(mem, '# P\n\n## Work in progress\n- ▶ retries (2026-10-01 · T5): NEXT deploy\n');
  const transcript = path.join(home, 't-step2.jsonl');
  const lines = [...l2Lines.slice(0, -1), call('Edit', { file_path: mem })];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: repo, session_id: 's-step2', last_assistant_message: cierre(id) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.match(JSON.parse(r.stdout).systemMessage, /· 9\/9 · /);
  const recs = readRecords(path.join(repo, '.waymark', 'provenance.jsonl'));
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].files, [FILE], 'the memory edit is not a project change');
  assert.match(fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8'), new RegExp(`- 2026-10-01 · T5 · en curso · próximo: deploy[\\s\\S]*## Last closed: ${id} · claude [\\s\\S]*\\| ${id} · claude \\| hecho`), 'the agent that closed it is shown');
  assert.equal(recs[0].agent, 'claude');
  assert.match(excludeOf(repo), /^\.waymark\/$/m);
  const bare = tmpRepo('stop-bare'); // no memory at all: the record still lands excluded from git
  const r2 = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: bare, session_id: 's-step2b', last_assistant_message: cierre(id) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.ok(r2.stdout);
  assert.equal(readRecords(path.join(bare, '.waymark', 'provenance.jsonl')).length, 1);
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: bare, encoding: 'utf8' }).stdout.trim(), '?? .gitignore', 'git does not see .waymark/, only the .gitignore that keeps it out');
  const logOnly = tmpRepo('mig-log');
  fs.mkdirSync(path.join(logOnly, '.waymark'));
  fs.writeFileSync(path.join(logOnly, '.waymark', 'provenance.jsonl'), '{}\n');
  assert.match(planFor({ slug: 'x', file: oldMemory('mig-log', logOnly), root: logOnly }).skip || '', /provenance\.jsonl already exists/, 'an existing log is never overwritten');
});

test('open.json: the per-prompt hook marks the turn started; the end of the turn closes it', () => {
  const repo = tmpRepo('open');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n- ▶ A (2026-10-01 · T1): NEXT b\n');
  const env = { ...process.env, WAYMARK_HOME: home, WAYMARK_REPO: 'invalid/none' };
  spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { input: JSON.stringify({ cwd: repo, session_id: 's-open', prompt: 'arregla   el login\nya' }), env, encoding: 'utf8' });
  const open = JSON.parse(fs.readFileSync(path.join(repo, '.waymark', 'open.json'), 'utf8'));
  assert.equal(open['s-open'].prompt, 'arregla el login ya');
  const tasks = () => fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8');
  assert.match(tasks(), /## Started, not closed[^\n]*\n- \d{4}-\d\d-\d\d · T1 · started [^\n]* · "arregla el login ya"/, 'a turn that never ends (quota) still shows');
  assert.match(tasks(), /## Started, not closed \([^)\n]*the turn reading this file[^)\n]*\)/, 'an agent reading it mid-turn finds its own turn there, not a hung one');
  const transcript = path.join(home, 't-open.jsonl');
  fs.writeFileSync(transcript, [prompt('¿qué hace esto?'), say('Waymark → Q · dept-qa'), call('Read', { file_path: FILE })].map((l) => JSON.stringify(l)).join('\n') + '\n');
  spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: repo, session_id: 's-open', last_assistant_message: 'Respuesta' }), env, encoding: 'utf8' });
  assert.ok(!fs.existsSync(path.join(repo, '.waymark', 'open.json')), 'the turn ended: closed');
  assert.ok(!/Started, not closed/.test(tasks()));
  const h = projectHome(repo);
  fs.writeFileSync(path.join(repo, '.waymark', 'open.json'), JSON.stringify({ hung: { at: new Date().toISOString(), next: '2026-10-03 · T3', followUp: '2026-10-03 · T2c', prompt: 'a' }, other: { at: new Date().toISOString(), next: '2026-10-03 · T4', followUp: null, prompt: 'b' } }));
  assert.equal(closeOpen(h, 's-new', '2026-10-03 · T3b'), true, 'a hung task closed in another session is removed by its ID');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(repo, '.waymark', 'open.json'), 'utf8'))), ['other']);
  const bare = tmpRepo('open-bare'); // no memory in the project: nothing is written there
  spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { input: JSON.stringify({ cwd: bare, session_id: 's-open2', prompt: 'x' }), env, encoding: 'utf8' });
  assert.ok(!fs.existsSync(path.join(bare, '.waymark')));
});

// `waymark.mjs check` with no network call that can succeed and no real ~/.claude.json or transcripts.
const offline = () => Object.assign(process.env, { WAYMARK_REPO: 'invalid/none', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none') });

test('connect-agents: one marked pointer block per agent found, backup first, registry row; waymark check reports it until connected', async () => {
  const { found, planFor, apply: connect, POINTER } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  offline();
  delete process.env.CODEX_HOME;
  process.env.WAYMARK_BACKUPS = path.join(home, 'backups');
  fs.mkdirSync(path.join(agentsHome, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(agentsHome, '.codex', 'AGENTS.md'), '# Mine\nkeep this');
  fs.mkdirSync(path.join(agentsHome, '.config', 'opencode'), { recursive: true });
  assert.ok((await check(agentsHome)).some((t) => /^connect: other agents not connected to the project memory: Codex \([^)]*\.codex\/AGENTS\.md\), OpenCode/.test(t)));
  const agents = found();
  assert.deepEqual(agents.map((a) => a.name), ['Codex', 'OpenCode'], 'only folders that exist (no .gemini here)');
  for (const a of agents) connect(planFor(a));
  const codex = fs.readFileSync(path.join(agentsHome, '.codex', 'AGENTS.md'), 'utf8');
  assert.equal(codex, `# Mine\nkeep this\n\n${POINTER}\n`, 'the rest of the file is untouched');
  assert.equal(fs.readFileSync(path.join(agentsHome, '.config', 'opencode', 'AGENTS.md'), 'utf8'), `${POINTER}\n`, 'created when missing');
  const bk = fs.readdirSync(path.join(home, 'backups')).find((d) => d.endsWith('-connect-agents'));
  assert.equal(fs.readFileSync(path.join(home, 'backups', bk, 'codex', 'AGENTS.md'), 'utf8'), '# Mine\nkeep this');
  const reg = fs.readFileSync(path.join(home, 'agent.md'), 'utf8');
  assert.match(reg, /## Connected agents[\s\S]*\| OpenCode \|[\s\S]*\| Codex \|/);
  assert.ok(found().every((a) => a.connected) && planFor(found()[0]).skip, 'idempotent: already connected');
  assert.ok(!(await check(agentsHome)).some((t) => t.startsWith('connect:')), 'connected: nothing to report');
  connect({ ...found()[0], connected: false, exists: true }); // a forced rerun replaces the registry row, never duplicates it
  assert.equal(fs.readFileSync(path.join(home, 'agent.md'), 'utf8').match(/\| Codex \|/g).length, 1);
});

test('connect-agents: with an orchestrator in the file, Waymark joins as its guest and never touches its blocks', async () => {
  const { found, planFor, apply: connect } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  fs.mkdirSync(path.join(agentsHome, '.gemini'), { recursive: true });
  const theirs = '<!-- gentle-ai:persona -->\nYou are the orchestrator.\n<!-- /gentle-ai:persona -->\n';
  fs.writeFileSync(path.join(agentsHome, '.gemini', 'GEMINI.md'), theirs);
  const g = found().find((a) => a.name === 'Gemini CLI');
  assert.deepEqual(g.guestOf, ['gentle-ai']);
  assert.match(planFor(g).steps[0], /as a guest of gentle-ai/);
  connect(planFor(g));
  assert.ok(fs.readFileSync(path.join(agentsHome, '.gemini', 'GEMINI.md'), 'utf8').startsWith(theirs), 'its block intact');
  assert.match(fs.readFileSync(path.join(home, 'agent.md'), 'utf8'), /\| Gemini CLI \| [^|]+ \| \d{4}-\d\d-\d\d · invitado de gentle-ai \|/);
});

test('session hook: new location points to tasks.md; the bridge says old location and waymark check offers the migration', async () => {
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  offline();
  const env = { ...process.env, WAYMARK_HOME: home };
  const run = (cwd) => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd }), env, encoding: 'utf8' }).stdout).hookSpecificOutput.additionalContext;
  const repo = tmpRepo('session');
  const old = oldMemory('sess', repo);
  assert.match(run(repo), /old location; read; full file there; `waymark\.mjs check` offers the move/);
  assert.ok((await check(repo)).some((t) => /^migrate: .*migrate-memory\.mjs" --project /.test(t)));
  fs.rmSync(old);
  assert.ok(!(await check(repo)).some((t) => t.startsWith('migrate:')), 'nothing left in the old location');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n- ▶ C\n');
  assert.match(run(repo), /Project memory: .*\.waymark\/memory\.md \(read; full file there\)\. Where the work stands: .*\.waymark\/tasks\.md[\s\S]*- ▶ C/);
  assert.match(run(tmpRepo('fresh')), /Project memory: none .* Create .*\.waymark\/memory\.md/);
});

// ---- Step 3 (docs/adr/0008): the hooks are the chain; the rest is waymark.mjs; one adapter per agent ----

test('stop hook: a turn routed Q leaves a short record with no task ID; IDs, follow-ups and tasks.md count it apart', () => {
  const repo = tmpRepo('question');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n- ▶ A (2026-10-01 · T1): NEXT b\n');
  const day = new Date().toLocaleDateString('sv');
  appendRecord(repo, { id: `${day} · T1`, agent: 'codex', at: new Date().toISOString(), cierre: 'Resultado: hecho', prompt: 'first' });
  const transcript = path.join(home, 't-question.jsonl');
  fs.writeFileSync(transcript, [prompt('¿qué hace el guard?'), say('Waymark → Q · dept-security · skills: ninguna'), call('Read', { file_path: FILE })].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: repo, session_id: 's-q', last_assistant_message: 'Respuesta' }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.stdout, '', 'a question is never blocked and shows no summary line');
  const recs = readRecords(path.join(repo, '.waymark', 'provenance.jsonl'));
  assert.equal(recs.length, 2);
  assert.deepEqual([recs[1].kind, recs[1].id, recs[1].agent, recs[1].department, recs[1].prompt], ['Q', undefined, 'claude', 'dept-security', '¿qué hace el guard?']);
  assert.ok(verifyChain(recs).ok, 'chained like any record');
  const ids = taskIds(repo);
  assert.deepEqual([ids.next, ids.last, ids.followUp], [`${day} · T2`, `${day} · T1`, `${day} · T1b`], 'the question takes no T<n> and keeps the follow-up');
  const tasks = fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8');
  assert.match(tasks, /Preguntas \(Q\) desde el último cierre: 1 /);
  assert.match(tasks, new RegExp(`## Last closed: ${day} · T1 · codex `), 'Claude sees the task closed in Codex');
  assert.match(tasks, new RegExp(`\\| ${day} · T1 · codex \\| hecho`));
  const bare = tmpRepo('question-bare'); // no project memory: a question writes nothing
  spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: bare, session_id: 's-q2', last_assistant_message: 'Respuesta' }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.ok(!fs.existsSync(path.join(bare, '.waymark')));
});

test('session hook: one pointer to waymark check when the last check is older than a week, at most once a week', async () => {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-check-'));
  temps.push(own);
  const env = { ...process.env, WAYMARK_HOME: own };
  const run = () => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: tmpRepo('pointer') }), env, encoding: 'utf8' }).stdout).hookSpecificOutput.additionalContext;
  assert.match(run(), /Waymark check \(last run: never\): before the task, run node ".*waymark\.mjs" check/);
  assert.doesNotMatch(run(), /Waymark check/, 'once a week');
  fs.writeFileSync(path.join(own, '.check.json'), JSON.stringify({ checkedAt: Date.now() - 9 * 86400000, pointedAt: Date.now() - 8 * 86400000 }));
  assert.match(run(), /Waymark check \(last run: 9 days ago\)/);
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  offline();
  const before = process.env.WAYMARK_HOME;
  process.env.WAYMARK_HOME = own;
  try { await check(tmpRepo('pointer-check')); } finally { process.env.WAYMARK_HOME = before; }
  assert.ok(Date.now() - JSON.parse(fs.readFileSync(path.join(own, '.check.json'), 'utf8')).checkedAt < 60000, 'check records its time');
});

test('waymark check: skills never indexed or changed since the last sync, frameworks without coexistence, version compare', async () => {
  const { check, newer, skillNames } = await import(`file://${SCRIPTS}/waymark.mjs`);
  offline();
  const repo = tmpRepo('check-skills');
  assert.ok((await check(repo)).some((t) => /^skills: never indexed from this folder/.test(t)));
  const sig = path.join(home, '.skills-signature.json');
  fs.writeFileSync(sig, JSON.stringify({ [repo.replace(/\\/g, '/').toLowerCase()]: skillNames(repo) }));
  assert.ok(!(await check(repo)).some((t) => t.startsWith('skills:')), 'unchanged since the last sync');
  fs.mkdirSync(path.join(repo, '.claude', 'skills', 'mine'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude', 'skills', 'mine', 'SKILL.md'), '---\nname: mine\n---\n');
  assert.ok((await check(repo)).some((t) => /^skills: changed since the last sync \(\+mine\)/.test(t)));
  const instr = path.join(home, 'instr-check.md');
  fs.writeFileSync(instr, '<!-- gentle-ai:persona -->\nx\n');
  const agentMd = path.join(home, 'agent.md'), keep = fs.existsSync(agentMd) ? fs.readFileSync(agentMd, 'utf8') : null;
  fs.writeFileSync(agentMd, `| Agent | Skills | Project skills | Instructions |\n|---|---|---|---|\n| Test | x | y | ${instr} |\n`);
  try { assert.ok((await check(repo)).some((t) => /^coexistence: another agent framework appeared .*gentle-ai in /.test(t))); }
  finally { if (keep === null) fs.rmSync(agentMd); else fs.writeFileSync(agentMd, keep); }
  assert.equal(newer('2.1.0', '2.0.0-dev'), true);
  assert.equal(newer('2.0.0', '2.0.0-dev'), false);
  assert.equal(newer('1.9.9', '2.0.0'), false);
});

test('install-hooks: four entries added after the others, idempotent, old path/matcher updated, duplicates dropped', async () => {
  const { planHooks } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const theirs = { type: 'command', command: 'node other-framework.js' };
  const first = planHooks({ model: 'x', hooks: { Stop: [{ hooks: [theirs] }] } }, { scripts: '/s/waymark/scripts' });
  assert.equal(first.steps.length, 4);
  assert.equal(first.settings.model, 'x', 'other keys kept');
  assert.deepEqual(first.settings.hooks.Stop.map((e) => e.hooks[0].command), ['node other-framework.js', 'node "/s/waymark/scripts/stop-hook.mjs"'], 'after the existing hooks');
  assert.equal(first.settings.hooks.PreToolUse[0].matcher, 'Bash|PowerShell|Edit|Write|NotebookEdit');
  assert.deepEqual(planHooks(first.settings, { scripts: '/s/waymark/scripts' }).steps, [], 'idempotent');
  const old = { hooks: {
    PreToolUse: [{ matcher: 'Bash|PowerShell', hooks: [{ type: 'command', command: 'node "C:\\old\\waymark\\scripts\\tool-hook.mjs"' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "/s/waymark/scripts/rule0-hook.mjs"' }] }, { hooks: [{ type: 'command', command: 'node "/x/waymark/scripts/rule0-hook.mjs"' }, theirs] }],
  } };
  const second = planHooks(old, { scripts: '/s/waymark/scripts' });
  assert.deepEqual(second.settings.hooks.PreToolUse, [{ matcher: 'Bash|PowerShell|Edit|Write|NotebookEdit', hooks: [{ type: 'command', command: 'node "/s/waymark/scripts/tool-hook.mjs"' }] }]);
  assert.deepEqual(second.settings.hooks.UserPromptSubmit.map((e) => e.hooks.map((h) => h.command)), [['node "/s/waymark/scripts/rule0-hook.mjs"'], ['node other-framework.js']], 'the duplicate goes, the other hook stays');
  assert.ok(second.steps.some((s) => /remove duplicate UserPromptSubmit/.test(s)));
  assert.equal(old.hooks.PreToolUse[0].matcher, 'Bash|PowerShell', 'the input is not mutated');
  assert.match(planHooks({}, { scripts: '/s/waymark/scripts', agent: 'codex' }).settings.hooks.Stop[0].hooks[0].command, /stop-hook\.mjs" --agent codex$/);
});

test('adapter: the hooks answer through the agent module; the gate no longer polices shell style', async () => {
  const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);
  const { agentFrom } = await import(`file://${SCRIPTS}/agents/index.mjs`);
  const { gate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  assert.equal(agentFrom(['node', 'x']).name, 'claude', 'default');
  assert.equal(agentFrom(['node', 'x', '--agent', 'unknown']).name, 'claude', 'unknown → default, never a crash');
  assert.deepEqual(claude.call({ tool_name: 'Edit', tool_input: { file_path: '/a.ts' } }), { files: ['/a.ts'] });
  assert.deepEqual(claude.call({ tool_name: 'PowerShell', tool_input: { command: 'ls' } }), { command: 'ls' });
  assert.equal(claude.call({ tool_name: 'Read', tool_input: {} }), null);
  assert.deepEqual(claude.out.deny('no'), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'no' } });
  assert.deepEqual(claude.out.block('r'), { decision: 'block', reason: 'r' });
  const fake = { ...claude, read: () => [prompt('cambia el título'), say('Waymark → L1 · dept-frontend · skills: ninguna')] };
  assert.equal(gate({ tool_name: 'Bash', tool_input: { command: 'node -e "console.log(`${1}`.match(/\\d/))"' } }, fake), null, 'no fragile-command check any more');
  assert.equal(gate({ tool_name: 'Bash', tool_input: { command: 'git stash' } }, fake), null);
  assert.match(gate({ tool_name: 'Edit', tool_input: { file_path: FILE }, session_id: `s-${Math.random()}` }, fake), /L1 decision gate/);
  assert.equal(gate({ tool_name: 'Edit', tool_input: { file_path: path.join(os.homedir(), '.waymark', 'x.md') } }, fake), null, 'memory files exempt');
});

// ---- Step 3b (docs/adr/0009): the Codex adapter ----
const cx = await import(`file://${SCRIPTS}/agents/codex.mjs`);
let ord = 0;
const row = (type, payload, ts = new Date(Date.UTC(2026, 9, 3, 15, 0, ord)).toISOString()) => ({ timestamp: ts, ordinal: ord++, type, payload });
const item = (turn, it) => row('event_msg', { type: 'item_completed', thread_id: 'th', turn_id: turn, item: it });
const cxUser = (turn, id, text) => item(turn, { type: 'UserMessage', id, content: [{ type: 'text', text }] });
const cxSay = (turn, text) => item(turn, { type: 'AgentMessage', id: `a${ord}`, content: [{ type: 'Text', text }] });
const cxCmd = (turn, command, exit = 0, out = 'ok') => item(turn, { type: 'CommandExecution', id: `c${ord}`, command: ['C:\\pwsh.exe', '-Command', command], status: 'completed', exit_code: exit, aggregated_output: out, duration: { secs: 2, nanos: 0 } });
const cxEdit = (turn, file) => item(turn, { type: 'FileChange', id: `f${ord}`, changes: { [file]: { type: 'update' } } });
const cxAsk = (callId, q) => row('response_item', { type: 'function_call', name: 'request_user_input', call_id: callId, arguments: JSON.stringify({ questions: q }) });
const cxAnswer = (callId, answers) => row('response_item', { type: 'function_call_output', call_id: callId, output: JSON.stringify({ answers }) });
const cxTokens = (total, input, cached, output) => row('event_msg', { type: 'token_count', info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output } } });
const RUI_Q = [{ header: 'Retry', id: 'retry', question: '¿Cómo reintento?', options: [{ label: 'Backoff', description: 'x' }, { label: 'Cola', description: 'y' }] }];

test('codex adapter: the rollout becomes core lines (prompts, routing, skills read, edits, choice window, tokens, model)', () => {
  const rows = [
    row('session_meta', { cli_version: '0.160.0', cwd: 'C:\\work\\proj' }), row('turn_context', { turn_id: 't1', model: 'gpt-5.5' }),
    cxUser('t1', 'item-1', 'agrega reintentos'), cxSay('t1', 'Waymark → L2 · dept-backend · skills: ninguna'),
    cxCmd('t1', 'Get-Content C:/skills/dept-backend/SKILL.md'), cxAsk('call_1', RUI_Q), cxAnswer('call_1', { retry: { answers: ['Backoff'] } }),
    cxEdit('t1', FILE), cxCmd('t1', 'npm run build', 1, 'error TS2322'), cxTokens(1000, 900, 600, 100), cxTokens(1000, 900, 600, 100), cxTokens(1500, 400, 300, 100),
  ];
  const lines = cx.toLines(rows), turn = currentTurn(lines);
  assert.equal(turn.prompt, 'agrega reintentos');
  assert.equal(routedLevel(turn.texts, turn.tools), 2);
  assert.equal(routedDept(turn.texts, turn.tools), 'dept-backend');
  assert.deepEqual(turn.tools.map((t) => t.name), ['Skill', 'Bash', 'AskUserQuestion', 'Edit', 'Bash'], 'reading SKILL.md is the skill call');
  assert.equal(turn.tools[0].input.skill, 'dept-backend');
  assert.equal(turn.tools[3].input.file_path, FILE);
  assert.equal(turn.results[turn.tools[4].id].error, true, 'a non-zero exit code is a failed result');
  assert.deepEqual(decisionsIn(taskLines(lines)), [{ question: '¿Cómo reintento?', chosen: 'Backoff', discarded: ['Cola'] }]);
  assert.deepEqual([turnUsage(lines).responses, turnUsage(lines).cacheRead, turnUsage(lines).input], [2, 900, 400], 'a repeated count is not a new response; cached input apart');
  const inputs = turnInputs(taskLines(lines, { prompts: 1 }), '/work/none', cx.instructions);
  assert.deepEqual([inputs.agent, inputs.model], ['0.160.0', 'gpt-5.5']);
});

test('codex adapter: without request_user_input, a question that ended the turn and the reply count as a decision asked in chat', async () => {
  const { gate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const rows = [cxUser('t1', 'i1', 'agrega reintentos'), cxSay('t1', 'Waymark → L2 · dept-backend · skills: ninguna'), cxSay('t1', 'Opciones: 1) Backoff (recomendado) 2) Cola.\n¿Cuál prefieres?'),
    cxUser('t2', 'i2', 'backoff'), cxSay('t2', 'Waymark → L2 · dept-backend · skills: ninguna')];
  const lines = cx.toLines(rows);
  assert.deepEqual(decisionsIn(taskLines(lines)), [{ question: '¿Cuál prefieres?', chosen: 'backoff', discarded: [], source: 'chat' }]);
  const fedBack = cx.toLines([...rows.slice(0, 3), cxUser('t1', 'i9', 'Waymark: this L2 turn changed files and is missing: 1) …')]);
  assert.deepEqual(decisionsIn(fedBack), [], 'a block reason fed back is not the user answering');
  const agent = { ...cx, read: () => lines };
  assert.equal(gate({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Update File: ${FILE}\n@@\n-a\n+b\n*** End Patch` }, cwd: '/work/proj', session_id: `s-${Math.random()}` }, agent), null, 'asked in chat: the gate passes');
  const fresh = { ...cx, read: () => cx.toLines(rows.slice(0, 2)) };
  const deny = gate({ tool_name: 'apply_patch', tool_input: { command: `*** Begin Patch\n*** Add File: src/new.mjs\n+x\n*** End Patch` }, cwd: '/work/proj', session_id: `s-${Math.random()}` }, fresh);
  assert.match(deny, /L2 decision gate[\s\S]*In Codex: "invoke the skill <name>" = read .*\/<name>\/SKILL\.md/, 'the gate tells Codex how');
  assert.deepEqual(cx.patchFiles('*** Update File: a.ts\n*** Move to: b/c.ts\n*** Delete File: /abs/d.ts', '/w').map((f) => path.basename(f)), ['a.ts', 'c.ts', 'd.ts']);
  assert.equal(cx.call({ tool_name: 'mcp__engram__mem_save', tool_input: {} }), null);
});

test('stop hook --agent codex: the task is recorded as codex and waymark.mjs review is its review', () => {
  const { cwd, log } = fresh();
  const memFile = path.join(os.homedir(), '.waymark', 'projects', 'proj.md');
  const rows = [row('session_meta', { cli_version: '0.160.0' }), row('turn_context', { model: 'gpt-5.5' }),
    cxUser('t1', 'i1', 'agrega reintentos al servicio de pedidos'), cxSay('t1', 'Waymark → L2 · dept-backend · skills: ninguna'),
    cxCmd('t1', 'Get-Content C:/skills/dept-backend/SKILL.md'), cxCmd('t1', 'Get-Content C:/skills/dept-backend/procedures.md', 0, '### Endpoint'), cxCmd('t1', 'node C:/s/waymark/scripts/waymark.mjs pack src/orders.service.mjs'),
    cxAsk('call_9', [{ id: 'q', question: '¿Cómo?', options: [{ label: 'Backoff' }, { label: 'Cola' }] }]), cxAnswer('call_9', { q: { answers: ['Backoff'] } }),
    cxEdit('t1', FILE), cxCmd('t1', 'node --check src/orders.service.mjs && npm run build'), cxCmd('t1', 'node C:/s/waymark/scripts/waymark.mjs review src/orders.service.mjs'), cxEdit('t1', memFile), cxTokens(2000, 1500, 1000, 500)];
  const transcript = path.join(home, `t-codex-${n}.jsonl`);
  fs.writeFileSync(transcript, rows.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs'), '--agent', 'codex'], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'cx1', last_assistant_message: cierre(id) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.ok(out.systemMessage && !out.decision, `not blocked: ${r.stdout}`);
  const rec = readLog(cwd).pop();
  assert.equal(rec.agent, 'codex');
  assert.equal(rec.evaluation.steps.Review, true, 'waymark.mjs review counts where code-review does not exist');
  assert.equal(rec.evaluation.model, 'gpt-5.5');
  assert.deepEqual(rec.department.invoked, ['dept-backend'], 'the SKILL.md read is the invocation');
  assert.ok(fs.existsSync(log));
});

test('install-hooks --agent codex: hooks.json entries with --agent codex, apply_patch matcher and commandWindows', async () => {
  const { planHooks } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const { settings, steps } = planHooks({}, { scripts: '/s/waymark/scripts', agent: 'codex' });
  assert.equal(steps.length, 4);
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: 'Bash|apply_patch', hooks: [{ type: 'command', command: 'node "/s/waymark/scripts/tool-hook.mjs" --agent codex', commandWindows: 'node "/s/waymark/scripts/tool-hook.mjs" --agent codex' }] }]);
  assert.deepEqual(planHooks(settings, { scripts: '/s/waymark/scripts', agent: 'codex' }).steps, [], 'idempotent');
  assert.equal(planHooks({}, { scripts: '/s/waymark/scripts' }).settings.hooks.PreToolUse[0].hooks[0].commandWindows, undefined, 'Claude Code: no commandWindows');
});

test('codex adapter: sessions(cwd) finds the rollouts opened in that folder', () => {
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-codex-'));
  temps.push(codexHome);
  const before = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
  try {
    const dir = path.join(codexHome, 'sessions', '2026', '10', '03');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'rollout-a.jsonl'), JSON.stringify(row('session_meta', { cwd: 'C:\\work\\Proj' })) + '\n');
    fs.writeFileSync(path.join(dir, 'rollout-b.jsonl'), JSON.stringify(row('session_meta', { cwd: 'C:\\work\\other' })) + '\n');
    assert.deepEqual(cx.sessions('c:/work/proj').map((f) => path.basename(f)), ['rollout-a.jsonl']);
  } finally { if (before === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = before; }
});

// ---- 3c fixes (user's rules and picks, 2026-10-03 · T2j; docs/adr/0010) ----
const { inheritedRoute } = await import(`file://${SCRIPTS}/transcript.mjs`);

test('3c: "Waymark → L0|Q" is a question', () => {
  assert.equal(routedLevel(['Waymark → L0|Q · dept-devex · skills: ninguna']), 'Q');
  assert.equal(routedLevel(['Waymark → L0 | Q · dept-devex']), 'Q');
  assert.equal(routedDept(['Waymark → L0|Q · dept-devex · skills: ninguna']), 'dept-devex');
  assert.equal(routedLevel(['Waymark → L0 · dept-devex']), 0, 'a plain L0 stays L0');
});

test('3c: an unrouted reply inside an open task inherits its routing (gate and Cierre); a closed task or Q does not', () => {
  const asked = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend · skills: ninguna'), call('Skill', { skill: 'dept-backend' }), say('Opciones: 1) Backoff 2) Cola. ¿Cuál?')];
  const reply = [prompt('backoff'), call('Edit', { file_path: FILE })];
  assert.deepEqual(inheritedRoute([...asked, ...reply]), { level: 2, dept: 'dept-backend' });
  assert.equal(inheritedRoute([...asked, prompt('ok'), say('¿Y el límite?'), prompt('3')]).level, 2, 'through another unrouted reply');
  assert.equal(inheritedRoute([...asked, say('## Cierre · x\nResultado: hecho'), ...reply]), null, 'the task closed');
  assert.equal(inheritedRoute([prompt('¿qué hace?'), say('Waymark → Q · dept-qa'), ...reply]), null, 'a Q turn opens no task');
  assert.equal(inheritedRoute([...asked, prompt('cambia el color'), say('Waymark → L0 · dept-frontend')]), null, 'an explicit L0 does not inherit');
  const deny = checkDecision(FILE, [...asked, ...reply], `s-inh-${n}`, path.join(home, `gate-${n++}.json`));
  assert.match(deny || '', /L2 decision gate/, 'the reply no longer skips the gate as L0');
  const { cwd } = fresh();
  const g = cierreGaps(currentTurn([...asked, ...reply, call('Bash', { command: 'npm run build' })]), cierre(taskIds(cwd).next), undefined, undefined, { ...ctxFor(cwd), inherited: { level: 2, dept: 'dept-backend' } });
  assert.equal(g.level, 2);
  assert.equal(g.dept.declared, 'dept-backend');
});

test('3e-1: a later confirmation in the choice window passes and leaves no finding', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd), ctx = ctxFor(cwd);
  const turn = l2([call('AskUserQuestion', { questions: [] }), answered('¿Confirmo 3 reintentos?', ['Sí', 'Otra cosa'], 'Sí')]);
  const decisions = [...ctx.decisions, { question: '¿Confirmo 3 reintentos?', chosen: 'Sí', discarded: ['Otra cosa'] }];
  const g = cierreGaps(turn, cierre(ids.next), undefined, undefined, { ids, decisions });
  assert.deepEqual(g.missing, []);
  assert.equal(g.steps.find((s) => s.id === 'decision').pass, true);
  assert.ok(!g.findings.some((f) => /choice-window/.test(f)), 'a later question is recorded with its position, not scored');
});

test('3c (T2l): no browser step — a UI change passes with no browser attempt and no offer; the contract has no Navegador', () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), '.wm-ui-')); // outside temp so it is not exempt
  temps.push(dir);
  const ui = path.join(dir, 'modal.component.html');
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const turn = (extra = []) => currentTurn([prompt('mueve el modal'), say('Waymark → L2 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['A', 'B'], 'A'),
    call('Edit', { file_path: ui }), call('Bash', { command: 'npx ng build' }), call('Skill', { skill: 'code-review' }), MEM(), ...extra]);
  const close = (extra = '') => `## Cierre · ${ids.next}\nResultado: hecho · Decisión: elegida A · descartadas B\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a ← b"${extra}`;
  const decisions = [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }];
  const g = cierreGaps(turn(), close(), undefined, undefined, { ids, decisions });
  assert.deepEqual(g.missing, [], 'nothing about the browser blocks');
  assert.ok(!g.steps.some((s) => s.id === 'browser'), 'no browser step in the contract');
  assert.ok(!('Navegador' in evaluate(g, { total: 1 }).steps));
  const routine = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'routine.json'), 'utf8'));
  assert.ok(!routine.testigos.some((s) => s.id === 'browser'));
  const reviewOffered = [...decisions, { question: '¿Corro el code-review?', chosen: 'Sí, con code-review', discarded: ['Sin review'] }];
  assert.ok(cierreGaps(turn(), close('\nReview: omitido (usuario: "code-review")'), undefined, undefined, { ids, decisions: reviewOffered }).findings.some((f) => /Review: skip quoted/.test(f)), 'a fragment of the accepted option is not a skip');
});

test('3c: the end-of-turn line asks the real quota % while the model has fewer than 3 pairs', () => {
  const base = { steps: { Decision: true }, score: '1/1', tokens: 1e6, quotaPct: 0.7 };
  assert.match(summaryLine('2026-10-03 · T9', { ...base, quotaBy: 'default' }), /¿qué % marcó tu cuota en esta tarea\? node ".*calibrate\.mjs" "2026-10-03 · T9" <pct>/);
  assert.match(summaryLine('x', { ...base, quotaBy: 'pairs:2' }), /marcó tu cuota/);
  assert.ok(!/marcó tu cuota/.test(summaryLine('x', { ...base, quotaBy: 'pairs:3' })));
  assert.ok(!/marcó tu cuota/.test(summaryLine('x', { ...base, quotaBy: 'fit:4' })));
  assert.ok(!/marcó tu cuota/.test(summaryLine('x', { ...base, quotaPct: null, quotaBy: null })));
  const none = summaryLine('x', { ...base, quotaPct: null, quotaBy: 'none' });
  assert.match(none, /1.00M tokens · ¿qué % marcó tu cuota/, 'a model without pairs: tokens only, and the % is asked');
  assert.ok(!/≈|5 h/.test(none));
});

test('3c: open.json records the agent, and tasks.md shows where the turn started', () => {
  const repo = tmpRepo('open-agent');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n- ▶ A (2026-10-01 · T1): NEXT b\n');
  spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs'), '--agent', 'codex'], { input: JSON.stringify({ cwd: repo, session_id: 's-cx', prompt: 'haz el paso 2' }), env: { ...process.env, WAYMARK_HOME: home, WAYMARK_REPO: 'invalid/none' }, encoding: 'utf8' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, '.waymark', 'open.json'), 'utf8'))['s-cx'].agent, 'codex');
  assert.match(fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8'), /· started in codex \d{4}-\d\d-\d\d [^\n]* · "haz el paso 2"/);
});

test('3c codex: every question line of the last message counts as a decision asked in chat', () => {
  const rows = [cxUser('t1', 'i1', 'agrega reintentos'), cxSay('t1', 'Waymark → L2 · dept-backend · skills: ninguna'), cxSay('t1', '1) ¿Backoff o cola?\n2) ¿Cuántos reintentos?'), cxUser('t2', 'i2', 'backoff, 3')];
  const got = decisionsIn(taskLines(cx.toLines(rows)));
  assert.deepEqual(got.map((d) => [d.question, d.chosen]), [['1) ¿Backoff o cola?', 'backoff, 3'], ['2) ¿Cuántos reintentos?', 'backoff, 3']]);
});

// ---- 3c, replay of the real Codex rollouts (2026-10-03 · T2k) ----
test('3c gate: a ">" inside quotes, a heredoc body or a here-string is not a redirect; one outside still is', () => {
  for (const c of [
    'cd /x && node -e "import(\'./a.mjs\').then(cx=>{console.log(cx)})"',
    "node -e 'if (a > b) console.log(1)'",
    'awk \'$3 > 10 {print}\' data.txt',
    'grep -n "a -> b" notes.md',
    'node script.mjs <<\'EOF\'\nconst f = (x) => x > 1;\nEOF',
    "pwsh -Command @'\nif ($a -gt 1) { 'x' > $null }\n'@",
  ]) assert.ok(!mutatesFiles(c), c);
  for (const c of ['echo "a > b" > src/out.txt', 'cat > src/a.ts <<EOF\nx\nEOF', 'node -e "1" > "src/out file.json"', 'printf x >> src/log.txt']) assert.ok(mutatesFiles(c), c);
  assert.ok(!mutatesFiles('echo "x" > "$TEMP/wm.txt"'), 'a quoted temp target is still temp');
});

test('3c codex: request_user_input_async counts as the choice window, answered by the next message; a rejected call never counts', () => {
  const asyncAsk = (callId, q) => row('response_item', { type: 'function_call', name: 'request_user_input_async', call_id: callId, arguments: JSON.stringify({ questions: q }) });
  const out = (callId, output) => row('response_item', { type: 'function_call_output', call_id: callId, output });
  const rows = [cxUser('t1', 'i1', 'haz el paso 2'), cxSay('t1', 'Waymark → L2 · dept-frontend · skills: ninguna'), cxCmd('t1', 'Get-Content C:/skills/dept-frontend/SKILL.md'),
    asyncAsk('bad', [{ title: 'Alcance', question: 'x', options: ['A'] }]), out('bad', 'failed to parse function arguments: unknown field `question`'),
    asyncAsk('ok', [{ title: 'Alcance: ¿cómo cierro el paso?', options: ['Agregar specs críticos y solo proponer limpiezas (Recomendado)', 'Solo analizar'] }, { title: 'Cobertura: ¿cuál priorizo?', options: ['Las tres áreas (Recomendado)', 'Solo medios'] }]),
    out('ok', '{"accepted":true}'),
    cxSay('t1', 'Alcance: ¿Cómo quieres cerrar el paso?\n- A\nCobertura: ¿Cuál priorizo?'), cxSay('t1', 'Te dejé dos decisiones pendientes.'),
    cxUser('t2', 'i2', 'Agregar specs críticos y solo proponer limpiezas; las tres áreas'), cxEdit('t2', FILE)];
  const lines = cx.toLines(rows);
  const got = decisionsIn(taskLines(lines));
  assert.deepEqual(got.map((d) => [d.question, d.chosen, d.discarded, d.source]), [
    ['Alcance: ¿cómo cierro el paso?', 'Agregar specs críticos y solo proponer limpiezas (Recomendado)', ['Solo analizar'], 'async'],
    ['Cobertura: ¿cuál priorizo?', 'Las tres áreas (Recomendado)', ['Solo medios'], 'async'],
  ], 'the options the reply names; the chat copy of the same questions is not counted again');
  assert.equal(checkDecision(FILE, lines, `s-async-${n}`, path.join(home, `gate-${n++}.json`)), null, 'asked: the inherited L2 gate passes');
  const noWait = cx.toLines([...rows.slice(0, 7), cxEdit('t1', FILE)]); // asked async, then edited in the same turn
  assert.match(checkDecision(FILE, noWait, `s-async-${n}`, path.join(home, `gate-${n++}.json`)) || '', /L2 decision gate/, 'not answered yet: still gated');
  const noAsync = cx.toLines([rows[0], rows[1], cxCmd('t1', 'npm test'), cxSay('t1', 'Opciones:\n¿Backoff o cola?\n¿Cuántos reintentos?'), cxSay('t1', 'Espero tu elección.'), cxUser('t2', 'i2', 'backoff, 3')]);
  assert.equal(decisionsIn(taskLines(noAsync)).length, 2, 'chat questions written after the last action, even with a summary after them');
  const narration = cx.toLines([rows[0], rows[1], cxSay('t1', '¿Qué hace este servicio? Lo reviso.'), cxCmd('t1', 'npm test'), cxSay('t1', 'Listo, apliqué el cambio.'), cxUser('t2', 'i2', 'gracias')]);
  assert.equal(decisionsIn(taskLines(narration)).length, 0, 'a question before the last action is narration');
});

// ---- 3c test A fixes (2026-10-03 · T2l; docs/adr/0011) ----
const { readTurns } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { recordedDecisions, maskSecrets } = await import(`file://${SCRIPTS}/provenance.mjs`);

test('T2l Cierre: a field ending with ":" continues on the next lines; an empty field never takes the next line', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const below = `## Cierre · ${ids.next}\nResultado: hecho\nEvidencia:\n- observada x en el log\nAprendido: "a ← b"`;
  assert.match(checkCierre(l2(), below, undefined, ['x'], ctxFor(cwd)) || '', /Evidencia: observada/, 'an empty Evidencia is still empty');
  const spread = `## Cierre · ${ids.next}\nResultado: hecho\nEvidencia: observada en el log:\n- timeouts de 30 s\nAprendido: "a ← b"`;
  assert.equal(checkCierre(l2(), spread, undefined, ['x'], ctxFor(cwd)), null, 'the value on the lines below');
  const emptyThenNext = `## Cierre · ${ids.next}\nResultado:\nEvidencia: observada x\nAprendido: "a"`;
  assert.match(checkCierre(l2(), emptyThenNext, undefined, undefined, ctxFor(cwd)) || '', /Resultado: hecho/, 'an empty field still never takes the next line');
});

test('T2l memory written: memory.md changed by any tool in the turn and holding the task ID is observed (no longer a testigo)', () => {
  const dir = fs.mkdtempSync(path.join(home, 'mem-')), mem = path.join(dir, 'memory.md');
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const noEdit = currentTurn([prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: `node "$TEMP/mem.js"` }), call('Bash', { command: 'npm run build' }), call('Skill', { skill: 'code-review' })]);
  fs.writeFileSync(mem, `## Work in progress\n- [${id}] backoff ← timeouts\n`);
  const ctx = { ...ctxFor(cwd), memoryFile: mem };
  assert.equal(cierreGaps(noEdit, cierre(id), undefined, undefined, ctx).observed.memory.written, true, 'written by a script through the shell');
  fs.writeFileSync(mem, '## Work in progress\n- [otra tarea] x\n');
  assert.equal(cierreGaps(noEdit, cierre(id), undefined, undefined, ctx).observed.memory.written, false, 'without the task ID it was not this task');
});

test('T2l outside the project: a turn with a Cierre and no project change is still recorded (install, cleanup)', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const turn = currentTurn([prompt('instala aquí'), say('Waymark → L2 · dept-devops'), call('Skill', { skill: 'dept-devops' }), PROC('dept-devops'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Push + instalar', 'Solo instalar'], 'Push + instalar'), call('Bash', { command: 'cp a ~/.claude/skills/x' }), MEM()]);
  const reply = `## Cierre · ${id}\nResultado: hecho · Decisión: elegida Push + instalar · descartadas Solo instalar\nSub-decisiones: ninguna\nEvidencia: observada sync OK\nAprendido: "instalado ← sync"`;
  assert.equal(cierreGaps(turn, reply, undefined, undefined, ctxFor(cwd, [{ question: '¿Cómo?', chosen: 'Push + instalar', discarded: ['Solo instalar'] }])), null, 'without ctx.outside: nothing, as before');
  const g = cierreGaps(turn, reply, undefined, undefined, { ...ctxFor(cwd, [{ question: '¿Cómo?', chosen: 'Push + instalar', discarded: ['Solo instalar'] }]), outside: true });
  assert.equal(g.level, 2);
  assert.deepEqual(g.missing, []);
  assert.equal(cierreGaps(currentTurn([prompt('¿qué hace?'), say('Waymark → Q · dept-qa')]), 'Respuesta', undefined, undefined, { ...ctxFor(cwd), outside: true }), null, 'no Cierre: no record');
});

test('T2l turn counting: a prompt far back (a pasted image) is found; a turn resumed by a notification counts from the last close', () => {
  const lines = [prompt('tarea con imagen', 'big'), ...Array.from({ length: 50 }, (_, i) => ({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 9, 4, 3, i)).toISOString(), message: { id: `m${i}`, content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 1 } } }))];
  const tail = (n) => lines.slice(-n);
  let reads = 0;
  const got = readTurns((bytes) => { reads++; return tail(Math.min(lines.length, Math.floor(bytes / (1024 * 1024)))); }, 1, 2 * 1024 * 1024, 64 * 1024 * 1024);
  assert.ok(got.some((d) => d.uuid === 'big') && reads > 1, 'read further back until the prompt');
  const since = Date.UTC(2026, 9, 4, 3, 39, 30); // the previous close
  assert.equal(turnUsage(lines).responses, 50);
  assert.equal(turnUsage(lines, since).responses, 10, 'only what came after the close');
  assert.equal(currentTurn(lines, since).texts.length, 10);
  assert.equal(currentTurn(lines, since).startedAt, since);
});

test('T2l secrets: a free-text answer is kept as written with passwords, tokens and e-mails masked; picked labels as is', () => {
  const lines = [prompt('x'), answered('¿Usuario de prueba?', ['Crear uno', 'Sin login'], 'te paso uno: ana@example.com y la contraseña es S3cr3t-Pass!')];
  const raw = decisionsIn(lines);
  assert.match(raw[0].chosen, /S3cr3t/, 'the hook still sees the answer live');
  const kept = recordedDecisions(raw);
  assert.ok(!/S3cr3t|ana@/.test(JSON.stringify(kept)), 'never in the record');
  assert.match(kept[0].chosen, /^te paso uno: \[correo\] y la contraseña es \[redactado\]$/, 'the words stay, the secrets do not');
  assert.equal(recordedDecisions(decisionsIn([prompt('x'), answered('¿Cuál?', ['A (Recomendado)', 'B'], 'la primer opcion recomendada haz')]))[0].chosen, 'la primer opcion recomendada haz', 'a chat answer is kept (Codex)');
  assert.equal(recordedDecisions(decisionsIn([prompt('x'), answered('¿Cuál?', ['A'], 'x'.repeat(300))]))[0].chosen.length, 200, 'clipped to 200');
  assert.equal(recordedDecisions(decisionsIn([prompt('x'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff')]))[0].chosen, 'Backoff');
  assert.equal(recordedDecisions(decisionsIn([prompt('x'), answered('¿Cuáles?', ['A', 'B', 'C'], 'A,mi texto')]))[0].chosen, 'A, mi texto');
  for (const [s, leak] of [['la contraseña es S3cr3t-Pass!', 'S3cr3t'], ['password: hunter22', 'hunter22'], ['curl -u admin:pw123 https://x', 'pw123'], ['https://bob:pw456@host/x', 'pw456'], ['token=abc.def.ghi', 'abc.def'], ['Authorization: Bearer eyJhbGci', 'eyJhb']]) assert.ok(!maskSecrets(s).includes(leak), s);
  assert.equal(maskSecrets('npm run build'), 'npm run build');
});

test('T2l Review: a follow-up that applies the review findings passes with the code-review run earlier in the task', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const noReview = currentTurn([prompt('corrige los hallazgos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npm run build' }), MEM()]);
  assert.match(checkCierre(noReview, cierre(id), undefined, undefined, ctxFor(cwd)) || '', /no review ran/);
  assert.equal(checkCierre(noReview, cierre(id), undefined, undefined, { ...ctxFor(cwd), taskTools: [{ name: 'Skill', input: { skill: 'code-review' } }] }), null);
});

test('T2l turn start: a prompt after the last close starts the turn even when the next line has no timestamp', () => {
  const p = { ...prompt('nueva tarea'), timestamp: new Date(Date.UTC(2026, 9, 4, 5, 0)).toISOString() };
  const lines = [p, call('Edit', { file_path: FILE }), { ...say('hecho'), timestamp: new Date(Date.UTC(2026, 9, 4, 5, 1)).toISOString() }];
  assert.deepEqual(currentTurn(lines, Date.UTC(2026, 9, 4, 4, 0)).tools.map((t) => t.name), ['Edit'], 'the untimestamped tool call stays in the turn');
});

test('T2m: the choice window waiting for the user is userWait, not the agent\'s minutes', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const at = (min) => new Date(Date.UTC(2026, 9, 4, 6, min)).toISOString();
  const lines = [{ ...prompt('x'), timestamp: new Date(Date.now() - 62 * 60000).toISOString() }, say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(),
    { type: 'assistant', timestamp: at(0), message: { content: [{ type: 'tool_use', name: 'AskUserQuestion', id: 'q1', input: {} }] } },
    { type: 'user', timestamp: at(60), message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'Backoff' }, { label: 'Cola' }] }], answers: { '¿Cómo?': 'Backoff' } } },
    { type: 'assistant', timestamp: at(60), message: { content: [{ type: 'tool_use', name: 'Bash', id: 'b1', input: { command: 'npm run build' } }] } },
    { type: 'user', timestamp: at(61), message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }] } },
    call('Edit', { file_path: FILE }), call('Bash', { command: 'npm run build' }), call('Skill', { skill: 'code-review' }), MEM()];
  const t = cierreGaps(currentTurn(lines), cierre(id), undefined, undefined, ctx).observed.time;
  assert.equal(t.userWait, 60, 'an hour waiting for the answer');
  assert.ok(t.minutes >= 1.5 && t.minutes <= 2.5, `the agent's time without the wait (${t.minutes})`);
  assert.equal(t.slowest.tool, 'Bash', 'the wait is not the slowest step');
});

test('T2n: "## Cierre" named inside a sentence is not a Cierre; a Q turn is never recorded as an outside task', () => {
  const { cwd } = fresh();
  const q = currentTurn([prompt('¿qué le digo a Claude?'), say('Waymark → Q · dept-qa · skills: ninguna')]);
  const answer = 'Waymark → Q · dept-qa · skills: ninguna\n\n7. Deja que termine solo hasta que escriba su `## Cierre`.';
  assert.equal(cierreGaps(q, answer, undefined, undefined, { ...ctxFor(cwd), outside: true }), null, 'a mention mid-sentence');
  const qHeading = `Waymark → Q · dept-qa\n\n## Cierre · ${taskIds(cwd).next}\nResultado: hecho`;
  assert.equal(cierreGaps(q, qHeading, undefined, undefined, { ...ctxFor(cwd), outside: true }), null, 'even a real heading in a Q turn');
  const mention = `${cierre(taskIds(cwd).next)}`.replace('## Cierre', 'Arriba dije que el `## Cierre` va al final.\n## Cierre');
  assert.equal(checkCierre(l2(), mention, undefined, undefined, ctxFor(cwd)), null, 'fields are read from the real heading, not from the mention');
});

// ---- Sonnet test fixes (2026-10-03 · T2o) ----
const { pendingBackground, subagentUsage, withSubagents } = await import(`file://${SCRIPTS}/transcript.mjs`);

test('T2o background: a skill still running in the background holds the close; its notification releases it', () => {
  const launch = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_bg1', content: 'Running in the background as @code-review' }] }, toolUseResult: { background: true, status: 'forked' } };
  const turn = [prompt('agrega el progreso'), say('Waymark → L2 · dept-frontend'), call('Skill', { skill: 'code-review' }), launch, say('La revisión corre en segundo plano.')];
  assert.deepEqual(pendingBackground(turn), ['toolu_bg1']);
  const notified = [...turn, { type: 'user', message: { role: 'user', content: '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_bg1</tool-use-id>\n</task-notification>' } }, say('## Cierre · x')];
  assert.deepEqual(pendingBackground(notified), []);
  const bash = [prompt('x'), { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'Command running in background with ID: b1' }] } }];
  assert.deepEqual(pendingBackground(bash), [], 'a background shell command (a dev server) is never waited for');
});

test('T2o stop hook: no block and no record while the background review runs', () => {
  const { cwd, log } = fresh();
  const transcript = path.join(home, `t-bg-${n}.jsonl`);
  const lines = [prompt('agrega reintentos al servicio de pedidos'), say('Waymark → L2 · dept-backend · skills: code-review'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(),
    call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Skill', { skill: 'code-review' }),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_bg2', content: 'Running in the background' }] }, toolUseResult: { background: true } }, say('Espero el code-review.')];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: `bg-${n}`, last_assistant_message: 'Espero el code-review.' }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '', 'silent: not blocked');
  assert.ok(!fs.existsSync(log) || !readLog(cwd).length, 'nothing recorded yet');
});

test('T2o: "Docker" is not docs, memory commands are not gates', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd), ctx = ctxFor(cwd);
  const docker = cierre(ids.next).replace('observada timeouts en el log de pedidos', 'observada Docker falla con dockerDesktopLinuxEngine; inferida que falta la columna (check: GET da 200)');
  assert.ok(!cierreGaps(l2(), docker, undefined, undefined, ctx).steps.find((s) => s.id === 'docs').applies, '"Docker" is not docs');
  const memGate = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: "sed -i '7i - [T1] build y tests ok' .waymark/memory.md" }), call('Skill', { skill: 'code-review' }), MEM()]);
  assert.match(checkCierre(memGate, cierre(ids.next), undefined, undefined, ctx) || '', /no typecheck, lint or build ran after the last code change/, 'writing memory is not a gate');
});

test('T2o: the tokens of the subagents a turn launched are added', () => {
  const dir = fs.mkdtempSync(path.join(home, 'sess-')), tp = path.join(dir, 'abc.jsonl');
  fs.mkdirSync(path.join(dir, 'abc', 'subagents'), { recursive: true });
  const resp = (id, ts, u) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, usage: u } });
  fs.writeFileSync(path.join(dir, 'abc', 'subagents', 'agent-1.jsonl'), [resp('s1', '2026-10-04T15:24:20Z', { input_tokens: 10, cache_read_input_tokens: 200000, cache_creation_input_tokens: 5000, output_tokens: 1000 }), resp('s1', '2026-10-04T15:24:21Z', { input_tokens: 10, cache_read_input_tokens: 200000, cache_creation_input_tokens: 5000, output_tokens: 1000 })].join('\n'));
  fs.writeFileSync(path.join(dir, 'abc', 'subagents', 'old.jsonl'), resp('o1', '2026-10-01T10:00:00Z', { input_tokens: 9, cache_read_input_tokens: 9e6, output_tokens: 9 }));
  const sub = subagentUsage(tp, Date.parse('2026-10-04T15:00:00Z'));
  assert.deepEqual([sub.cacheRead, sub.files], [200000, 1], 'once per response, only this turn\'s subagents');
  const sum = withSubagents({ input: 1, cacheWrite: 0, cacheRead: 100, output: 1, fresh: 2, total: 102, responses: 1 }, sub);
  assert.equal(sum.total, 102 + 206010);
  assert.equal(sum.subagents, 206010);
  assert.equal(subagentUsage('/nope/x.jsonl').files, 0);
});

test('T2o: a gate chained with a memory command still counts', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const chained = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: 'npx tsc --noEmit && npm run build && grep -n T1 .waymark/memory.md' }), call('Skill', { skill: 'code-review' }), MEM()]);
  assert.equal(checkCierre(chained, cierre(id), undefined, undefined, ctxFor(cwd)), null);
});

// ---- 3e-1 testigos (docs/adr/0012, 2026-10-03 · T2q) ----
const { gateCommand, runGate, secretSources, secretHits, buildNone } = await import(`file://${SCRIPTS}/testigos.mjs`);
const { findSecrets, deepMask } = await import(`file://${SCRIPTS}/provenance.mjs`);
// Fake secrets built at run time, so this file never holds a strong-format value itself (the testigo reads diffs).
const FAKE = { gh: 'gh' + 'p_' + 'A1b2'.repeat(9), aws: 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP', slack: 'xo' + 'xb-' + '1234567890-abcdef', jwt: 'ey' + 'J' + 'a'.repeat(12) + '.ey' + 'J' + 'b'.repeat(12) + '.' + 'c'.repeat(12) };
const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });

// 3e-1b test (a real project): an unrelated task closed as T4b inherited T4's answers, and T4c's own question read
// "after" (measured against T4b's first change).
test('3e-1b follow-up: its ID holds only when it changes a file of its task; its decisions are its own stretch', () => {
  const D = '2026-10-04', ids = { next: `${D} · T5`, last: `${D} · T4`, followUp: `${D} · T4b`, known: new Set([`${D} · T4`]) };
  const records = [{ id: `${D} · T4`, files: ['/work/api/prisma/migration.sql'] }, { id: `${D} · T3`, files: [FILE] }];
  const ctx = { ...ctxFor('/work/none'), ids, taskFiles: (id) => new Set(taskFiles(records, id).map((f) => f.toLowerCase())) };
  // a follow-up ID that touches none of its task's files is a new task: recorded under the new ID, never blocked (the
  // Codex re-test wrote its Cierre twice for it)
  assert.doesNotMatch(checkCierre(l2(), cierre(`${D} · T4b`), undefined, undefined, ctx) || '', /follow-up|T4b/, 'not blocked');
  const moved = cierreGaps(l2(), cierre(`${D} · T4b`), undefined, undefined, ctx);
  assert.deepEqual(moved.renamed, { from: `${D} · T4b`, to: `${D} · T5` });
  const rec = provenanceRecord(l2(), moved, ctx, {});
  assert.deepEqual([rec.id, rec.idBy, rec.claimed], [`${D} · T5`, 'hook', `${D} · T4b`], 'the record keeps what the agent wrote');
  assert.equal(cierreGaps(l2(), cierre(`${D} · T5`), undefined, undefined, ctx).renamed, null, 'a new task ID passes as is');
  records.push({ id: `${D} · T4`, files: [FILE] });
  const shared = cierreGaps(l2(), cierre(`${D} · T4b`), undefined, undefined, ctx);
  assert.deepEqual([shared.renamed, provenanceRecord(l2(), shared, ctx, {}).id], [null, `${D} · T4b`], 'sharing a file of its task, it is a follow-up');
  // the stretch: T4b asked, edited and closed; T4c asks before its own first edit
  const before = [call('AskUserQuestion'), answered('¿Cómo?', ['A', 'B'], 'A'), call('Edit', { file_path: FILE })];
  const ask = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q2', name: 'AskUserQuestion', input: {} }] } };
  const ans = { ...answered('¿Y ahora?', ['C', 'D'], 'C'), message: { content: [{ type: 'tool_result', tool_use_id: 'q2', content: 'answered' }] } };
  const stretch = [prompt('ajusta'), say('Waymark → L1 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), ask, ans, call('Edit', { file_path: FILE }), call('Bash', { command: 'npx tsc --noEmit' }), MEM()];
  const decisions = decisionsIn(stretch);
  const g = cierreGaps(currentTurn(stretch), cierre(`${D} · T4b`), undefined, undefined, { ...ctx, decisions, taskTools: sessionTools([...before, ...stretch]), stretchTools: sessionTools(stretch) });
  assert.deepEqual([decisions.length, decisions[0].position, g.steps.find((s) => s.id === 'decision').pass], [1, 'before', true]);
});

// 3e-1 test: `cat >> x.spec.ts <<'EOF'` counted as a gate and a test run, and was the slowest step.
test('3e-1b a heredoc body is text written to a file, not a gate or a test run', () => {
  const { cwd } = fresh();
  const spec = "cat >> src/orders.spec.ts <<'EOF'\ntest('retries', () => { expect(run('npx tsc --noEmit')).toBe(0) }) // lint\nEOF";
  const after = (cmd) => currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), cmd, MEM()]);
  const g = cierreGaps(after(call('Bash', { command: spec })), cierre(taskIds(cwd).next), undefined, undefined, ctxFor(cwd));
  assert.deepEqual(g.observed.gates, [], 'nothing ran');
  assert.ok(g.missing.some((m) => /no typecheck, lint or build ran after the last code change/.test(m)));
  const ps = "@'\nnpm run build\n'@ | Set-Content notes.txt";
  assert.deepEqual(cierreGaps(after(call('PowerShell', { command: ps })), cierre(taskIds(cwd).next), undefined, undefined, ctxFor(cwd)).observed.gates, [], 'a here-string body neither');
  assert.equal(cierreGaps(after(call('Bash', { command: 'bash -c "npx tsc --noEmit"' })), cierre(taskIds(cwd).next), undefined, undefined, ctxFor(cwd)).observed.gates.length, 1, 'a quoted command still runs');
});

test('3e-1 testigo gate: the agent\'s failing gate blocks once; "no comprobado (<why>)" says it is not this task\'s', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const use = (tid, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: tid, name, input }] } });
  const res = (tid, isError = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: tid, content: isError ? 'error TS2322' : 'ok', is_error: isError }] } });
  const turn = currentTurn([prompt('x'), say('Waymark → L1 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    use('e', 'Edit', { file_path: FILE }), res('e'), use('t', 'Bash', { command: 'npx vitest run' }), res('t', true), use('d', 'Bash', { command: 'npx tsc --noEmit' }), res('d', true), MEM()]);
  const g = cierreGaps(turn, cierre(id), undefined, undefined, ctxFor(cwd));
  assert.ok(g.missing.some((m) => /the gate after the last code change failed \(npx tsc --noEmit\): fix it/.test(m)));
  assert.deepEqual([g.observed.gate.by, g.observed.gate.ok], ['agent', false]);
  assert.ok(g.findings.some((f) => /a command after the last change failed: npx vitest run$/.test(f)), 'other failures stay findings; the judged gate is not repeated');
  assert.equal(checkCierre(turn, `${cierre(id)}\nno comprobado (falla en un archivo que esta tarea no tocó)`, undefined, undefined, { ...ctxFor(cwd), blocked: true }), null);
  assert.ok(checkCierre(turn, `${cierre(id)}\nno comprobado (falla en un archivo que esta tarea no tocó)`, undefined, undefined, ctxFor(cwd)), 'before the block it does not cancel it');
});

test('3e-1 testigo gate: with no gate after the last code change, the repo typecheck the hook re-runs decides', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const turn = currentTurn([prompt('x'), say('Waymark → L1 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), MEM()]);
  let asked = null;
  const withRun = (r) => ({ ...ctxFor(cwd), rerun: (files) => { asked = files; return r; } });
  const ok = cierreGaps(turn, cierre(id), undefined, undefined, withRun({ cmd: 'npm run typecheck', from: 'package.json', ok: true, s: 3, timedOut: false }));
  assert.deepEqual(ok.missing, []);
  assert.deepEqual(asked, [FILE], 'the changed code files');
  assert.deepEqual([ok.observed.gate.by, ok.observed.gate.cmd], ['testigo', 'npm run typecheck']);
  assert.match(checkCierre(turn, cierre(id), undefined, undefined, withRun({ cmd: 'npm run typecheck', ok: false, s: 3, timedOut: false })) || '', /failed \(npm run typecheck, re-run by the hook\)/);
  assert.match(checkCierre(turn, cierre(id), undefined, undefined, withRun({ cmd: 'npm run typecheck', ok: false, s: 40, timedOut: true })) || '', /took over 40 s: run the project's gate yourself/);
  assert.match(checkCierre(turn, cierre(id), undefined, undefined, withRun(null)) || '', /no typecheck the hook can run \(memory\.md Quality gates, package\.json, tsconfig\)/);
  const docsOnly = currentTurn([prompt('x'), say('Waymark → L1 · dept-devex'), call('Skill', { skill: 'dept-devex' }), PROC('dept-devex'), call('Edit', { file_path: '/work/proj/README.md' }), MEM()]);
  assert.equal(cierreGaps(docsOnly, cierre(id), undefined, undefined, withRun(null)).steps.find((s) => s.id === 'gate').applies, false, 'no code changed: not applicable');
});

test('3e-1 gateCommand: memory.md\'s verified row, then package.json with the lockfile\'s manager, then tsconfig; never a placeholder or the build', () => {
  const dir = (files) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-gate-')); temps.push(d); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; };
  const withMem = dir({ 'memory.md': '# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| sync (temp copy) | WAYMARK_HOME=<tmp> node s.mjs | 2026-10-01 |\n| syntax | `node --check a.mjs` | 2026-10-01 |\n\n## Conventions\n' });
  assert.deepEqual(gateCommand(withMem, path.join(withMem, 'memory.md')), { cmd: 'node --check a.mjs', from: 'memory.md' });
  const pnpm = dir({ 'package.json': JSON.stringify({ scripts: { build: 'ng build', typecheck: 'tsc -p . --noEmit' } }), 'pnpm-lock.yaml': '' });
  assert.deepEqual(gateCommand(pnpm, null), { cmd: 'pnpm run typecheck', from: 'package.json' });
  const ts = dir({ 'tsconfig.json': '{}', 'tsconfig.app.json': '{}', 'node_modules/.bin/tsc': '' });
  assert.deepEqual(gateCommand(ts, null), { cmd: 'npx --no-install tsc --noEmit -p tsconfig.app.json', from: 'tsconfig' });
  assert.equal(gateCommand(dir({ 'tsconfig.json': '{}' }), null), null, 'TypeScript not installed: nothing is downloaded');
  assert.equal(gateCommand(dir({ 'package.json': JSON.stringify({ scripts: { build: 'vite build' } }) }), null), null, 'never the build');
  const d = dir({});
  assert.equal(runGate({ cmd: 'node -e "process.exit(3)"', from: 'x' }, d).ok, false);
  assert.equal(runGate({ cmd: 'node -e ""', from: 'x' }, d).ok, true);
  assert.equal(runGate({ cmd: 'node -e "setTimeout(() => {}, 4000)"', from: 'x' }, d, 300).timedOut, true);
});

test('3e-1 testigo secrets: strong formats only, where and kind but never the value; "Secretos: no (<why>)" for a fake one', () => {
  assert.deepEqual(findSecrets(`a\nconst k = '${FAKE.gh}'`), [{ kind: 'GitHub token', line: 2 }]);
  assert.deepEqual(findSecrets('password=hunter2 · token de prueba'), [], '"password=" is only masked in what Waymark writes');
  assert.ok(!maskSecrets(`usa ${FAKE.aws}`).includes(FAKE.aws) && !JSON.stringify(deepMask({ a: [{ b: FAKE.jwt }] })).includes(FAKE.jwt));
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const ctx = { ...ctxFor(cwd), scanSecrets: () => [{ where: 'src/a.ts', text: `const k = '${FAKE.gh}'` }] };
  const msg = checkCierre(l2(), cierre(id), undefined, undefined, ctx) || '';
  assert.match(msg, /a secret-like value in src\/a\.ts \(GitHub token\): remove it/);
  assert.ok(!msg.includes(FAKE.gh), 'never the value');
  assert.equal(checkCierre(l2(), `${cierre(id)}\nSecretos: no (token falso del fixture de maskSecrets)`, undefined, undefined, { ...ctx, blocked: true }), null);
  assert.match(checkCierre(l2(), `${cierre(id)}\nSecretos: no (no hay valores sensibles)`, undefined, undefined, ctx) || '', /secret-like value/, '3e-1 test: a preventive line never cancels a real block');
  const saved = l2([call('mcp__engram__mem_save', { title: 'deploy', content: `key ${FAKE.aws}` })]);
  assert.match(checkCierre(saved, cierre(id), undefined, undefined, ctxFor(cwd)) || '', /mem_save \(AWS access key\)/);
  const turn = currentTurn([prompt(`usa ${FAKE.slack} para el bot`), ...l2Lines.slice(1)]);
  assert.ok(!JSON.stringify(provenanceRecord(turn, cierreGaps(turn, cierre(id), undefined, undefined, ctxFor(cwd)), ctxFor(cwd), {})).includes(FAKE.slack), 'the record masks it');
});

test('3e-1 secretSources: the lines the task added, untracked files whole, the task\'s commits, memory.md when written; a removed secret is not flagged', () => {
  const repo = tmpRepo('secrets');
  fs.writeFileSync(path.join(repo, 'a.ts'), `const old = '${FAKE.jwt}';\n`);
  gitT(repo, 'add', '.'); gitT(repo, 'commit', '-q', '-m', 'i');
  fs.writeFileSync(path.join(repo, 'c.ts'), `export const s = '${FAKE.slack}';\n`);
  gitT(repo, 'add', 'c.ts'); gitT(repo, 'commit', '-q', '-m', 'c');
  const hash = gitT(repo, 'rev-parse', 'HEAD').stdout.trim();
  fs.writeFileSync(path.join(repo, 'a.ts'), `const k = '${FAKE.gh}';\n`); // the JWT line removed, a token added
  fs.writeFileSync(path.join(repo, 'b.env'), `AWS=${FAKE.aws}\n`);
  const mem = path.join(repo, 'memory.md');
  fs.writeFileSync(mem, `- nota ${FAKE.gh}\n`);
  const hits = secretHits(secretSources([path.join(repo, 'a.ts'), path.join(repo, 'b.env')], [hash], repo, mem, 0));
  const got = hits.map((h) => `${h.where.replace(/^commit \w+ /, 'commit ')}:${h.kind}`).sort();
  assert.deepEqual(got, ['a.ts:GitHub token', 'b.env:AWS access key', 'commit c.ts:Slack token', 'memory.md:GitHub token'].sort());
  assert.ok(!hits.some((h) => h.kind === 'JWT'), 'a removed line is not the task\'s');
  assert.ok(!secretHits(secretSources([], [], repo, mem, Date.now() + 60000)).length, 'memory.md not written in this turn: not read');
});

test('3e-1 testigo chain: a broken chain is recorded and scored, never blocks', () => {
  const { cwd } = fresh();
  const g = cierreGaps(l2(), cierre(taskIds(cwd).next), undefined, undefined, { ...ctxFor(cwd), chain: { ok: false, at: 1 } });
  assert.deepEqual(g.missing, []);
  assert.equal(g.steps.find((s) => s.id === 'chain').pass, false);
  assert.ok(g.findings.some((f) => /chain broken at record 2/.test(f)));
  assert.equal(g.observed.chain, false);
});

test('3e-1 tasks.md: the last closed task\'s Decisión is the user\'s recorded picks (older records keep the Cierre\'s field)', () => {
  const repo = tmpRepo('tasks-dec');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  appendRecord(repo, { id: '2026-10-03 · T1', at: '2026-10-03T10:00:00Z', cierre: '## Cierre · 2026-10-03 · T1\nResultado: hecho\nDecisión: elegida A\nEvidencia: x\nAprendido: y' });
  assert.match(tasksMarkdown(projectHome(repo)), /- Decisión: elegida A/);
  appendRecord(repo, { id: '2026-10-03 · T2', at: '2026-10-03T11:00:00Z', decisions: [{ question: 'q', chosen: 'Backoff', position: 'before' }, { question: 'q2', chosen: '3', position: 'after' }], cierre: '## Cierre · 2026-10-03 · T2\nResultado: hecho\nEvidencia: x\nAprendido: y' });
  assert.match(tasksMarkdown(projectHome(repo)), /- Decisión: Backoff; 3/);
});

test('3e-1 testigos.mjs by hand: chain, commit + trailer, secrets in the commits and the typecheck from memory.md', () => {
  const repo = tmpRepo('by-hand');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | node -e "" | 2026-10-04 |\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.waymark/\n');
  appendRecord(repo, { id: '2026-10-03 · T1', evaluation: { steps: { Decision: true }, score: '1/1' } });
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  gitT(repo, 'add', '.'); gitT(repo, 'commit', '-q', '-m', 'a\n\nWaymark-Task: 2026-10-03 · T1');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'testigos.mjs')], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✔ chain: 1 records intact/);
  assert.match(r.stdout, /✔ commit \+ trailer: [0-9a-f]{8}/);
  assert.match(r.stdout, /✔ secrets in the task's commits: none/);
  assert.match(r.stdout, /✔ typecheck now \(memory\.md\): node -e ""/);
  assert.match(r.stdout, /recorded for 2026-10-03 · T1: Decision ✔ \(1\/1\)/);
});

test('3e-1 review fixes: a gate piped into grep is not failed by grep\'s exit; the block reason comes from the gaps already judged', async () => {
  const { blockReason } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const use = (tid, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: tid, name, input }] } });
  const res = (tid, isError) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: tid, content: '', is_error: isError }] } });
  const turn = (cmd) => currentTurn([prompt('x'), say('Waymark → L1 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    use('e', 'Edit', { file_path: FILE }), res('e', false), use('g', 'Bash', { command: cmd }), res('g', true), MEM()]);
  let runs = 0;
  const ctx = (r) => ({ ...ctxFor(cwd), rerun: () => { runs++; return r; } });
  assert.equal(checkCierre(turn('npm run build 2>&1 | grep -i error'), cierre(id), undefined, undefined, ctxFor(cwd)), null, 'no re-run available: not held against it');
  assert.equal(checkCierre(turn('npm run build 2>&1 | grep -i error'), cierre(id), undefined, undefined, ctx({ cmd: 'npm run typecheck', ok: true, s: 2, timedOut: false })), null, 'the hook\'s typecheck decides');
  assert.match(checkCierre(turn('npm run build 2>&1 | grep -i error'), cierre(id), undefined, undefined, ctx({ cmd: 'npm run typecheck', ok: false, s: 2, timedOut: false })) || '', /failed \(npm run typecheck, re-run by the hook\)/);
  assert.match(checkCierre(turn('npx eslint src && npx tsc --noEmit'), cierre(id), undefined, undefined, ctxFor(cwd)) || '', /failed \(npx eslint src && npx tsc --noEmit\)/, 'the gate is the last part: its exit counts');
  runs = 0;
  const g = cierreGaps(turn('npm run build 2>&1 | grep -i error'), '## Cierre', undefined, undefined, ctx({ cmd: 'npm run typecheck', ok: false, s: 2, timedOut: false }));
  assert.equal(runs, 1, 'judged once');
  assert.match(blockReason(g), /^Waymark: this L1 turn changed files and is missing: 1\) the gate after the last code change failed \(npm run typecheck, re-run by the hook\)/);
  assert.equal(runs, 1, 'the block reason reuses the gaps: no second re-run');
});

// ---- 3e-2: git as the source of truth (docs/adr/0012) ----
const P = { readTaskRecords, writeTaskLine, taskSummary, tidyWip, confirmTasks, workspaceSiblings };
const commitTask = (repo, id, file = 'a.ts') => {
  fs.writeFileSync(path.join(repo, file), `export const x = ${Math.random()};\n`);
  gitT(repo, 'add', file); gitT(repo, 'commit', '-q', '-m', `x\n\nWaymark-Task: ${id}`);
  return gitT(repo, 'rev-parse', 'HEAD').stdout.trim();
};
const memRepo = (name, wip = '') => {
  const repo = tmpRepo(name);
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), `# P\n\n## Work in progress\n${wip}\n## Identity\n- Stack: test\n`);
  fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};

test('3e-2 notes: a committed task\'s record is a git note; the log keeps a chained stub with the note\'s hash', async () => {
  const { addPair } = await import(`file://${SCRIPTS}/calibrate.mjs`);
  const repo = memRepo('notes'), h = projectHome(repo), id = '2026-10-05 · T1';
  const sha = commitTask(repo, id);
  appendRecord(repo, { id, agent: 'claude', at: '2026-10-05T10:00:00Z', session: 's', files: ['a.ts'], commits: [sha], prompt: 'p', cierre: '## Cierre · x\nResultado: hecho', evaluation: { score: '8/8', steps: {}, tokens: 5000000 } });
  assert.equal(addPair(id, 4, repo).total, 5000000, 'calibration reads the tokens from the note');
  const raw = readRecords(h.log);
  assert.equal(raw.length, 1);
  assert.deepEqual([raw[0].id, raw[0].session, raw[0].files, raw[0].commits, raw[0].note.commit], [id, 's', ['a.ts'], [sha], sha]);
  assert.equal(raw[0].cierre, undefined, 'the heavy part lives in the note');
  const note = JSON.parse(gitT(repo, 'notes', '--ref=waymark', 'show', sha).stdout);
  assert.equal(note.cierre, '## Cierre · x\nResultado: hecho');
  const full = P.readTaskRecords(h);
  assert.deepEqual([full[0].cierre, full[0].evaluation.score, full[0].note.commit], ['## Cierre · x\nResultado: hecho', '8/8', sha], 'read back whole');
  assert.equal(verifyChain(raw, readNotes(repo)).ok, true);
  appendRecord(repo, { id: '2026-10-05 · T2', at: '2026-10-05T11:00:00Z', commits: [], cierre: 'sin commit' });
  appendRecord(repo, { id: '2026-10-05 · T3', at: '2026-10-05T12:00:00Z', commits: [sha], cierre: 'mismo commit' });
  const all = readRecords(h.log);
  assert.deepEqual(all.slice(1).map((r) => r.cierre), ['sin commit', 'mismo commit'], 'no commit, or a commit that already has a note: the whole record stays in the log');
  assert.equal(verifyChain(all, readNotes(repo)).ok, true);
  const byHand = () => spawnSync(process.execPath, [path.join(SCRIPTS, 'testigos.mjs'), id], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout;
  assert.match(byHand(), /✔ chain: 3 records intact[\s\S]*recorded for 2026-10-05 · T1: .*\(8\/8\)/, 'by hand: the evaluation is read from the note');
  gitT(repo, 'notes', '--ref=waymark', 'add', '-f', '-m', '{"cierre":"editada"}', sha);
  assert.deepEqual(verifyChain(all, readNotes(repo)), { ok: false, at: 0, note: true }, 'an edited note breaks the chain');
  assert.equal(verifyChain(all).ok, true, 'without the notes: the log alone');
  assert.match(byHand(), /✘ chain: 3 records, broken at record 1 \(its git note is missing or was edited\)/, 'by hand: the notes are checked too');
});

test('3e-2 memory line: the hook writes the task\'s line (≤200) from its Cierre; ✔ beyond 5 and long lines move whole to history.md', () => {
  const long = `- ▶ [2026-10-03 · T2] Big step: plan ✔a · ▶b. ${'detail '.repeat(60)}NEXT run the gate`;
  const spec = `- STEP SPEC (2026-10-03): ${'notes '.repeat(60)}`;
  const done = [1, 2, 3, 4, 5].map((n) => `- ✔ [2026-10-04 · T${n}] done ${n}`).join('\n');
  const note = '- PLAN: next session as 2026-10-05 · T1c';
  const repo = memRepo('wip', `${long}\n${spec}\n${note}\n- [2026-10-05 · T1] hand-written: Pendiente: x\n${done}\n`), h = projectHome(repo);
  const NOW5 = new Date(2026, 9, 5, 12, 0);
  const at = (id, res, apr) => P.writeTaskLine(h, { id, cierre: `## Cierre · ${id}\nResultado: ${res}\nEvidencia: e\nAprendido: "${apr}"` }, NOW5);
  at('2026-10-05 · T1', 'hecho', 'backoff ← timeouts');
  const wip = () => (fs.readFileSync(h.memory, 'utf8').match(/## Work in progress\n([\s\S]*?)\n## /)[1]).split('\n').filter((l) => l.startsWith('-'));
  let lines = wip();
  assert.ok(!lines.some((l) => l.includes('[2026-10-05 · T1]')), 'a task done leaves Work in progress: its Aprendido is in its record');
  assert.ok(lines.every((l) => l.length <= 200), 'every line ≤200');
  assert.ok(lines.some((l) => /^- ▶ \[2026-10-03 · T2\] .*run the gate/.test(l)), 'a long task line keeps its ID, status and next step');
  assert.equal(lines.filter((l) => l.startsWith('- ✔')).length, 0, 'no closed (✔) line stays');
  const hist = fs.readFileSync(path.join(h.dir, 'history.md'), 'utf8');
  for (const l of [long, spec, '- ✔ [2026-10-04 · T1] done 1', '- ✔ [2026-10-04 · T5] done 5', '- [2026-10-05 · T1] hand-written: Pendiente: x']) assert.ok(hist.includes(l), `moved whole: ${l.slice(0, 40)}`);
  assert.ok(lines.includes(note), 'a note that quotes an ID after its head is not the task\'s line');
  at('2026-10-05 · T1b', 'parcial (falta el deploy)', 'x'.repeat(300));
  lines = wip();
  assert.ok(!lines.some((l) => l.includes('[2026-10-05 · T1]')), 'a follow-up replaces its task\'s line');
  const t1b = lines.find((l) => l.startsWith('- ▶ [2026-10-05 · T1b] '));
  assert.ok(t1b && t1b.length === 200 && t1b.endsWith('…'), 'parcial → ▶, Aprendido clipped to 200');
  assert.equal(P.taskSummary('- ✔ [2026-10-05 · T1] backoff ← timeouts'), '- 2026-10-05 · T1 · hecho · backoff ← timeouts');
  assert.equal(P.taskSummary(t1b).startsWith('- 2026-10-05 · T1b · en curso · xxx'), true);
  P.writeTaskLine(h, { id: '2026-10-05 · T2', cierre: '## Cierre · 2026-10-05 · T2\nResultado: parcial (falta deploy)\nEvidencia: e\nAprendido:\n- retries ← timeouts\n- next: deploy\n\nnot this' }, NOW5);
  assert.ok(wip().includes('- ▶ [2026-10-05 · T2] retries ← timeouts next: deploy'), 'an Aprendido on the lines below its field');
  P.writeTaskLine(h, { id: '2026-10-05 · T2b', cierre: '## Cierre · 2026-10-05 · T2b\nResultado: hecho\nEvidencia: e\nAprendido: deployed' }, NOW5);
  assert.ok(!wip().some((l) => l.includes('2026-10-05 · T2')), 'its follow-up done: the open line of the task leaves too');
});

test('3e-2 stop hook: Aprender and Índice are no longer testigos; the hook writes the memory line and the record goes to a note', () => {
  const routine = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'routine.json'), 'utf8'));
  assert.ok(!routine.testigos.some((t) => ['learned', 'index'].includes(t.id)), 'one index: the git notes; the hook writes the memory line');
  const repo = memRepo('stop-notes'), id = `${new Date().toLocaleDateString('sv')} · T1`;
  commitTask(repo, id);
  const transcript = path.join(home, 't-3e2.jsonl');
  fs.writeFileSync(transcript, l2Lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: repo, session_id: 's-3e2', last_assistant_message: cierre(id) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.doesNotMatch(JSON.parse(r.stdout).systemMessage || '', /Aprender|Índice/);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, '.waymark', 'memory.md'), 'utf8'), new RegExp(`\\[${id}\\]`), 'a task done leaves Work in progress');
  const raw = readRecords(path.join(repo, '.waymark', 'provenance.jsonl'));
  assert.ok(raw[0].note && !raw[0].observed, 'stub in the log, record in the note');
  const md = fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8');
  assert.doesNotMatch(md, new RegExp(`- ${id} · hecho`), 'a task done is not in progress');
  assert.match(md, /- Aprendido: "?backoff ← timeouts/, 'it shows as the last closed task');
  assert.match(md, /## Last closed: .*full record: git notes --ref=waymark show [0-9a-f]{8}\)\n- Resultado: hecho/);
});

test('3e-2 waymark.mjs: tasks lists the records from git; notes push sends refs/notes/waymark to origin', () => {
  const repo = memRepo('push'), id = '2026-10-05 · T1', remote = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-remote-'));
  temps.push(remote);
  spawnSync('git', ['init', '-q', '--bare'], { cwd: remote });
  gitT(repo, 'remote', 'add', 'origin', remote);
  const sha = commitTask(repo, id);
  appendRecord(repo, { id, agent: 'claude', at: '2026-10-05T10:00:00Z', commits: [sha], prompt: 'agrega reintentos', cierre: '## Cierre\nResultado: hecho', evaluation: { score: '8/8', steps: {} } });
  const run = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), ...a], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.match(run('tasks').stdout, /2026-10-05 · T1 · claude · hecho · 8\/8 · agrega reintentos/);
  assert.match(run('tasks', id).stdout, /"cierre": "## Cierre\\nResultado: hecho"/);
  const p = run('notes', 'push');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.match(spawnSync('git', ['ls-remote', remote], { encoding: 'utf8' }).stdout, /refs\/notes\/waymark/);
});

test('3e-2 code comments say how the code works, never task history', () => {
  const dir = SCRIPTS, files = [...fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, 'agents')).map((f) => path.join(dir, 'agents', f))];
  const HISTORY = /\b20\d\d-\d\d-\d\d · T\d+[a-z]?\b|user's choice|\b3[a-e](?:-\d[a-z]?)?\b|\b2\.0-\d\b|\btest [A-D]\b|\bT\d+[a-z]\b/;
  const hits = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((l, i) => [l, i]).filter(([l]) => /(^|\s)\/\/\s/.test(l) && HISTORY.test(l.slice(l.indexOf('// '))))
    .map(([l, i]) => `${path.basename(f)}:${i + 1}: ${l.trim().slice(0, 90)}`));
  assert.deepEqual(hits, []);
});

test('build none: a "build | none (<why>)" row in memory.md\'s Quality gates makes the Build testigo not applicable', () => {
  const dir = fs.mkdtempSync(path.join(home, 'build-none-')), mem = path.join(dir, 'memory.md');
  const table = (row) => `# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| syntax | node --check x.mjs | 2026-10-04 |\n${row}\n\n## Conventions\n`;
  fs.writeFileSync(mem, table('| build | none (scripts Node sin paso de build) | 2026-10-04 |'));
  assert.equal(buildNone(mem), 'scripts Node sin paso de build');
  for (const row of ['| build | npm run build | 2026-10-04 |', '| build | none | 2026-10-04 |', '| lint | none (x) | 2026-10-04 |', '| build | none (<why>) | <date> |', '<!-- write it as `| build | none (no build here) | <date> |` -->']) {
    fs.writeFileSync(mem, table(row));
    assert.equal(buildNone(mem), null, `not a build-none row: ${row}`);
  }
  assert.equal(buildNone(path.join(dir, 'missing.md')), null);
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const noBuild = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs' }), call('Skill', { skill: 'code-review' })]);
  assert.match(checkCierre(noBuild, cierre(id), undefined, undefined, ctxFor(cwd)) || '', /run the build once now/, 'without the row: Build blocks');
  const g = cierreGaps(noBuild, cierre(id), undefined, undefined, { ...ctxFor(cwd), noBuild: 'scripts Node sin paso de build' });
  assert.deepEqual(g.missing, []);
  assert.equal(g.steps.find((s) => s.id === 'build').applies, false);
  assert.deepEqual(g.observed.build, { none: 'scripts Node sin paso de build' }, 'the record says why');
  const other = cierreGaps(noBuild, cierre(id), undefined, undefined, { ...ctxFor(cwd), noBuild: 'x y z', root: '/work/other-repo' });
  assert.equal(other.steps.find((s) => s.id === 'build').applies, true, 'code in another repo still needs its build');
  const tpl = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'project-memory.template.md'), 'utf8');
  fs.writeFileSync(mem, tpl);
  assert.equal(buildNone(mem), null, 'a memory made from the template declares no build-none');
});

test('tidy: one line per task (the newest of a task and its follow-ups), open lines older than 14 days and the extra ✔ move whole to history.md', () => {
  const wip = [
    '- ▶ [2026-10-04 · T1b] confirm categories', '- ▶ [2026-10-04 · T1c] confirm categories again', '- ▶ [2026-10-04 · T1] old head',
    '- ▶ [2026-09-10 · T3] paused long ago', '- [2026-09-12 · T4] pending, old free-form: Pendiente: x', '- ✔ [2026-09-01 · T9] closed long ago',
    '- Gotcha: FE trata parentId ausente como null (2026-09-01 · T2 is quoted, not a head)', '- ▶ [2026-10-03 · T2] recent',
  ].join('\n');
  const repo = memRepo('tidy', wip + '\n'), h = projectHome(repo), NOW = new Date(2026, 9, 5, 12, 0);
  assert.equal(P.tidyWip(h, NOW), true);
  const lines = (fs.readFileSync(h.memory, 'utf8').match(/## Work in progress\n([\s\S]*?)\n## /)[1]).split('\n').filter((l) => l.startsWith('-'));
  assert.deepEqual(lines, ['- ▶ [2026-10-04 · T1c] confirm categories again', '- Gotcha: FE trata parentId ausente como null (2026-09-01 · T2 is quoted, not a head)', '- ▶ [2026-10-03 · T2] recent']);
  const hist = fs.readFileSync(path.join(h.dir, 'history.md'), 'utf8');
  for (const l of ['- ▶ [2026-10-04 · T1b] confirm categories', '- ▶ [2026-10-04 · T1] old head', '- ▶ [2026-09-10 · T3] paused long ago', '- [2026-09-12 · T4] pending, old free-form: Pendiente: x', '- ✔ [2026-09-01 · T9] closed long ago']) assert.ok(hist.includes(l), l);
  assert.match(hist, /## Moved 2026-10-05 \d\d:\d\d \(tidy\)/);
  assert.equal(P.tidyWip(h, NOW), false, 'nothing left to tidy');
  const t = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'tidy'], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.match(t.stdout, /nothing to tidy/);
});

test('commit trailer: Waymark-Task counts anywhere in the message, also when a blank line separates it from Co-Authored-By', () => {
  const repo = tmpRepo('trailer-para'), id = '2026-10-04 · T6';
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
  gitT(repo, 'add', '.'); gitT(repo, 'commit', '-q', '-m', `feat: x\n\nWaymark-Task: ${id}\n\nCo-Authored-By: A <a@a>`);
  assert.equal(gitT(repo, 'log', '-1', '--format=%(trailers:key=Waymark-Task,valueonly)').stdout.trim(), '', 'git does not read it as a trailer');
  assert.equal(commitsFor(repo, id).length, 1, 'commitsFor still finds it');
  assert.equal(commitsFor(repo, '2026-10-04 · T6b').length, 0, 'another ID does not match');
  const block = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'instructions.md'), 'utf8');
  assert.match(block, /Waymark-Task: <task ID>` in the message's last paragraph, next to Co-Authored-By/);
});

test('done: the user confirms tasks that work: they leave Work in progress, a chained confirm record, and the session start asks about the open ones', async () => {
  const wip = ['- ▶ [2026-10-04 · T4c] que el usuario recargue y confirme', '- ▶ [2026-10-04 · T3] skeleton de 5 filas', '- Gotcha: una nota', '- ▶ [2026-10-04 · T9] sigue abierta'].join('\n');
  const repo = memRepo('done', wip + '\n'), h = projectHome(repo), NOW = new Date(2026, 9, 5, 12, 0);
  const digest = spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.match(JSON.parse(digest.stdout).hookSpecificOutput.additionalContext, /Open tasks \(▶\): 2026-10-04 · T4c, 2026-10-04 · T3, 2026-10-04 · T9\. In your first reply ask the user once, in the choice window \(multi-select\), which of them already work; close those with node "[^"]+waymark\.mjs" done/);
  assert.deepEqual(P.confirmTasks(h, ['2026-10-04 · T4c', '2026-10-04 · T3', '2026-10-04 · T7'], { note: 'ya las vi, funcionan', now: NOW }), ['2026-10-04 · T4c', '2026-10-04 · T3']);
  const lines = (fs.readFileSync(h.memory, 'utf8').match(/## Work in progress\n([\s\S]*?)\n## /)[1]).split('\n').filter((l) => l.startsWith('-'));
  assert.deepEqual(lines, ['- Gotcha: una nota', '- ▶ [2026-10-04 · T9] sigue abierta'], 'confirmed tasks leave Work in progress; the confirm record keeps them');
  const rec = readRecords(h.log).pop();
  assert.deepEqual([rec.kind, rec.confirmed, rec.said, rec.note], ['confirm', ['2026-10-04 · T4c', '2026-10-04 · T3'], 'ya las vi, funcionan', undefined]);
  assert.equal(verifyChain(readRecords(h.log), new Map()).ok, true, 'checked with the notes too: its words are not a git note');
  appendRecord(repo, { kind: 'confirm', confirmed: ['x'], note: 'written by an older version' });
  assert.equal(verifyChain(readRecords(h.log), new Map()).ok, true, 'a text note (older confirm records) is not a git note either');
  assert.equal(taskIds(repo).known.has(undefined), false, 'a confirm record takes no task ID');
  fs.writeFileSync(h.memory, fs.readFileSync(h.memory, 'utf8').replace('- Gotcha: una nota', '- Gotcha: una nota\n- [2026-10-03 · T1] `prisma migrate deploy` pendiente'));
  P.confirmTasks(h, ['2026-10-03 · T1'], { now: NOW });
  assert.doesNotMatch(fs.readFileSync(h.memory, 'utf8'), /2026-10-03 · T1/, 'a free-form task line leaves too');
  assert.deepEqual(readRecords(h.log).pop().confirmed, ['2026-10-03 · T1']);
  const cli = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'done', '2026-10-04 · T9', '--note', 'ok'], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.match(cli.stdout, /confirmed by the user: 2026-10-04 · T9/);
  assert.doesNotMatch(fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8'), /2026-10-04 · T9/, 'confirmed: no longer pending in tasks.md');
});

test('check: the package manager in memory.md must match package.json packageManager or the lockfile', async () => {
  const { packageManager } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const repo = memRepo('pm');
  const mem = path.join(repo, '.waymark', 'memory.md');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.5.0' }));
  fs.writeFileSync(mem, '# P\n\n## Identity\n- Package manager / build tool: npm\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | npx tsc --noEmit | x |\n| build | npm run build | x |\n\n## Conventions\n');
  assert.match(packageManager(repo), /this repo uses pnpm \(package\.json packageManager\) but .*Identity says npm and Quality gates use npm/);
  fs.writeFileSync(mem, '# P\n\n## Identity\n- Package manager / build tool: pnpm\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | pnpm exec tsc --noEmit | x |\n| build | pnpm run build | x |\n\n## Conventions\n');
  assert.equal(packageManager(repo), '', 'they agree');
  fs.writeFileSync(path.join(repo, 'package.json'), '{}');
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}');
  assert.match(packageManager(repo), /uses npm \(its lockfile\) but .*Identity says pnpm and Quality gates use pnpm/);
});

test('connect-agents: an agent whose hooks run Waymark gets the Rule 0 block in place of the pointer, kept up to date; its own text stays', async () => {
  const { found, planFor, apply: connect, instructionsBlock, POINTER } = await import(`file://${SCRIPTS}/connect-agents.mjs`);
  const dir = path.join(agentsHome, '.codex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), `# Mine\nkeep this\n\n${POINTER}\n`);
  fs.writeFileSync(path.join(dir, 'hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "C:/u/.claude/skills/waymark/scripts/stop-hook.mjs" --agent codex' }] }] } }));
  let codex = found().find((a) => a.name === 'Codex');
  assert.deepEqual([codex.full, codex.connected], [true, false], 'pointer only: not connected for an agent with hooks');
  assert.match(planFor(codex).steps[0], /write the Rule 0 block/);
  connect(planFor(codex));
  const text = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
  assert.equal(text, `# Mine\nkeep this\n\n${instructionsBlock()}\n`, 'the pointer replaced by the block, the rest untouched');
  codex = found().find((a) => a.name === 'Codex');
  assert.ok(codex.connected && planFor(codex).skip, 'up to date');
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), text.replace('Rule 0', 'Rule 0 (old)'));
  assert.equal(found().find((a) => a.name === 'Codex').connected, false, 'an older block is not current');
  offline();
  const items = await check(agentsHome);
  assert.ok(items.some((x) => /^connect: Codex runs Waymark's hooks but has the pointer or an older Rule 0 block/.test(x)) || items.some((x) => /^connect: other agents not connected/.test(x)), items.join('\n'));
  connect(planFor(found().find((a) => a.name === 'Codex')));
  assert.equal(fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'), text, 'replaced in place, never twice');
  fs.rmSync(path.join(dir, 'hooks.json'));
  // OpenCode: its plugin names the scripts folder and the scripts apart, and still counts as hooks that run Waymark
  const { pluginText } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const oc = path.join(agentsHome, '.config', 'opencode');
  fs.mkdirSync(path.join(oc, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(oc, 'plugins', 'waymark.js'), pluginText('C:/u/.claude/skills/waymark/scripts'));
  assert.equal(found().find((a) => a.name === 'OpenCode').full, true, 'the OpenCode plugin is its hooks');
  fs.rmSync(path.join(oc, 'plugins', 'waymark.js'));
});

// ---- the stack read from the repo, the context card, pack, incidents, the new-session notice ----
test('stack: the package manager and versions come from the repo (packageManager, else the lockfile); commands are translated to it', async () => {
  const { stackOf, stackLine, translate, syncIdentity } = await import(`file://${SCRIPTS}/stack.mjs`);
  const repo = memRepo('stack');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.5.0+sha512.x', dependencies: { '@angular/core': '^21.0.0' }, devDependencies: { vitest: '^4.1.0', typescript: '~5.9.3' } }));
  fs.mkdirSync(path.join(repo, 'node_modules', '@angular', 'core'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', '@angular', 'core', 'package.json'), JSON.stringify({ version: '21.2.15' }));
  const s = stackOf(repo);
  assert.deepEqual([s.pm, s.pmVersion, s.from, s.exec, s.run], ['pnpm', '11.5.0', 'package.json packageManager', 'pnpm exec', 'pnpm run']);
  assert.deepEqual(s.deps, [['@angular/core', '21.2.15'], ['vitest', '4.1.0'], ['typescript', '5.9.3']], 'installed version first, else the declared range');
  assert.equal(stackLine(repo), 'pnpm 11.5.0 · @angular/core 21.2.15 · vitest 4.1.0 · typescript 5.9.3 · run with `pnpm exec <bin>` / `pnpm run <script>`');
  assert.equal(translate('npx tsc -p tsconfig.app.json --noEmit && npm run build', s), 'pnpm exec tsc -p tsconfig.app.json --noEmit && pnpm run build');
  assert.equal(translate('npx --no-install vitest run a.spec.ts', s), 'pnpm exec vitest run a.spec.ts');
  assert.equal(translate('pnpm exec tsc && pnpm run build && pnpm test', { pm: 'npm' }), 'npx tsc && npm run build && npm test', 'and back, for an npm project');
  assert.equal(translate('node --check x.mjs', s), 'node --check x.mjs');
  const npm = memRepo('stack-npm');
  fs.writeFileSync(path.join(npm, 'package.json'), '{}');
  fs.writeFileSync(path.join(npm, 'package-lock.json'), '{}');
  assert.deepEqual([stackOf(npm).pm, stackOf(npm).from], ['npm', 'package-lock.json']);
  assert.equal(stackOf(memRepo('stack-none')), null, 'no manifest: no stack');
  const bare = memRepo('stack-bare');
  fs.writeFileSync(path.join(bare, 'package.json'), '{}');
  assert.match(stackLine(bare), /^package manager unknown \(no packageManager, no lockfile\): ask the user before installing/, 'never a guess stated as read');
  const mem = path.join(repo, '.waymark', 'memory.md');
  fs.writeFileSync(mem, '# P\n\n## Identity\n- Package manager / build tool: npm\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | npx tsc --noEmit | x |\n\n## Conventions\n');
  assert.equal(syncIdentity(mem, s), true);
  assert.match(fs.readFileSync(mem, 'utf8'), /- Package manager \/ build tool: pnpm \(read from the repo: package\.json packageManager\)/);
  assert.equal(syncIdentity(mem, s), false, 'already right');
  assert.deepEqual(gateCommand(repo, mem), { cmd: 'pnpm exec tsc --noEmit', from: 'memory.md' }, 'the hook re-runs a memory row with the repo manager');
  const line = spawnSync(process.execPath, [path.join(SCRIPTS, 'rule0-hook.mjs')], { input: JSON.stringify({ cwd: repo, session_id: 's-stack', prompt: 'x' }), encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.match(JSON.parse(line.stdout).hookSpecificOutput.additionalContext, /Repo \(read now\): pnpm 11\.5\.0 · @angular\/core 21\.2\.15/, 'every prompt carries the stack as the repo has it');
});

test('context card: last closed with its agent, open tasks, notes, the repo stack, gates in the repo manager, incidents and the commands', () => {
  const repo = memRepo('card', '- ▶ [2026-10-04 · T3] waiting for the user\n- [2026-10-04 · T2] older pending: Pendiente: x\n- Gotcha: a note\n- ✔ [2026-10-05 · T1] done thing\n');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.5.0' }));
  fs.appendFileSync(path.join(repo, '.waymark', 'memory.md'), '\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| build | npm run build | x |\n\n## Solved problems\n- a\n- b\n');
  appendRecord(repo, { id: '2026-10-05 · T1', agent: 'codex', at: '2026-10-05T10:00:00Z', commits: [], cierre: '## Cierre · 2026-10-05 · T1\nResultado: hecho\nEvidencia: e\nAprendido: tooltips ← user; next: spec', evaluation: { steps: { Decision: true, Enrutar: false }, score: '1/2' }, unresolved: ['the routing line names no owner department'] });
  const card = JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout).hookSpecificOutput.additionalContext;
  assert.match(card, /Last closed: 2026-10-05 · T1 · codex · hecho · tooltips ← user; next: spec \(whole record: waymark\.mjs tasks "2026-10-05 · T1"\)/);
  assert.match(card, /Open tasks \(▶\): 2026-10-04 · T3, 2026-10-04 · T2\./, 'an older pending line is open too');
  assert.match(card, /Notes:\n- Gotcha: a note/);
  assert.match(card, /Repo \(read now\): pnpm 11\.5\.0/);
  assert.match(card, /Gates: build: pnpm run build/, 'memory rows shown in the repo manager');
  assert.match(card, /Incidents: open Enrutar ✘ \(2026-10-05 · T1\)/);
  assert.match(card, /Commands \(W = node "[^"]+waymark\.mjs"\): the hook hands you W pack before your first edit of each file.*W memory <section> \(Conventions · Identity\)/);
  assert.ok(!/done thing/.test(card), 'closed lines stay in tasks.md, not in the card');
});

test('pack: per file, the last tasks that changed it (note, stub, no-commit record) and commits no task recorded, newest first', () => {
  const repo = memRepo('pack'), id = '2026-10-05 · T1';
  const W = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), ...a], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout;
  fs.writeFileSync(path.join(repo, 'a.ts'), '1\n'); gitT(repo, 'add', 'a.ts'); gitT(repo, 'commit', '-q', '-m', 'by hand');
  const sha = commitTask(repo, id, 'a.ts');
  appendRecord(repo, { id, agent: 'codex', at: new Date().toISOString(), files: [path.join(repo, 'a.ts')], commits: [sha], cierre: 'Aprendido: tooltip text ← user' });
  appendRecord(repo, { id: '2026-10-05 · T2', agent: 'claude', at: new Date(Date.now() + 60000).toISOString(), files: [path.join(repo, 'a.ts')], commits: [], cierre: 'Aprendido: spec mock ← tests' });
  const out = W('pack', 'a.ts', 'b.ts');
  assert.match(out, /^a\.ts:\n  - 2026-10-05 · T2 · claude · spec mock ← tests · \(no commit\)\n  - 2026-10-05 · T1 · codex · tooltip text ← user · [0-9a-f]{8}\n  - [0-9a-f]{8} · by hand \(no task record\)\nb\.ts: no earlier task or commit$/m);
  assert.match(W('memory'), /^sections: Work in progress · Identity/);
  assert.match(W('memory', 'ident'), /^## Identity\n- Stack: test/);
});

test('incidents: a testigo ✘ stays open until it passes in a later task; 3 failures make a suggested rule; removed testigos are ignored', async () => {
  const { incidents, incidentsLine } = await import(`file://${SCRIPTS}/incidents.mjs`);
  const r = (id, steps, unresolved = []) => ({ id, evaluation: { steps }, unresolved });
  const recs = [r('T1', { Recordar: false, 'Índice': false }, ['no mem_search']), r('T2', { Recordar: true, Commit: false }), r('T3', { Commit: false }), r('T4', { Commit: false, Enrutar: false }, ['no routing line'])];
  const found = incidents(recs);
  assert.deepEqual(found.open.map((o) => [o.label, o.since, o.last, o.count]), [['Commit', 'T2', 'T4', 3], ['Enrutar', 'T4', 'T4', 1]], 'Recordar closed by T2; Índice is not a testigo any more');
  assert.equal(found.open.find((o) => o.label === 'Enrutar').cause, 'no routing line');
  assert.deepEqual(found.rules, [{ label: 'Commit', failures: 3, ids: ['T2', 'T3', 'T4'] }]);
  assert.equal(incidentsLine(found), 'Incidents: open Commit ✘×3 (T4), Enrutar ✘ (T4); suggested rule: Commit failed 3× (waymark.mjs incidents)');
  assert.equal(incidentsLine(incidents([])), '');
});

test('3e-4 testigo procedure with position: read after the first change is ✘ (not blocked); read after a denied edit still counts as first', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const head = [prompt('ajusta el skeleton'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PACK()];
  const ask = askWithId('q1', '¿Altura?', ['3.5rem', 'Otra'], '3.5rem');
  const tail = [call('Bash', { command: 'npx tsc --noEmit' })];
  const judge = (lines) => cierreGaps(currentTurn(lines), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(lines), taskTools: sessionTools(lines) });
  const late = judge([...head, ...ask, call('Edit', { file_path: FILE }), ...tail, PROC('dept-frontend')]);
  const step = late.steps.find((s) => s.id === 'procedure');
  assert.deepEqual([late.missing, step.pass, late.observed.procedure.readBeforeChange], [[], false, false], 'too late to undo: recorded, not blocked');
  assert.ok(late.findings.includes('the owner\'s procedures.md section was read after the task\'s first change'));
  const denied = [...head, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', id: 'e0', input: { file_path: FILE } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'e0', is_error: true, content: 'Waymark: L1 decision gate' }] } }, PROC('dept-frontend'), ...ask, call('Edit', { file_path: FILE }), ...tail];
  assert.equal(judge(denied).steps.find((s) => s.id === 'procedure').pass, true, 'an edit the gate denied changed nothing');
  assert.equal(judge([...head, PROC('dept-frontend'), ...ask, call('Edit', { file_path: FILE }), ...tail]).steps.find((s) => s.id === 'procedure').pass, true);
  assert.ok(judge([...head, ...ask, call('Edit', { file_path: FILE }), ...tail]).missing.some((m) => /procedures\.md never read/.test(m)), 'never read still blocks once');
});

test('routing line: a department without its prefix counts ("· frontend" → dept-frontend); "L<n> or Q" copied as is reads as its level', () => {
  assert.equal(routedDept(['Waymark → L2 · frontend'], []), 'dept-frontend');
  assert.equal(routedDept(['Waymark → L2|Q · ux-ui · skills: ui-build'], []), 'dept-ux-ui');
  assert.equal(routedDept(['Waymark → L1 · dept-frontend · skills: dept-frontend'], []), 'dept-frontend');
  assert.equal(routedDept(['Waymark → L2 · frontend-team'], []), null, 'only the ten department names');
  assert.equal(routedDept(['Waymark → L1 · waymark'], []), null);
  assert.deepEqual([routedLevel(['Waymark → L2 or Q · dept-qa'], []), routedDept(['Waymark → L2 or Q · dept-qa'], [])], [2, 'dept-qa']);
  assert.equal(routedLevel(['Waymark → L0 or Q · dept-qa'], []), 'Q');
});

test('Codex on Windows: binaries run with node (its sandbox cannot run pnpm exec); other agents keep the manager', async () => {
  const { stackLine, translate, binEntry, directBins, stackOf } = await import(`file://${SCRIPTS}/stack.mjs`);
  const repo = tmpRepo('direct');
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.5.0', devDependencies: { typescript: '5.9.3' } }));
  fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), '');
  const bin = path.join(repo, 'node_modules', '.bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(path.join(repo, 'node_modules', 'typescript', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'), '');
  fs.writeFileSync(path.join(bin, 'tsc'), '#!/bin/sh\nexec node  "$basedir/../.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc" "$@"\n');
  fs.writeFileSync(path.join(bin, 'vitest'), '#!/bin/sh\nexec node  "$basedir/../.pnpm/vitest@4.1.7/node_modules/vitest/vitest.mjs" "$@"\n');
  assert.equal(binEntry(repo, 'tsc'), 'node_modules/typescript/bin/tsc', 'the top-level link when it exists');
  assert.equal(binEntry(repo, 'vitest'), 'node_modules/.pnpm/vitest@4.1.7/node_modules/vitest/vitest.mjs', 'else the launcher\'s own path');
  assert.equal(binEntry(repo, 'nope'), null);
  assert.deepEqual([directBins('codex', 'win32'), directBins('codex', 'linux'), directBins('claude', 'win32')], [true, false, false]);
  const s = stackOf(repo);
  assert.equal(translate('pnpm exec tsc -p tsconfig.app.json --noEmit', s, { root: repo, direct: true }), 'node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit');
  assert.equal(translate('npx eslint src && pnpm exec tsc', s, { root: repo, direct: true }), 'pnpm exec eslint src && node node_modules/typescript/bin/tsc', 'no launcher: the manager stays');
  assert.equal(translate('pnpm exec tsc', s), 'pnpm exec tsc', 'not direct: as before');
  assert.match(stackLine(repo, { direct: true }), /run binaries with `node node_modules\/<package>\/<bin>` \(`pnpm exec` fails in this agent's sandbox; tsc → `node node_modules\/typescript\/bin\/tsc`\) \/ `pnpm run <script>`$/);
  assert.match(stackLine(repo), /run with `pnpm exec <bin>` \/ `pnpm run <script>`$/);
});

test('a new project (real folder, no git, no memory) keeps its memory inside itself; the home folder and a missing path keep the home layout', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-newproj-'));
  temps.push(dir);
  const h = projectHome(dir);
  same(h.memory, path.join(dir, '.waymark', 'memory.md'));
  same(h.log, path.join(dir, '.waymark', 'provenance.jsonl'));
  assert.equal(h.legacy, false);
  assert.equal(projectHome(os.homedir()).dir, null, 'the home folder is no project');
  assert.equal(projectHome(path.join(dir, 'missing')).dir, null, 'a path that does not exist');
});

test('a command run inside a .waymark folder is no gate, even with cd and the path in separate parts', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const memWrite = 'cd C:/Users/x/.waymark && node -e "const p=\'projects/app.md\'; s=s.replace(\'gates: build\', \'ok\')"';
  const g = cierreGaps(l2([call('Bash', { command: memWrite })]), cierre(id), undefined, undefined, ctxFor(cwd));
  assert.ok(!g.observed.gates.some((x) => /\\.waymark/.test(x.cmd)), 'not listed as a gate');
  assert.match(g.observed.gate.cmd, /npm run build/, 'the real gate before it is the one judged');
  const still = cierreGaps(l2([call('Bash', { command: 'npx tsc --noEmit && grep T1 .waymark/memory.md' })]), cierre(id), undefined, undefined, ctxFor(cwd));
  assert.match(still.observed.gate.cmd, /npx tsc --noEmit/, 'a gate that also reads the memory is still a gate');
});

test('false positives from the real sessions: a cd before a relative path, scaffolding before the spec, the TDD loop and the environment', async () => {
  const { cdPaths } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  assert.equal(cdPaths('cd "C:/u/.claude/skills/dept-architecture" && grep -n "^## " procedures.md; ls -la x'), ' C:/u/.claude/skills/dept-architecture/procedures.md');
  assert.equal(cdPaths('Set-Location C:\\skills\\dept-qa; Get-Content procedures.md'), ' C:\\skills\\dept-qa/procedures.md');
  assert.equal(cdPaths('cat /abs/procedures.md'), '', 'no cd: nothing to resolve');
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd), SPECF = FILE.replace(/\.mjs$/, '.spec.mjs');
  const head = (route = 'L2', proc = [PROC('dept-backend')]) => [prompt('x'), say(`Waymark → ${route} · dept-backend`), call('Skill', { skill: 'dept-backend' }), ...proc, call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff')];
  // landing T1: the procedure read with cd + a relative name, before the first change
  const cdRead = ran('p1', 'cd "C:/u/.claude/skills/dept-backend" && cat procedures.md'); // the output is what was read
  const L1 = [...head('L2', cdRead), call('Edit', { file_path: FILE }), call('Bash', { command: 'npm run build' }), call('Skill', { skill: 'code-review' }), MEM()];
  const g1 = cierreGaps(currentTurn(L1), cierre(id), sessionTools(L1), undefined, ctx); // the hook reads outputs from the whole session
  assert.deepEqual([g1.observed.procedure.readBeforeChange, g1.steps.find((x) => x.id === 'procedure').pass], [true, true]);
  // landing T1: config before the spec, then spec → red run → code: test-first
  const scaffold = [call('Write', { file_path: '/work/proj/pnpm-workspace.yaml' }), call('Edit', { file_path: SPECF }), call('Bash', { command: 'npm test -- orders' }), call('Edit', { file_path: FILE }), call('Bash', { command: 'npm run build && npm test' }), call('Skill', { skill: 'code-review' }), MEM()];
  assert.equal(cierreGaps(currentTurn([...head(), ...scaffold]), cierre(id), undefined, undefined, ctx).steps.find((x) => x.id === 'red').pass, true);
  // Codex T4: the environment failing twice is no failed attempt; a test red → fix → green is no blind retry
  const env = (rid) => ran(rid, 'pnpm exec vitest run orders.spec.ts', true).map((d, i) => (i === 1 ? { ...d, message: { content: [{ type: 'tool_result', tool_use_id: rid, is_error: true, content: "'vitest' is not recognized as an internal or external command" }] } } : d));
  const g2 = cierreGaps(currentTurn([...head(), call('Edit', { file_path: FILE }), ...env('v1'), ...env('v2'), ...ran('v3', 'node node_modules/vitest/vitest.mjs run orders.spec.ts', true), call('Edit', { file_path: FILE }), ...ran('v4', 'node node_modules/vitest/vitest.mjs run orders.spec.ts'), call('Bash', { command: 'npm run build' }), call('Skill', { skill: 'code-review' }), MEM()]), cierre(id), undefined, undefined, ctx);
  assert.equal(g2.steps.find((x) => x.id === 'docs').applies, false, 'no two failed attempts');
  assert.ok(!g2.findings.some((f) => /a command after the last change failed/.test(f)), 'an environment failure is no failed command');
  // a last gate that failed only because the command was not found checked nothing: the hook's own typecheck decides
  const envGate = ran('g9', 'pnpm exec tsc --noEmit', true).map((d, i) => (i === 1 ? { ...d, message: { content: [{ type: 'tool_result', tool_use_id: 'g9', is_error: true, content: "'tsc' is not recognized as an internal or external command" }] } } : d));
  const g3 = cierreGaps(currentTurn([...head(), call('Edit', { file_path: FILE }), ...envGate, call('Skill', { skill: 'code-review' }), MEM()]), cierre(id), undefined, undefined, { ...ctx, rerun: () => ({ cmd: 'npx tsc --noEmit', ok: true, s: 5 }) });
  assert.deepEqual([g3.observed.gate.by, g3.observed.gate.ok, g3.steps.find((x) => x.id === 'preexisting').applies], ['testigo', true, false]);
});

// ---- 3d: Gemini CLI and OpenCode adapters (docs/adr/0013) ----
const gm = (id, type, extra = {}) => ({ id, timestamp: '2026-10-05T20:00:00.000Z', type, ...extra });
test('Gemini adapter: its transcript (last line per id, rewinds), ask_user answers, SKILL.md read, tools and tokens in the core shape', async () => {
  const g = await import(`file://${SCRIPTS}/agents/gemini.mjs`);
  const rows = [{ sessionId: 's', projectHash: 'h', startTime: 'x', kind: 'main' }, gm('u1', 'user', { content: [{ text: 'agrega reintentos' }] }),
    gm('a1', 'gemini', { content: 'pensando…' }), { $set: { summary: 'x' } },
    gm('a1', 'gemini', { content: 'Waymark → L1 · dept-backend', model: 'gemini-3-pro', tokens: { input: 1000, output: 50, cached: 800, thoughts: 10, total: 1060 },
      toolCalls: [
        { id: 'c1', name: 'read_file', args: { file_path: 'C:/s/dept-backend/SKILL.md' }, status: 'success', result: [{ functionResponse: { response: { output: '# dept' } } }] },
        { id: 'c2', name: 'ask_user', args: { questions: [{ question: '¿Cómo?', header: 'Modo', options: [{ label: 'Backoff' }, { label: 'Cola' }] }] }, status: 'success', result: [{ functionResponse: { response: { output: JSON.stringify({ answers: { 0: 'Backoff' } }) } } }] },
        { id: 'c3', name: 'replace', args: { file_path: FILE, old_string: 'a', new_string: 'b' }, status: 'success', result: 'ok' },
        { id: 'c4', name: 'run_shell_command', args: { command: 'npm run build' }, status: 'error', result: 'exit 1' }] }),
    gm('u2', 'user', { content: 'otra cosa' }), gm('a2', 'gemini', { content: 'descartado' }), { $rewindTo: 'u2' }];
  const lines = g.toLines(rows);
  const uses = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_use').map((c) => [c.name, c.input.file_path || c.input.command || c.input.skill || '']));
  assert.deepEqual(uses, [['Skill', 'dept-backend'], ['Read', 'C:/s/dept-backend/SKILL.md'], ['AskUserQuestion', ''], ['Edit', FILE], ['Bash', 'npm run build']]);
  assert.deepEqual(decisionsIn(lines).map((d) => [d.question, d.chosen]), [['¿Cómo?', 'Backoff']]);
  assert.equal(lines.filter(isPromptT).length, 1, 'the rewound prompt is gone');
  assert.ok(lines.some((l) => l.message?.content?.some?.((c) => c.type === 'tool_result' && c.is_error)), 'a failed shell command is an error result');
  assert.deepEqual(lines.find((l) => l.message?.usage).message.usage, { input_tokens: 200, cache_read_input_tokens: 800, cache_creation_input_tokens: 0, output_tokens: 60 });
  assert.deepEqual([g.call({ tool_name: 'run_shell_command', tool_input: { command: 'ls' } }), g.call({ tool_name: 'write_file', tool_input: { file_path: 'a.ts' } }), g.call({ tool_name: 'read_file', tool_input: {} })], [{ command: 'ls' }, { files: ['a.ts'] }, null]);
  assert.deepEqual([g.out.context('UserPromptSubmit', 'x').hookSpecificOutput.hookEventName, g.out.deny('r'), g.out.block('r')], ['BeforeAgent', { decision: 'deny', reason: 'r' }, { decision: 'deny', reason: 'r' }]);
});

test('OpenCode adapter: the SDK messages dump (question answers, skill tool, apply_patch files, tokens) in the core shape', async () => {
  const o = await import(`file://${SCRIPTS}/agents/opencode.mjs`);
  const tool = (tool, input, extra = {}) => ({ type: 'tool', tool, callID: `k-${tool}`, state: { status: 'completed', input, output: 'ok', time: { start: 1 }, ...extra } });
  const rows = [{ info: { id: 'm1', role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: 'agrega reintentos' }] },
    { info: { id: 'm2', role: 'assistant', modelID: 'gpt-x', time: { created: 2 }, tokens: { input: 300, output: 40, reasoning: 5, cache: { read: 900, write: 0 } } }, parts: [
      { type: 'text', text: 'Waymark → L1 · dept-backend' }, tool('skill', { name: 'dept-backend' }),
      tool('question', { questions: [{ question: '¿Cómo?', header: 'Modo', options: [{ label: 'Backoff' }, { label: 'Cola' }] }] }, { metadata: { answers: [['Backoff']] } }),
      tool('apply_patch', { patchText: '*** Begin Patch\n*** Update File: src/a.ts\n*** End Patch' }), tool('bash', { command: 'npm run build' })] }];
  const lines = o.toLines(rows, '/w/p');
  const uses = lines.flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.type === 'tool_use').map((c) => [c.name, c.input.file_path || c.input.command || c.input.skill || '']));
  assert.deepEqual(uses, [['Skill', 'dept-backend'], ['AskUserQuestion', ''], ['Edit', path.resolve('/w/p', 'src/a.ts')], ['Bash', 'npm run build']]);
  assert.deepEqual(decisionsIn(lines).map((d) => [d.question, d.chosen]), [['¿Cómo?', 'Backoff']]);
  assert.deepEqual(lines.find((l) => l.message?.usage).message.usage, { input_tokens: 300, cache_read_input_tokens: 900, cache_creation_input_tokens: 0, output_tokens: 45 });
  assert.deepEqual([o.call({ tool_name: 'bash', tool_input: { command: 'ls' } }), o.call({ tool_name: 'edit', tool_input: { filePath: 'a.ts' } }), o.call({ tool_name: 'read', tool_input: {} })], [{ command: 'ls' }, { files: ['a.ts'] }, null]);
});

test('install-hooks: Gemini gets its own event names and matcher; OpenCode gets the plugin with the scripts folder in place', async () => {
  const { planHooks, pluginText } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const { settings, steps } = planHooks({ general: { x: 1 } }, { scripts: '/s/waymark/scripts', agent: 'gemini' });
  assert.deepEqual(Object.keys(settings.hooks), ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterAgent', 'AfterTool']);
  assert.equal(steps.length, 5);
  assert.deepEqual(settings.hooks.BeforeTool, [{ matcher: 'run_shell_command|write_file|replace', hooks: [{ type: 'command', command: 'node "/s/waymark/scripts/tool-hook.mjs" --agent gemini' }] }]);
  assert.deepEqual(settings.general, { x: 1 }, 'the rest of the settings stays');
  assert.deepEqual(planHooks(settings, { scripts: '/s/waymark/scripts', agent: 'gemini' }).steps, [], 'idempotent');
  const plugin = pluginText('/s/waymark/scripts');
  assert.ok(plugin.includes('const SCRIPTS = "/s/waymark/scripts";') && !plugin.includes("'__SCRIPTS__'"));
  assert.match(plugin, /export const Waymark = async \(\{ client, \$, directory \}\)/);
});

test('OpenCode plugin: context into the system prompt, a deny throws, a stop block is sent back once', async () => {
  const { pluginText } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ocplugin-'));
  temps.push(dir);
  const file = path.join(dir, 'waymark.mjs');
  fs.writeFileSync(file, pluginText('/s/waymark/scripts'));
  const answers = { 'session-hook.mjs': { hookSpecificOutput: { additionalContext: 'CARD' } }, 'rule0-hook.mjs': { hookSpecificOutput: { additionalContext: 'RULE0' } },
    'tool-hook.mjs': { hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'ask first' } }, 'stop-hook.mjs': { decision: 'block', reason: 'Waymark: this L1 turn…' } };
  const calls = [], prompts = [];
  const $ = (strings, ...values) => {
    if (!values.length) return { nothrow: () => ({ quiet: async () => ({ stdout: Buffer.from('1.18.34\n') }) }) }; // opencode --version, once per load
    const script = String(values[0]).split(/[\\/]/).pop(); calls.push(script); const r = { stdout: Buffer.from(JSON.stringify(answers[script] || {})) }; return { nothrow: () => ({ quiet: async () => r }) }; };
  const client = { session: { messages: async () => ({ data: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'listo' }] }] }), prompt: async (x) => prompts.push(x) } };
  const { Waymark } = await import(`file://${file.replace(/\\/g, '/')}`);
  const hooks = await Waymark({ client, $, directory: dir });
  await hooks.event({ event: { type: 'session.created', properties: { info: { id: 's1' } } } });
  await hooks['chat.message']({ sessionID: 's1' }, { parts: [{ type: 'text', text: 'agrega reintentos' }] });
  const sys = { system: [] };
  await hooks['experimental.chat.system.transform']({ sessionID: 's1' }, sys);
  assert.deepEqual(sys.system, ['CARD', 'RULE0']);
  await assert.rejects(hooks['tool.execute.before']({ tool: 'edit', sessionID: 's1' }, { args: { filePath: 'a.ts' } }), /ask first/);
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
  assert.equal(prompts.length, 1, 'sent back once; the next idle is the retry (stop_hook_active)');
  assert.deepEqual(calls, ['session-hook.mjs', 'rule0-hook.mjs', 'tool-hook.mjs', 'stop-hook.mjs', 'stop-hook.mjs']);
  await hooks['chat.message']({ sessionID: 's1' }, { parts: [{ type: 'text', text: 'Waymark: this L1 turn…' }] });
  assert.equal(calls.length, 5, 'its own block reason is not a new prompt');
});

test('stop hook --agent gemini: prompt_response is the reply, the record says gemini, a block is a deny', () => {
  const { cwd } = fresh();
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const rows = [gm('u1', 'user', { content: 'agrega reintentos al servicio de pedidos' }),
    gm('a1', 'gemini', { content: 'Waymark → L1 · dept-backend', model: 'gemini-3-pro', tokens: { input: 2000, output: 100, cached: 1500 }, toolCalls: [
      { id: 'c1', name: 'read_file', args: { file_path: 'C:/s/dept-backend/SKILL.md' }, status: 'success', result: 'x' },
      { id: 'c2', name: 'read_file', args: { file_path: 'C:/s/dept-backend/procedures.md' }, status: 'success', result: '### Endpoint' },
      { id: 'c2b', name: 'run_shell_command', args: { command: 'node C:/s/waymark/scripts/waymark.mjs pack src/orders.service.mjs' }, status: 'success', result: 'x' },
      { id: 'c3', name: 'ask_user', args: { questions: [{ question: '¿Cómo?', options: [{ label: 'Backoff' }, { label: 'Cola' }] }] }, status: 'success', result: JSON.stringify({ answers: { 0: 'Backoff' } }) },
      { id: 'c4', name: 'replace', args: { file_path: FILE }, status: 'success', result: 'ok' },
      { id: 'c5', name: 'run_shell_command', args: { command: 'node --check src/orders.service.mjs && npm run build' }, status: 'success', result: 'ok' }] })];
  const transcript = path.join(home, `t-gemini-${n}.jsonl`);
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(transcript, rows.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const run = (reply) => spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs'), '--agent', 'gemini'], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'gm1', prompt_response: reply }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  const blocked = JSON.parse(run('listo').stdout);
  assert.equal(blocked.decision, 'deny', 'no Cierre: AfterAgent denies, so Gemini continues');
  const ok = JSON.parse(run(cierre(id)).stdout);
  assert.ok(ok.systemMessage && !ok.decision, ok.decision);
  const rec = readLog(cwd).pop();
  assert.deepEqual([rec.agent, rec.department.declared, rec.evaluation.model, rec.evaluation.steps.Decision], ['gemini', 'dept-backend', 'gemini-3-pro', true]);
});

// ---- notes that travel and survive (docs/adr/0013) ----
test('repairNotes: after an amend the task note is copied to the new commit with the same Waymark-Task; the chain stays intact', async () => {
  const { repairNotes, addNote, noteSha } = await import(`file://${SCRIPTS}/notes.mjs`);
  const repo = memRepo('notes-amend'), id = '2026-10-05 · T4';
  const old = commitTask(repo, id), text = JSON.stringify({ id, cierre: 'x' });
  assert.ok(addNote(repo, old, text));
  const stub = { id, note: { commit: old, sha: noteSha(text) } };
  gitT(repo, 'commit', '-q', '--amend', '-m', `x amended\n\nWaymark-Task: ${id}`);
  const now = gitT(repo, 'rev-parse', 'HEAD').stdout.trim();
  assert.notEqual(now, old);
  assert.deepEqual(repairNotes(repo, [stub]), [id]);
  const notes = readNotes(repo);
  assert.equal(notes.get(now), text, 'the note follows the task to its new commit');
  assert.equal(notes.get(old), text, 'and stays on the old one: the stub still matches');
  assert.equal(verifyChain([], notes).ok, true);
  assert.deepEqual(repairNotes(repo, [stub]), [], 'nothing left to repair');
  assert.deepEqual(repairNotes(repo, [{ id: 'other', note: { commit: old, sha: 'x' } }]), [], 'no commit of the branch carries that task');
});

test('stop hook: when the agent pushes the task, its note goes to the same remote', () => {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-remote-'));
  temps.push(remote);
  gitT(remote, 'init', '-q', '--bare');
  const repo = memRepo('notes-push'), id = `${new Date().toLocaleDateString('sv')} · T1`;
  gitT(repo, 'remote', 'add', 'origin', remote);
  commitTask(repo, id);
  gitT(repo, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  const lines = [...l2Lines, ...ran('push1', 'git push origin HEAD:main')];
  const transcript = path.join(home, 't-push.jsonl');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: repo, session_id: 's-push', last_assistant_message: cierre(id) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.match(JSON.parse(r.stdout).systemMessage, /notas subidas a origin/);
  assert.match(gitT(repo, 'ls-remote', 'origin', 'refs/notes/waymark').stdout, /refs\/notes\/waymark/);
});

test('3e-4 sizes: the block, the reminder and the card stay short, and no department rule says MUST (a testigo checks the process)', async () => {
  const { sizes } = await import(`file://${SCRIPTS}/size.mjs`);
  const rows = Object.fromEntries(sizes(process.cwd()).map((r) => [r.name, r]));
  assert.ok(rows['instructions block'].chars <= 6500, `instructions block: ${rows['instructions block'].chars} chars`);
  assert.ok(rows['reminder (full)'].chars <= 800 && rows['reminder (short)'].chars <= 300, 'reminder');
  assert.ok(rows['context card'].chars > 0 && rows['context card'].chars <= 2700, 'context card');
  const SKILLS = path.join(SCRIPTS, '..', '..');
  for (const d of fs.readdirSync(SKILLS).filter((x) => x.startsWith('dept-'))) {
    const text = fs.readFileSync(path.join(SKILLS, d, 'SKILL.md'), 'utf8');
    assert.ok(rows[d].group === 'department' && text.length <= 8000, `${d}: ${text.length} chars`);
    assert.doesNotMatch(text, /\*\*(MUST|SHOULD)\b|\bExit protocol\b|protocol → Entry/, `${d} keeps a MUST or a stale protocol pointer`);
  }
});

test('incidents by window: a suggested rule counts only the failures within the last 10 evaluated tasks', async () => {
  const { incidents } = await import(`file://${SCRIPTS}/incidents.mjs`);
  const r = (id, steps) => ({ id, evaluation: { steps } });
  const old = ['T1', 'T2', 'T3', 'T4'].map((id) => r(id, { Commit: false }));
  const later = Array.from({ length: 9 }, (_, i) => r(`T${i + 5}`, { Commit: true }));
  assert.deepEqual(incidents([...old, ...later]).rules, [], 'T1–T3 fell out of the window; only T4 is inside');
  assert.deepEqual(incidents([...old, ...later.slice(0, 7)]).rules, [{ label: 'Commit', failures: 3, ids: ['T2', 'T3', 'T4'] }]);
  assert.deepEqual(incidents([...old, { id: 'Q' }, { kind: 'confirm' }, ...later.slice(0, 6)]).rules[0].failures, 4, 'records without an evaluation do not take a place in the window');
});

test('new session notice: past 200k tokens of context the end-of-turn line says the next task goes in a new session', () => {
  const ev = { steps: { Decision: true }, score: '1/1', tokens: 1000000, quotaPct: null };
  assert.match(summaryLine('2026-10-05 · T2', ev, 420000), /· contexto ~420k: la próxima tarea, en una sesión nueva \(la tarjeta la retoma\)/);
  assert.doesNotMatch(summaryLine('2026-10-05 · T2', ev, 90000), /sesión nueva/);
});

// ---- across agents: notes that travel, the trailer's ID, pack at every level, review everywhere ----
test('pack in a fresh clone: with no local log, the commit\'s note is the record; a later commit of a recorded task is shown once', async () => {
  const { addNote } = await import(`file://${SCRIPTS}/notes.mjs`);
  const repo = memRepo('pack-clone');
  const W = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), ...a], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout;
  const sha = commitTask(repo, '2026-10-06 · T3', 'a.ts');
  addNote(repo, sha, JSON.stringify({ id: '2026-10-06 · T3', agent: 'codex', cierre: 'Aprendido: faq group ← a11y' }));
  assert.match(W('pack', 'a.ts'), /^a\.ts:\n  - 2026-10-06 · T3 · codex · faq group ← a11y · [0-9a-f]{8}$/m, 'no provenance.jsonl here: the note travels alone');
  appendRecord(repo, { id: '2026-10-06 · T1', agent: 'claude', at: new Date().toISOString(), files: [path.join(repo, 'b.ts')], commits: [], cierre: 'Aprendido: red counter ← user' });
  commitTask(repo, '2026-10-06 · T1', 'b.ts'); // committed by a later task, with T1's trailer
  const out = W('pack', 'b.ts');
  assert.match(out, /^b\.ts:\n  - 2026-10-06 · T1 · claude · red counter ← user · [0-9a-f]{8}$/m, `one row, with its commit: ${out}`);
});

test('noteLateCommits: a commit made later with an earlier task\'s trailer gets that task\'s record as its note; the log stays intact', async () => {
  const { noteLateCommits } = await import(`file://${SCRIPTS}/notes.mjs`);
  const repo = memRepo('late-note'), id = '2026-10-06 · T1', log = projectHome(repo).log;
  appendRecord(repo, { id, agent: 'claude', at: new Date().toISOString(), files: ['a.ts'], commits: [], cierre: 'Aprendido: x', evaluation: { score: '9/10' } });
  appendRecord(repo, { kind: 'Q', agent: 'codex', at: new Date().toISOString() });
  const sha = commitTask(repo, id);
  assert.deepEqual(noteLateCommits(repo, readRecords(log)), [id]);
  const note = JSON.parse(readNotes(repo).get(sha));
  assert.deepEqual([note.id, note.agent, note.commits, note.prev, note.hash], [id, 'claude', [sha], undefined, undefined]);
  assert.deepEqual(noteLateCommits(repo, readRecords(log)), [], 'once: the commit has its note now');
  assert.equal(verifyChain(readRecords(log), readNotes(repo)).ok, true, 'the chained line was not touched');
});

test('commit trailer: a follow-up ID whose task shares no staged file is denied with the new ID; a recorded, the next or a sharing ID passes', async () => {
  const { checkTrailer } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const repo = memRepo('trailer'), day = new Date().toLocaleDateString('sv');
  appendRecord(repo, { id: `${day} · T1`, files: [path.join(repo, 'a.ts')], commits: [] });
  appendRecord(repo, { id: `${day} · T2`, files: [path.join(repo, 'c.ts')], commits: [] });
  const commit = (id) => `git commit -m "feat: x" -m "Waymark-Task: ${id}"`;
  assert.equal(checkTrailer(commit(`${day} · T2b`), repo), null, 'nothing staged yet: no evidence, no denial');
  fs.writeFileSync(path.join(repo, 'b.ts'), '1\n'); gitT(repo, 'add', 'b.ts');
  assert.match(checkTrailer(commit(`${day} · T2b`), repo) || '', new RegExp(`Waymark-Task: ${day} · T2b[\\s\\S]*${day} · T3`));
  assert.match(checkTrailer(commit(`${day} · T9`), repo) || '', new RegExp(`${day} · T3`), 'an ID never offered');
  assert.equal(checkTrailer(commit(`${day} · T3`), repo), null, 'the next ID');
  assert.equal(checkTrailer(commit(`${day} · T1`), repo), null, 'a recorded task: its work committed by a later task');
  fs.writeFileSync(path.join(repo, 'c.ts'), '1\n'); gitT(repo, 'add', 'c.ts');
  assert.equal(checkTrailer(commit(`${day} · T2b`), repo), null, 'the follow-up shares c.ts with T2');
  assert.equal(checkTrailer('git status --short', repo), null);
});

test('Recordar at every level: an L1 change without pack (or mem_search) is blocked; with pack it passes', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const lines = (withPack) => [prompt('cambia el texto del botón'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend'), ...(withPack ? [PACK()] : []),
    ...askWithId('q1', '¿Texto?', ['Enviar', 'Otra'], 'Enviar'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx tsc --noEmit' })];
  const judge = (l) => cierreGaps(currentTurn(l), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(l), taskTools: sessionTools(l) });
  const without = judge(lines(false));
  assert.ok(without.missing.some((m) => /^the project memory was not searched before the first change: run waymark\.mjs pack/.test(m)), JSON.stringify(without.missing));
  assert.equal(judge(lines(true)).steps.find((s) => s.id === 'memory').pass, true);
});

test('review everywhere: waymark.mjs review on the task\'s files counts as the review; Codex reads a SKILL.md to invoke it, a Test-Path does not', async () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const base = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), PACK(),
    ...askWithId('q1', '¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npm run build' })];
  const judge = (l) => cierreGaps(currentTurn(l), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(l), taskTools: sessionTools(l) });
  assert.ok(judge(base).missing.some((m) => /no review ran: .*waymark\.mjs review/.test(m)));
  assert.equal(judge([...base, call('Bash', { command: 'node "C:/s/waymark/scripts/waymark.mjs" review src/orders.service.mjs' })]).observed.review, true);
  for (const a of ['codex', 'gemini', 'opencode']) assert.deepEqual((await import(`file://${SCRIPTS}/agents/${a}.mjs`)).lacks, [], `${a} reviews with waymark.mjs review`);
  const cx = await import(`file://${SCRIPTS}/agents/codex.mjs`);
  const skills = (command) => cx.toLines([row('session_meta', { cli_version: '0.160.0' }), cxUser('t9', 'i9', 'x'), cxCmd('t9', command)]).flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : []).filter((c) => c.name === 'Skill').map((c) => c.input.skill));
  assert.deepEqual(skills("Test-Path 'C:\\Users\\u\\.claude\\skills\\code-review\\SKILL.md'"), [], 'checking that it exists is not invoking it');
  assert.deepEqual(skills("Get-Content -Path 'C:\\Users\\u\\.claude\\skills\\dept-frontend\\SKILL.md'"), ['dept-frontend']);
});

test('waymark.mjs review: the diff of the task\'s files (new ones included) and the checklist', () => {
  const repo = memRepo('review');
  const W = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), ...a], { cwd: repo, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } }).stdout;
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n'); gitT(repo, 'add', 'a.ts'); gitT(repo, 'commit', '-q', '-m', 'a');
  fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(repo, 'n.ts'), 'export const n = 0;\n');
  const out = W('review', 'a.ts', 'n.ts');
  assert.match(out, /^-export const a = 1;$/m);
  assert.match(out, /^\+export const a = 2;$/m);
  assert.match(out, /new file n\.ts[\s\S]*export const n = 0;/);
  assert.match(out, /Checklist/);
  assert.match(W('review'), /^Usage: node waymark\.mjs review <file…>/);
});

test('OpenCode: a tool lasts from time.start to time.end; the plugin\'s version reaches the record\'s inputs', async () => {
  const o = await import(`file://${SCRIPTS}/agents/opencode.mjs`);
  const rows = [{ info: { id: 'm1', role: 'user', time: { created: 1000 } }, parts: [{ type: 'text', text: 'build' }] },
    { info: { id: 'm2', role: 'assistant', modelID: 'big-pickle', time: { created: 2000 } }, parts: [{ type: 'tool', tool: 'bash', callID: 'k1', state: { status: 'completed', input: { command: 'pnpm run build' }, output: 'ok', time: { start: 3000, end: 43000 } } }] }];
  const lines = o.toLines(rows, '/w/p', '1.18.34');
  const at = (type) => Date.parse(lines.find((l) => l.message?.content?.[0]?.type === type).timestamp);
  assert.equal(at('tool_result') - at('tool_use'), 40000);
  assert.equal(turnInputs(lines, '/w/p').agent, '1.18.34');
  assert.match(fs.readFileSync(path.join(SCRIPTS, 'agents', 'opencode-plugin.js'), 'utf8'), /agent_version/);
});

// ---- three layers of memory (docs/adr/0015): engram written by the hooks, Recordar by the hook, pending tasks close ----
// A fake engram: logs each call's args (one JSON line) and answers `context` with two observations.
const fakeEngram = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-engram-'));
  temps.push(dir);
  const log = path.join(dir, 'calls.jsonl'), bin = path.join(dir, 'engram.mjs');
  fs.writeFileSync(bin, `import fs from 'node:fs';
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
if (a[0] === 'version') console.log('engram 3.1.0');
if (a[0] === 'context') console.log('## Memory from Previous Sessions\\n\\n### Recent Observations\\n- [learning] **2026-10-06 · T4 · precios**: Aprendido: el ahorro vive en la entity\\n- [learning] **2026-10-06 · T3 · faq**: Aprendido: grupo con nombre accesible');
if (a[0] === 'sync' && a[1] !== '--import') { fs.mkdirSync('.engram/chunks', { recursive: true }); fs.writeFileSync('.engram/chunks/c1.jsonl.gz', 'x'); }
`);
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []) };
};
const withEngram = async (bin, fn) => { const prev = process.env.WAYMARK_ENGRAM; process.env.WAYMARK_ENGRAM = bin; try { return await fn(); } finally { process.env.WAYMARK_ENGRAM = prev; } };

test('engram layer: the close saves the Aprendido under the project slug (config pinned), a commit stages .engram/, chunks import once, the card reads the latest', async () => {
  const e = await import(`file://${SCRIPTS}/engram.mjs`);
  const repo = memRepo('engram-layer'), h = projectHome(repo), fake = fakeEngram();
  await withEngram(fake.bin, async () => {
    const rec = { id: '2026-10-06 · T1', agent: 'codex', prompt: 'contador en rojo', files: [path.join(repo, 'a.ts')], commits: ['abcdef123456'], decisions: [{ chosen: 'Rojo al pasar 500' }], cierre: '## Cierre · x\nResultado: hecho\nAprendido: reusar el rojo de errores ← html:89' };
    assert.equal(e.saveLearned(h, rec), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, '.engram', 'config.json'), 'utf8')), { project_name: h.slug });
    const save = fake.calls().find((c) => c[0] === 'save');
    assert.deepEqual([save[1], save[save.indexOf('--project') + 1], save[save.indexOf('--topic') + 1], save[save.indexOf('--type') + 1]], ['2026-10-06 · T1 · contador en rojo', h.slug, 'waymark/2026-10-06 · T1', 'learning']);
    assert.match(save[2], /^Aprendido: reusar el rojo de errores ← html:89\nDecisión: Rojo al pasar 500\nArchivos: a\.ts\nCommit: abcdef12\nAgente: codex$/);
    assert.equal(e.saveLearned(h, { ...rec, cierre: 'Resultado: hecho' }), false, 'no Aprendido, nothing to learn');
    assert.equal(e.stageForCommit(h), true);
    assert.match(gitT(repo, 'diff', '--cached', '--name-only').stdout, /\.engram\/chunks\/c1\.jsonl\.gz[\s\S]*\.engram\/config\.json|\.engram\/config\.json[\s\S]*\.engram\/chunks\/c1\.jsonl\.gz/);
    fs.writeFileSync(path.join(repo, '.engram', 'manifest.json'), '{}');
    const state = path.join(home, 'engram-import-test.json');
    assert.deepEqual([e.importChunks(h, state), e.importChunks(h, state)], [true, false], 'once per manifest change');
    assert.deepEqual(e.learnedLines(h), ['2026-10-06 · T4 · precios: Aprendido: el ahorro vive en la entity', '2026-10-06 · T3 · faq: Aprendido: grupo con nombre accesible']);
  });
  assert.deepEqual([e.saveLearned(h, { id: 'x', cierre: 'Aprendido: y' }), e.learnedLines(h)], [false, []], 'no engram: a no-op, Waymark keeps git and memory.md');
});

test('Recordar by the hook: the first edit of each file in a task gets its pack (once); the end-of-turn hook counts it as the memory searched', async () => {
  const { packContext, packedFiles } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);
  const repo = memRepo('recordar-hook'), state = path.join(home, `packed-${n}.json`);
  fs.writeFileSync(path.join(repo, 'a.ts'), '1\n'); gitT(repo, 'add', 'a.ts'); gitT(repo, 'commit', '-q', '-m', 'by hand');
  const hook = (file) => ({ cwd: repo, session_id: 'sp', tool_name: 'Edit', tool_input: { file_path: path.join(repo, file) } });
  const first = await packContext(hook('a.ts'), claude, state);
  assert.match(first || '', /^Waymark memory for the file you are changing[\s\S]*a\.ts:\n  - [0-9a-f]{8} · by hand \(no task record\)/);
  assert.equal(await packContext(hook('a.ts'), claude, state), null, 'once per file and task');
  assert.match(await packContext(hook('b.ts'), claude, state) || '', /b\.ts: no earlier task or commit/);
  assert.equal(packedFiles('sp', 0, state).size, 2);
  assert.equal(await packContext({ ...hook('a.ts'), tool_input: { file_path: path.join(os.homedir(), '.waymark', 'x.md') } }, claude, state), null, 'memory files are exempt');
  assert.deepEqual([claude.preContext, (await import(`file://${SCRIPTS}/agents/codex.mjs`)).preContext, (await import(`file://${SCRIPTS}/agents/opencode.mjs`)).preContext, (await import(`file://${SCRIPTS}/agents/gemini.mjs`)).preContext], [true, true, false, false]);
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const lines = [prompt('cambia el texto'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend'), ...askWithId('q1', '¿Texto?', ['Enviar', 'Otra'], 'Enviar'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx tsc --noEmit' })];
  const g = cierreGaps(currentTurn(lines), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(lines), taskTools: sessionTools(lines), packed: 1 });
  assert.equal(g.steps.find((s) => s.id === 'memory').pass, true, 'the hook handed the pack over: no agent step needed');
});

test('Recordar by the hook, end to end: OpenCode and Gemini get the pack with the result (after-tool); Codex before the tool, with no permissionDecision', () => {
  const repo = memRepo('recordar-e2e');
  const env = { ...process.env, WAYMARK_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'wm-packed-')) };
  temps.push(env.WAYMARK_HOME);
  const runTool = (agent, payload) => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'tool-hook.mjs'), '--agent', agent], { input: JSON.stringify({ cwd: repo, ...payload }), env, encoding: 'utf8' }).stdout || '{}');
  const oc = runTool('opencode', { hook_event_name: 'PostToolUse', session_id: 'o1', tool_name: 'edit', tool_input: { filePath: path.join(repo, 'a.ts') } });
  assert.match(oc.hookSpecificOutput?.additionalContext || '', /a\.ts: no earlier task or commit/);
  const gm = runTool('gemini', { hook_event_name: 'AfterTool', session_id: 'g1', tool_name: 'replace', tool_input: { file_path: path.join(repo, 'a.ts') } });
  assert.deepEqual([gm.hookSpecificOutput?.hookEventName, /a\.ts:/.test(gm.hookSpecificOutput?.additionalContext || '')], ['AfterTool', true]);
  const transcript = path.join(env.WAYMARK_HOME, 'no-turn.jsonl');
  fs.writeFileSync(transcript, '');
  const cx = runTool('codex', { hook_event_name: 'PreToolUse', session_id: 'c1', transcript_path: transcript, tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: b.ts\n*** End Patch' } });
  assert.deepEqual(Object.keys(cx.hookSpecificOutput || {}).sort(), ['additionalContext', 'hookEventName'], 'Codex 0.160 drops the context when permissionDecision is allow');
  assert.match(cx.hookSpecificOutput.additionalContext, /b\.ts: no earlier task or commit/);
});

test('install-hooks: Gemini also gets AfterTool (the pack with the result); Claude Code and Codex keep their four hooks', async () => {
  const { planHooks } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  assert.deepEqual(Object.keys(planHooks({}, { agent: 'gemini', scripts: '/s' }).settings.hooks), ['SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterAgent', 'AfterTool']);
  assert.deepEqual(Object.keys(planHooks({}, { agent: 'claude', scripts: '/s' }).settings.hooks), ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop']);
  assert.match(JSON.stringify(planHooks({}, { agent: 'gemini', scripts: '/s' }).settings.hooks.AfterTool), /tool-hook\.mjs\\" --agent gemini.*run_shell_command\|write_file\|replace|run_shell_command\|write_file\|replace.*tool-hook\.mjs/);
});

test('pending tasks close by time: a turn another session left open over two hours becomes an interrupted record; the current session\'s stays', () => {
  const repo = memRepo('interrupted'), h = projectHome(repo), now = new Date();
  fs.writeFileSync(path.join(repo, '.waymark', 'open.json'), JSON.stringify({
    old: { at: new Date(now - 3 * 3600000).toISOString(), next: '2026-10-06 · T2', agent: 'gemini', prompt: '¿por dónde voy?' },
    mine: { at: new Date(now - 5 * 3600000).toISOString(), next: '2026-10-06 · T2', agent: 'claude', prompt: 'sigue' },
    fresh: { at: new Date(now - 600000).toISOString(), next: '2026-10-06 · T2', agent: 'codex', prompt: 'x' } }));
  const gone = expireOpenT(h, 'mine', now);
  assert.deepEqual(gone.map((o) => o.agent), ['gemini']);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(repo, '.waymark', 'open.json'), 'utf8'))).sort(), ['fresh', 'mine']);
  const rec = readRecords(h.log).pop();
  assert.deepEqual([rec.kind, rec.agent, rec.task, rec.prompt], ['interrupted', 'gemini', '2026-10-06 · T2', '¿por dónde voy?']);
  assert.equal(verifyChain(readRecords(h.log)).ok, true);
});

test('pending tasks close by record: a later task that passes the testigo clears "sin resolver"; a follow-up done closes its ▶', () => {
  const repo = memRepo('sin-resolver', '- ▶ [2026-10-06 · T1] contador a medias\n'), h = projectHome(repo);
  appendRecord(repo, { id: '2026-10-06 · T1', agent: 'claude', at: new Date().toISOString(), cierre: 'Resultado: parcial\nAprendido: a medias', unresolved: ['no pack'], evaluation: { score: '9/10', steps: { Recordar: false, Decision: true } } });
  refreshTasks(h, true);
  assert.match(fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8'), /2026-10-06 · T1 · claude \| parcial · 1 sin resolver/);
  const t1b = { id: '2026-10-06 · T1b', agent: 'codex', at: new Date().toISOString(), cierre: 'Resultado: hecho\nAprendido: terminado', unresolved: [], evaluation: { score: '10/10', steps: { Recordar: true, Decision: true } } };
  appendRecord(repo, t1b);
  writeTaskLine(h, t1b);
  refreshTasks(h, true);
  const tasks = fs.readFileSync(path.join(repo, '.waymark', 'tasks.md'), 'utf8');
  assert.match(tasks, /2026-10-06 · T1 · claude \| parcial \|/, 'Recordar passed later: no longer "sin resolver"');
  assert.doesNotMatch(fs.readFileSync(h.memory, 'utf8'), /▶ \[2026-10-06 · T1\]/, 'the follow-up done closed the ▶ (any agent)');
});

test('fewer responses: a department loaded earlier in the session owns a task routed by the line alone (C1); the reminder brings git status (C2) and no rule twice (C3)', async () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const lines = [prompt('otro cambio'), say('Waymark → L1 · dept-frontend'), PROC('dept-frontend'), PACK(), ...askWithId('q1', '¿Cómo?', ['A', 'B'], 'A'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx tsc --noEmit' })];
  const judge = (sessionDepts) => cierreGaps(currentTurn(lines), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(lines), taskTools: sessionTools(lines), sessionDepts });
  const loaded = judge(['dept-devex', 'dept-frontend']);
  assert.deepEqual([loaded.dept.declared, loaded.missing], ['dept-frontend', []], 'invoked in an earlier task of this session: the line is enough');
  assert.ok(judge([]).missing.some((m) => /no owner department was invoked/.test(m)), 'never loaded in the session: invoke it once');
  const { gitLine, REMINDER } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
  const repo = memRepo('gitline');
  fs.writeFileSync(path.join(repo, 'x.ts'), '1\n');
  assert.match(gitLine(repo), /^ Git \(read now\): [^·]+ · \d+ changed: .*\?\? x\.ts/);
  assert.equal(gitLine(path.join(os.tmpdir(), 'no-such-dir-wm')), '');
  assert.ok(REMINDER.full.length < 400 && !/procedures\.md section|browser verification|Independent tool calls/.test(REMINDER.full), 'the block holds the rules once');
});

test('learned move: Solved problems, Gotchas and Decisions go to engram once; memory.md keeps the manual, history.md the moved text', async () => {
  const { learnedEntries, moveLearned } = await import(`file://${SCRIPTS}/learned.mjs`);
  const repo = memRepo('learned-move'), h = projectHome(repo), fake = fakeEngram();
  fs.appendFileSync(h.memory, '\n## Solved problems\nSearched by symptom.\n- [2026-10-01] Symptom: X fails · Root cause: Y · Fix: Z\n\n## Gotchas\n- …\n- CRLF breaks edits\n\n## Decisions (ADR log)\n- [YYYY-MM-DD] <decision> — <why>\n- [2026-10-02] Use pnpm — lockfile\n\n## Project skills\n- none\n');
  assert.deepEqual(learnedEntries(fs.readFileSync(h.memory, 'utf8')).map((e) => [e.section, e.type]), [['Solved problems', 'bugfix'], ['Gotchas', 'learning'], ['Decisions', 'decision']], 'placeholders skipped');
  assert.equal(await withEngram(fake.bin, () => moveLearned(h)), 3);
  const saves = fake.calls().filter((c) => c[0] === 'save');
  assert.deepEqual(saves.map((c) => [c[1], c[c.indexOf('--type') + 1]]), [['X fails', 'bugfix'], ['CRLF breaks edits', 'learning'], ['Use pnpm', 'decision']]);
  const mem = fs.readFileSync(h.memory, 'utf8');
  assert.ok(!/## (Solved problems|Gotchas|Decisions)/.test(mem) && /## Identity/.test(mem) && /## Project skills\n- none/.test(mem), mem);
  assert.match(fs.readFileSync(path.join(repo, '.waymark', 'history.md'), 'utf8'), /moved to engram[\s\S]*Symptom: X fails[\s\S]*Use pnpm/);
  assert.equal(await withEngram(fake.bin, () => moveLearned(h)), 0, 'nothing left');
  fs.appendFileSync(h.memory, '\n## Gotchas\n- again\n');
  assert.equal(moveLearned(h), null, 'no engram: nothing moved, nothing removed');
  assert.match(fs.readFileSync(h.memory, 'utf8'), /## Gotchas\n- again/);
});

test('git commit detection: the command run, not the word in a log or grep', async () => {
  const { GIT_COMMIT } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  for (const c of ['git commit -m "x"', 'git add a.ts && git commit -m x', 'git -C ../api commit -m x', 'git -c user.name=t commit -m x', 'cd repo; git commit -F -']) assert.ok(GIT_COMMIT.test(c), c);
  for (const c of ['git log --oneline | grep commit', 'git show HEAD --stat # last commit', 'echo "git commit later"', 'git log --grep=commit']) assert.ok(!GIT_COMMIT.test(c), c);
});

test('one Cierre per task: after a block the agent writes only what changed; the hook keeps the Cierre written earlier in the turn', async () => {
  const { effectiveReply, blockReason } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const first = cierre(id);
  assert.equal(effectiveReply(['texto', first], first), first, 'a reply with its Cierre is judged as is');
  const kept = effectiveReply(['Waymark → L2', first, 'Listo: corrí el build.'], 'Listo: corrí el build.');
  assert.ok(kept.startsWith(`## Cierre · ${id}\n`), kept);
  assert.match(kept, /Aprendido:[^\n]*\n\nListo: corrí el build\.$/);
  const fixed = effectiveReply([first, 'Resultado: parcial (falta el deploy)'], 'Resultado: parcial (falta el deploy)');
  assert.match(fixed, /^Resultado: parcial \(falta el deploy\)$/m);
  assert.equal(fixed.match(/^Resultado:/gm).length, 1, 'the field is replaced, never twice');
  assert.equal(effectiveReply(['sin cierre'], 'listo'), 'listo', 'no Cierre in the turn: nothing to keep');
  assert.match(blockReason({ level: 2, missing: ['L2+ with code: run the build once now'] }), /Do not repeat the Cierre: the hook keeps the one you wrote/);
  assert.match(blockReason({ level: 1, missing: ['the "## Cierre · <task ID>" block (Resultado · Evidencia · Aprendido)'] }), /then reply with the Cierre\.$/);
  const transcript = [...l2Lines.slice(0, -2), say(first), call('Skill', { skill: 'code-review' }), say('Listo: corrí code-review.'), MEM()];
  const { out, records } = runStop(transcript, 'Listo: corrí code-review.', { stop_hook_active: true });
  assert.ok(JSON.parse(out).systemMessage && !JSON.parse(out).decision, out);
  assert.match(records[0].cierre, /^## Cierre · /, 'recorded with the Cierre written before the block');
});

test('no secret reaches engram: the learned save and the learned move mask them', async () => {
  const e = await import(`file://${SCRIPTS}/engram.mjs`);
  const repo = memRepo('engram-secret'), h = projectHome(repo), fake = fakeEngram();
  await withEngram(fake.bin, () => e.saveLearned(h, { id: '2026-10-06 · T8', prompt: 'conecta con password: hunter2', cierre: 'Aprendido: la api key = sk-live-123456789abcdef ← .env' }));
  const save = fake.calls().find((c) => c[0] === 'save');
  assert.doesNotMatch(save.join(' '), /hunter2|sk-live-123456789abcdef/);
  assert.match(save[2], /\[redactado\]/);
});

test('a task that changed no project file (a push the user asked for): a missing choice window is recorded, not blocked; the message never says "changed files"', async () => {
  const { blockReason } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const lines = [prompt('haz push por favor'), say('Waymark → L1 · dept-devops'), call('Skill', { skill: 'dept-devops' }), PROC('dept-devops'), PACK(), call('Bash', { command: 'git push origin develop 2>&1 | tail -6' })];
  const g = cierreGaps(currentTurn(lines), cierre(ids.next), undefined, undefined, { ids, decisions: decisionsIn(lines), taskTools: sessionTools(lines), outside: true });
  assert.deepEqual(g.changed, []);
  assert.deepEqual(g.missing, [], 'not blocked');
  const dec = g.steps.find((s) => s.id === 'decision');
  assert.deepEqual([dec.pass, dec.enforce], [false, 'record'], 'still recorded and scored');
  assert.match(blockReason({ level: 1, changed: [], missing: ['x'] }), /^Waymark: this L1 task \(no project file changed\) and is missing/);
  assert.match(blockReason({ level: 2, changed: ['a.ts'], missing: ['x'] }), /^Waymark: this L2 turn changed files/);
});

test('context brake: a message to a session past 150k is stopped before the model once, kept for the next session, and brought by its card', async () => {
  const { brake, BRAKE_TOKENS } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
  const { heldPrompt } = await import(`file://${SCRIPTS}/session-hook.mjs`);
  const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`), codex = await import(`file://${SCRIPTS}/agents/codex.mjs`);
  const repo = memRepo('brake'), state = path.join(home, `brake-${n}.json`);
  const hook = (session, prompt = 'agrega un buscador al FAQ') => ({ cwd: repo, session_id: session, prompt });
  assert.equal(BRAKE_TOKENS, 150000);
  assert.equal(brake(hook('s1'), claude, { context: 90000 }, state), null, 'a small session is never braked');
  const held = brake(hook('s1'), claude, { context: 180000 }, state);
  assert.equal(held.block.decision, 'block');
  assert.match(held.block.reason, /~180k tokens[\s\S]*Open a new session[\s\S]*Send it again here to continue/);
  assert.equal(brake(hook('s1'), claude, { context: 190000 }, state), null, 'once per session: resent, it continues');
  assert.equal(heldPrompt(projectHome(repo)), 'agrega un buscador al FAQ');
  assert.equal(heldPrompt(projectHome(repo)), '', 'brought once, then cleared');
  assert.equal(brake(hook('s2'), codex, { context: 200000 }, state).block.decision, 'block', 'Codex 0.160 takes the same shape');
  const gemini = await import(`file://${SCRIPTS}/agents/gemini.mjs`);
  assert.equal(brake(hook('s3'), gemini, { context: 200000 }, state).block.decision, 'deny', 'Gemini CLI BeforeAgent denies');
  assert.match(brake(hook('s4'), { out: {} }, { context: 200000 }, state).line, /~200k tokens[\s\S]*a new session is cheaper/, 'an agent that cannot stop a prompt gets one line');
});

test('context brake in OpenCode: the plugin shows the reason and throws from chat.message, so the message never reaches the model', async () => {
  const { pluginText } = await import(`file://${SCRIPTS}/install-hooks.mjs`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ocbrake-'));
  temps.push(dir);
  const file = path.join(dir, 'waymark.mjs');
  fs.writeFileSync(file, pluginText('/s/waymark/scripts'));
  const toasts = [];
  const $ = (strings, ...values) => {
    if (!values.length) return { nothrow: () => ({ quiet: async () => ({ stdout: Buffer.from('1.18.34\n') }) }) };
    const script = String(values[0]).split(/[\\/]/).pop();
    const r = { stdout: Buffer.from(JSON.stringify(script === 'rule0-hook.mjs' ? { decision: 'block', reason: 'Waymark: this session holds ~180k' } : {})) };
    return { nothrow: () => ({ quiet: async () => r }) };
  };
  const client = { session: { messages: async () => ({ data: [] }) }, tui: { showToast: async (x) => toasts.push(x) } };
  const { Waymark } = await import(`file://${file.replace(/\\/g, '/')}`);
  const hooks = await Waymark({ client, $, directory: dir });
  await assert.rejects(hooks['chat.message']({ sessionID: 's1' }, { parts: [{ type: 'text', text: 'agrega un buscador' }] }), /holds ~180k/);
  assert.equal(toasts[0].body.variant, 'warning');
});

test('one project-skills folder: a skill in .agents/skills (Codex, OpenCode, Gemini) is mirrored to .claude/skills for Claude Code and back; newer wins, nothing deleted', async () => {
  const { mirrorProjectSkills } = await import(`file://${SCRIPTS}/project-skills.mjs`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pskills-'));
  temps.push(root);
  const put = (dir, name, text, mtime) => { const d = path.join(root, dir, name); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'SKILL.md'), text); fs.utimesSync(path.join(d, 'SKILL.md'), mtime, mtime); };
  put('.agents/skills', 'flujo-add-section', 'by codex', new Date('2026-10-06T10:00:00Z'));
  assert.deepEqual(mirrorProjectSkills(root, { claude: true }), ['flujo-add-section → .claude/skills']);
  assert.equal(fs.readFileSync(path.join(root, '.claude/skills/flujo-add-section/SKILL.md'), 'utf8'), 'by codex');
  assert.deepEqual(mirrorProjectSkills(root, { claude: true }), [], 'equal now: nothing to do');
  put('.claude/skills', 'flujo-add-section', 'improved by claude', new Date('2026-10-06T12:00:00Z'));
  assert.deepEqual(mirrorProjectSkills(root, { claude: true }), ['flujo-add-section → .agents/skills']);
  assert.equal(fs.readFileSync(path.join(root, '.agents/skills/flujo-add-section/SKILL.md'), 'utf8'), 'improved by claude');
  put('.agents/skills', 'solo-codex', 'x', new Date('2026-10-06T10:00:00Z'));
  assert.deepEqual(mirrorProjectSkills(root, { claude: false }), [], 'no Claude Code on the machine: no .claude copy');
});
