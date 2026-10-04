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
process.env.WAYMARK_HOME = home;
const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-agents-')); // never the real ~/.codex, ~/.gemini…
process.env.WAYMARK_AGENTS_HOME = agentsHome;
process.env.WAYMARK_BACKUPS = path.join(home, 'backups');
const temps = [home, agentsHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { taskIds, validId, decisionsIn, projectSlug, readLog, appendRecord, taskLines, verifyChain, turnInputs, commitsFor, gitSnapshot, snapshotDiff, mutatesFiles, changesProject } = await import(`file://${SCRIPTS}/provenance.mjs`);
const { checkDecision } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { checkCierre, cierreGaps, provenanceRecord, splitTop, branchesOf, evaluate, summaryLine } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { taskLine } = await import(`file://${SCRIPTS}/rule0-hook.mjs`);
const { currentTurn, routedLevel, routedDept, readSomething, turnUsage } = await import(`file://${SCRIPTS}/transcript.mjs`);

const NOW = new Date(2026, 9, 2, 12, 0); // 2026-10-02 local
const DAY = '2026-10-02';
const FILE = '/work/proj/src/orders.service.mjs'; // a project file: not exempt, no spec folder on disk
const PROC = (dept) => call('Read', { file_path: `/skills/${dept}/procedures.md` }); // the owner's procedure, read
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
  const asked = [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), PROC('dept-backend'), call('AskUserQuestion', { questions: [] }), answered('Q', ['A', 'B'], 'A')];
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
  assert.match(deny, /→ confirmada/);
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
  prompt('agrega reintentos al servicio de pedidos'), say('Waymark → L2 · dept-backend · skills: code-review'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'),
  call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
  call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Skill', { skill: 'code-review' }), MEM(), ...extra,
]);
const cierre = (id, decision = 'elegida Backoff · descartadas Cola', resultado = 'Resultado: hecho · ', sub = 'ninguna') =>
  `## Cierre · ${id}\n${resultado}Decisión: ${decision}\nSub-decisiones: ${sub}\nEvidencia: observada timeouts en el log de pedidos\nAprendido: "backoff ← timeouts"`;
const ctxFor = (cwd, decisions = [{ question: '¿Cómo?', chosen: 'Backoff', discarded: ['Cola'] }]) => ({ ids: taskIds(cwd), decisions });

test('Cierre: a complete L2 record passes', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  assert.equal(checkCierre(l2(), cierre(ids.next), undefined, undefined, ctxFor(cwd)), null);
});

test('2b: a sub-decision asked late passes the block but fails Decision; a late question alone is a finding', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const decisions = [{ question: '¿Cómo?', chosen: 'Backoff', discarded: ['Cola'] }, { question: '¿Límite?', chosen: '3', discarded: ['5'] }];
  const turn = l2([call('AskUserQuestion', { questions: [] }), answered('¿Límite?', ['3', '5'], '3')]);
  const g = cierreGaps(turn, cierre(ids.next, undefined, undefined, 'límite de reintentos → preguntada tarde'), undefined, undefined, { ids, decisions });
  assert.deepEqual(g.missing, [], 'cannot be undone: not blocked');
  assert.equal(g.steps.find((s) => s.id === 'decision').pass, false);
  assert.ok(g.findings.some((f) => /preguntada tarde/.test(f)));
  const g2 = cierreGaps(turn, cierre(ids.next, undefined, undefined, 'límite de reintentos → preguntada'), undefined, undefined, { ids, decisions });
  assert.equal(g2.steps.find((s) => s.id === 'decision').pass, true);
  assert.ok(g2.findings.some((f) => /came after the first change/.test(f)), 'a hint, recorded only');
});

test('2b: a red claim needs a test run before the code change or in a clean worktree, or "inferida"', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const turn = (before = [], after = []) => currentTurn([prompt('agrega reintentos'), say('Waymark → L2 · dept-backend · skills: code-review'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'),
    call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), ...before, call('Edit', { file_path: FILE }),
    call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), ...after, call('Skill', { skill: 'code-review' }), MEM()]);
  const red = (ev) => cierre(ids.next).replace('Evidencia: observada timeouts en el log de pedidos', `Evidencia: ${ev}`);
  const step = (g) => g.steps.find((s) => s.id === 'red');
  assert.equal(step(cierreGaps(turn(), red('observada spec en rojo y luego verde'), undefined, undefined, ctxFor(cwd))).pass, false);
  assert.equal(step(cierreGaps(turn([call('Bash', { command: 'npm test -- orders' })]), red('observada spec en rojo y luego verde'), undefined, undefined, ctxFor(cwd))).pass, true, 'run before the code change');
  assert.equal(step(cierreGaps(turn([], [call('Bash', { command: 'git worktree add -q /tmp/w HEAD && (cd /tmp/w && npm test)' })]), red('observada el test habría fallado en HEAD'), undefined, undefined, ctxFor(cwd))).pass, true, 'clean worktree');
  assert.equal(step(cierreGaps(turn(), red('inferida: el spec habría fallado (check: revertir y correr)'), undefined, undefined, ctxFor(cwd))).applies, false, 'inferida is honest');
  assert.equal(step(cierreGaps(turn(), red('observada el botón rojo en el navegador'), undefined, undefined, ctxFor(cwd))).applies, false, 'a red button is not a red test');
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

test('Cierre: Decisión must be backed', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  assert.match(checkCierre(l2(), cierre(id), undefined, undefined, ctxFor(cwd, [])), /no choice-window answer/);
  assert.match(checkCierre(l2(), cierre(id).replace(/Decisión: [^\n]*\n/, ''), undefined, undefined, ctxFor(cwd)), /Decisión: elegida/);
  const prompts = ['hazlo con backoff exponencial, nada de colas'];
  assert.equal(checkCierre(l2(), cierre(id, 'del usuario ("hazlo con backoff exponencial")'), undefined, prompts, ctxFor(cwd, [])), null);
  assert.match(checkCierre(l2(), cierre(id, 'del usuario ("usa una cola")'), undefined, prompts, ctxFor(cwd, [])), /own words/);
  assert.equal(checkCierre(l2(), cierre(id, 'única (el servicio ya expone retry())'), undefined, prompts, ctxFor(cwd, [])), null);
  assert.match(checkCierre(l2(), cierre(id, 'única'), undefined, prompts, ctxFor(cwd, [])), /única \(<why/);
});

test('Cierre: L1 needs Decisión too; older callers without ctx skip the ID check', () => {
  const turn = currentTurn([prompt('typo en el título'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx eslint src/orders.service.mjs' }), MEM()]);
  const base = '## Cierre\nResultado: hecho\nSub-decisiones: ninguna\nEvidencia: observada el typo en el título\nAprendido: "x ← y"';
  assert.match(checkCierre(turn, base), /Decisión:/);
  assert.equal(checkCierre(turn, `${base}\nDecisión: única (un solo texto que corregir)`), null);
});

test('Cierre: a turn routed Q that changed files is checked as L2 and the routing blocks (Enrutar)', () => {
  const close = '## Cierre\nResultado: hecho · Decisión: única (x y z)\nSub-decisiones: ninguna\nEvidencia: observada el modal en /chat\nAprendido: "a ← b"';
  const head = [prompt('¿se puede mover el modal?'), say('Waymark → Q · dept-frontend · skills: dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend')];
  const tail = [call('Edit', { file_path: FILE }), call('Bash', { command: 'npx eslint src' }), MEM()];
  const g = cierreGaps(currentTurn([...head, ...tail]), close);
  assert.equal(g.level, 2);
  assert.ok(g.missing.some((f) => /routed as a question/.test(f)));
  assert.ok(g.missing.some((m) => /code-review did not run/.test(m)) && g.missing.some((m) => /run the build once/.test(m)), 'L2 with code: review and build block');
  assert.equal(cierreGaps(currentTurn([...head, call('Skill', { skill: 'dept-frontend', args: 'L1' }), ...tail]), close).level, 1, 're-routed to L1 by tool call');
});

test('routing: a routing line quoted mid-sentence does not override the real one', () => {
  const texts = ['Waymark → L2 · dept-devex · skills: dept-devex', 'Evidencia: la única línea de ruta fue `Waymark → Q · dept-frontend`, ver transcript'];
  assert.equal(routedLevel(texts), 2);
  assert.equal(routedDept(texts), 'dept-devex');
  assert.equal(routedLevel([...texts, 'Waymark → L1 · dept-qa · skills: …']), 1, 'a real re-route still wins');
});

test('Cierre: Sub-decisiones listed, none taken alone, as many asked as answered', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  assert.match(checkCierre(l2(), cierre(id).replace(/Sub-decisiones: ninguna\n/, ''), undefined, undefined, ctx), /Sub-decisiones:/);
  assert.match(checkCierre(l2(), cierre(id, undefined, undefined, 'íconos en modales angostos → no preguntada'), undefined, undefined, ctx), /taken without asking/);
  assert.match(checkCierre(l2(), cierre(id, undefined, undefined, 'textos de botones → preguntada'), undefined, undefined, ctx), /claim 2 decisions asked but the choice window answered 1/);
  assert.equal(checkCierre(l2(), cierre(id, undefined, undefined, 'textos de botones → del usuario ("que diga Izquierda, Centro, Derecha")'), undefined, ['ok'], ctx), null);
  assert.match(checkCierre(l2(), cierre(id, undefined, undefined, 'íconos'), undefined, undefined, ctx), /each item ends with one marker/);
});

test('Cierre: the routing line\'s department must have been invoked; the record keeps it', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const noDept = currentTurn([prompt('x'), say('Waymark → L2 · dept-frontend · skills: ui-build'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Skill', { skill: 'code-review' })]);
  assert.ok(cierreGaps(noDept, cierre(id), undefined, undefined, ctx).missing.some((f) => /dept-frontend named in the routing line but never invoked/.test(f)));
  const gaps = cierreGaps(l2(), cierre(id), undefined, undefined, ctx);
  assert.deepEqual(provenanceRecord(l2(), gaps, ctx, {}).department, { declared: 'dept-backend', invoked: ['dept-backend'] });
});

test('observed: memory, procedure and review are computed from the tool calls, not declared', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const opened = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('mcp__engram__mem_search', { query: 'retries' }), call('Read', { file_path: path.join(os.homedir(), '.waymark', 'projects', 'shop.md') }), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Skill', { skill: 'code-review' }), MEM(), call('mcp__engram__mem_save', { topic_key: 'waymark/tasks/proj' })]);
  const g = cierreGaps(opened, cierre(id), undefined, undefined, { ...ctx, engram: true });
  assert.deepEqual(g.missing, []);
  assert.deepEqual(g.observed.memory, { searched: true, opened: true, written: true, saved: true, indexed: true });
  const noIndex = { ...opened, tools: opened.tools.filter((t) => t.name !== 'mcp__engram__mem_save') };
  assert.match(checkCierre(noIndex, cierre(id), undefined, undefined, { ...ctx, engram: true }) || '', /engram task index not saved/, '3c: the index blocks once');
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

test('blocks: an inference from docs without docs, a pre-existing failure without a clean copy (3c: blocks once)', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const has = (turn, reply, re) => cierreGaps(turn, reply, undefined, undefined, ctx).missing.some((f) => re.test(f));
  const fromDocs = cierre(id).replace('observada timeouts en el log de pedidos', 'inferida de la doc de Meta Cloud API (check: enviar una respuesta citada)');
  assert.match(checkCierre(l2(), fromDocs, undefined, undefined, ctx) || '', /inferred from docs but no docs were consulted/, 'an inference from docs blocks');
  assert.equal(checkCierre(l2([call('Skill', { skill: 'library-docs' })]), fromDocs, undefined, undefined, ctx), null);
  const pre = `${cierre(id)}\nNota: contact-center.spec.ts ya fallaba antes`;
  assert.ok(has(l2(), pre, /pre-existing/));
  assert.ok(!has(l2([call('Bash', { command: 'git worktree add ../clean HEAD && cd ../clean && npx vitest run x' })]), pre, /pre-existing/));
  assert.match(checkCierre(l2(), pre, undefined, undefined, ctx) || '', /git worktree add <tmp> HEAD/, 'the block says how to check it now');
  assert.equal(checkCierre(l2(), `${pre} (no comprobado (sin permiso para correr la suite))`, undefined, undefined, ctx), null, 'or says it was not checked');
});

test('blocks: a spec next to the changed code untouched, unless Tests: no (<why>)', () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), '.wm-spec-near-')); // outside temp so it is not exempt
  temps.push(dir);
  fs.writeFileSync(path.join(dir, 'orders.spec.ts'), '');
  const code = path.join(dir, 'orders.ts');
  const lines = (extra = []) => currentTurn([prompt('x'), say('Waymark → L1 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('Edit', { file_path: code }), ...extra, call('Bash', { command: 'npx eslint src' }), MEM()]);
  const close = '## Cierre\nResultado: hecho · Decisión: única (un solo cambio)\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a ← b"';
  const near = (turn, reply) => cierreGaps(turn, reply).missing.some((f) => /sits next to the changed code/.test(f));
  assert.ok(near(lines(), close));
  assert.ok(!near(lines(), `${close}\nTests: no (solo cambia un texto de log)`));
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

test('Sub-decisiones: a ";" inside parentheses or quotes does not split an item', () => {
  assert.deepEqual(splitTop('esquema (relación; wamid) → preguntada; estilo → del usuario ("gris; sin borde")'), ['esquema (relación; wamid) → preguntada', 'estilo → del usuario ("gris; sin borde")']);
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

test('block 3: the Aprendido must be written to the project memory', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const noMem = currentTurn([prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check x' })]);
  assert.match(checkCierre(noMem, cierre(id), undefined, undefined, ctxFor(cwd)), /Aprendido is not in the project memory/);
});

test('bugs of test 2.0-4: an empty search is not a read; the chosen option counts as the user\'s words; a commit is not a change', () => {
  assert.equal(readSomething({ name: 'Grep', out: 'No matches found' }), false);
  assert.equal(readSomething({ name: 'Grep', out: '19:### Bug fix (L1/L2)' }), true);
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const emptyGrep = currentTurn([prompt('x'), say('Waymark → L1 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), call('Edit', { file_path: FILE }), call('Bash', { command: 'npx eslint x' }), MEM()]);
  const all = [...emptyGrep.tools.slice(0, 1), { name: 'Grep', input: { pattern: '^## Bug fix', path: '/skills/dept-frontend/procedures.md' }, out: 'No matches found' }, ...emptyGrep.tools.slice(1)];
  const g = cierreGaps(emptyGrep, '## Cierre\nResultado: hecho · Decisión: única (uno)\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a"', all, undefined, ctxFor(cwd, []));
  assert.ok(g.missing.some((f) => /procedures\.md never read/.test(f)));
  assert.equal(checkCierre(l2(), cierre(id, 'del usuario ("Autollenar Puesto (Recomendado)")'), undefined, ['podemos aplicar el fix'], ctxFor(cwd, [{ question: 'q', chosen: 'Autollenar Puesto (Recomendado)', discarded: ['Quitar'] }])), null);
  assert.match(checkCierre(l2(), cierre(id, 'del usuario ("no tocar el esquema")'), undefined, ['dale'], ctxFor(cwd, [{ question: 'q', chosen: 'No', discarded: ['Sí'] }])) || '', /own words/, 'a short label does not validate any quote');
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
  const ev = evaluate(cierreGaps(l2(), cierre(id), undefined, undefined, { ...ctx, engram: true }), { total: 2700000 });
  assert.deepEqual(ev.steps, { Decision: true, Verificar: true, Cierre: true, Aprender: true, Recordar: false, Review: true, Build: true, Enrutar: true, 'Índice': false });
  assert.equal(ev.score, '7/9');
  assert.equal(ev.quotaPct, 2);
  assert.match(summaryLine(id, ev), /Recordar ✘ .* 7\/9 · 2\.70M tokens ≈ 2% de la cuota/);
  assert.match(checkCierre(l2(), cierre(id), undefined, undefined, { ...ctx, engram: true }), /no mem_search before the first change/, 'mem_search blocks at L2+ when engram is there');
});

test('turn usage: each streamed message counted once', () => {
  const u = (id, usage) => ({ type: 'assistant', message: { id, usage, content: [] } });
  const usage = { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 };
  assert.deepEqual(turnUsage([prompt('x'), u('m1', usage), u('m1', usage), u('m2', usage)]), { total: 2230, fresh: 230, input: 20, cacheWrite: 200, cacheRead: 2000, output: 10, responses: 2 });
});

test('calibration: the user\'s pairs per model drive the quota estimate (mean, then a fit of new vs cached tokens)', async () => {
  const { estimate, addPair, pairsFile } = await import(`file://${SCRIPTS}/calibrate.mjs`);
  const M = 'claude-test-model';
  assert.deepEqual(estimate({ total: 2700000 }, M, 1350000), { pct: 2, by: 'default' });
  const repo = tmpRepo('calib');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  fs.writeFileSync(path.join(repo, '.waymark', 'provenance.jsonl'), [
    { id: '2026-10-03 · T1', inputs: { model: M }, evaluation: { tokens: 7200000 } }, // an old record: total only
    { id: '2026-10-03 · T2', inputs: { model: M }, evaluation: { tokens: 3000000, usage: { input: 0, cacheWrite: 0, cacheRead: 2000000, output: 1000000 } } },
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  assert.equal(addPair('2026-10-03 · T1', 9, repo).total, 7200000);
  assert.deepEqual(estimate({ total: 1600000 }, M), { pct: 2, by: 'pairs:1' }, '800k per 1% from the pair');
  assert.deepEqual(estimate({ total: 1600000 }, 'other-model', 1350000).by, 'default', 'per model');
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

test('routine contract: the instructions block quotes every step that blocks, and the guide points to the contract', () => {
  const routine = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'routine.json'), 'utf8'));
  const block = fs.readFileSync(path.join(SCRIPTS, '..', 'templates', 'instructions.md'), 'utf8');
  for (const st of routine.steps.filter((x) => x.enforce === 'block')) assert.ok(block.includes(st.doc), `instructions.md must quote: "${st.doc}"`);
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
const l2Lines = [prompt('agrega reintentos al servicio de pedidos'), say('Waymark → L2 · dept-backend · skills: code-review'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'node --check src/orders.service.mjs && npm run build' }), call('Skill', { skill: 'code-review' }), MEM()];

test('stop hook: a backed Cierre is recorded and not blocked', () => {
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const { out, records } = runStop(l2Lines, cierre(id));
  assert.match(JSON.parse(out).systemMessage, /^Waymark .* · 7\/7 · /);
  assert.equal(records.length, 1);
  assert.equal(records[0].id, id);
  assert.deepEqual(records[0].unresolved, []);
  assert.equal(records[0].evaluation.score, '7/7');
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
const { projectHome, ensureLocal, tasksMarkdown, taskSummary, refreshTasks, readRecords, closeOpen } = await import(`file://${SCRIPTS}/provenance.mjs`);
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
const excludeOf = (repo) => fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
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

test('ensureLocal: .waymark/ excluded through .git/info/exclude once, README written', () => {
  const repo = tmpRepo('exclude');
  const h = projectHome(repo);
  ensureLocal(h); ensureLocal(h);
  assert.equal(excludeOf(repo).match(/^\.waymark\/$/gm).length, 1);
  assert.match(fs.readFileSync(path.join(repo, '.waymark', 'README.md'), 'utf8'), /tasks\.md/);
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), 'x');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout, '', 'git does not see .waymark/');
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

test('tasks.md: stays within ~3,000 characters by dropping the oldest done rows', () => {
  const repo = tmpRepo('tasks-budget');
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n'
    + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `- ▶ T (2026-10-03 · T${n}): NEXT ${'y'.repeat(400)}`).join('\n') + '\n');
  const h = projectHome(repo);
  fs.writeFileSync(h.log, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => JSON.stringify({ id: `2026-10-02 · T${n}`, cierre: `Resultado: hecho ${'z'.repeat(80)}`, prompt: 'p'.repeat(200) })).join('\n') + '\n');
  const md = tasksMarkdown(h);
  assert.equal(md.split('\n').filter((l) => l.startsWith('- 2026-10-03')).length, 9, 'every task is kept');
  assert.match(md, /## Done \(last 1, newest first\)\n[^\n]*\n[^\n]*\n\| 2026-10-02 · T8 \|/, 'oldest rows dropped first, at least one kept');
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
  assert.match(JSON.parse(r.stdout).systemMessage, /· 7\/7 · /, 'Aprendido written to <project>/.waymark/memory.md counts');
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
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: bare, encoding: 'utf8' }).stdout, '', 'git does not see .waymark/');
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
  const inputs = turnInputs(taskLines(lines, 1), '/work/none', cx.instructions);
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

test('stop hook --agent codex: the task is recorded as codex and code-review does not apply', () => {
  const { cwd, log } = fresh();
  const memFile = path.join(os.homedir(), '.waymark', 'projects', 'proj.md');
  const rows = [row('session_meta', { cli_version: '0.160.0' }), row('turn_context', { model: 'gpt-5.5' }),
    cxUser('t1', 'i1', 'agrega reintentos al servicio de pedidos'), cxSay('t1', 'Waymark → L2 · dept-backend · skills: ninguna'),
    cxCmd('t1', 'Get-Content C:/skills/dept-backend/SKILL.md'), cxCmd('t1', 'Get-Content C:/skills/dept-backend/procedures.md', 0, '### Endpoint'),
    cxAsk('call_9', [{ id: 'q', question: '¿Cómo?', options: [{ label: 'Backoff' }, { label: 'Cola' }] }]), cxAnswer('call_9', { q: { answers: ['Backoff'] } }),
    cxEdit('t1', FILE), cxCmd('t1', 'node --check src/orders.service.mjs && npm run build'), cxEdit('t1', memFile), cxTokens(2000, 1500, 1000, 500)];
  const transcript = path.join(home, `t-codex-${n}.jsonl`);
  fs.writeFileSync(transcript, rows.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const id = `${new Date().toLocaleDateString('sv')} · T1`;
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs'), '--agent', 'codex'], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'cx1', last_assistant_message: cierre(id) }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.ok(out.systemMessage && !out.decision, `not blocked: ${r.stdout}`);
  const rec = readLog(cwd).pop();
  assert.equal(rec.agent, 'codex');
  assert.equal(rec.evaluation.steps.Review, undefined, 'no code-review capability: not applicable, not ✘');
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

test('3c: "→ confirmada" passes; the branch is never counted as a sub-decision', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd), ctx = ctxFor(cwd);
  const turn = l2([call('AskUserQuestion', { questions: [] }), answered('¿Confirmo 3 reintentos?', ['Sí', 'Otra cosa'], 'Sí')]);
  const decisions = [...ctx.decisions, { question: '¿Confirmo 3 reintentos?', chosen: 'Sí', discarded: ['Otra cosa'] }];
  const g = cierreGaps(turn, cierre(ids.next, undefined, undefined, '3 reintentos → confirmada'), undefined, undefined, { ids, decisions });
  assert.deepEqual(g.missing, []);
  assert.equal(g.steps.find((s) => s.id === 'decision').pass, true);
  assert.ok(!g.findings.some((f) => /came after the first change/.test(f)), 'a confirmation is not a late decision');
  assert.equal(checkCierre(l2(), cierre(ids.next, undefined, undefined, 'rama develop → no preguntada'), undefined, undefined, ctx), null, 'the branch is the user\'s: ignored');
  assert.equal(checkCierre(l2(), cierre(ids.next, undefined, undefined, 'work on branch develop → no preguntada; textos → del usuario ("ok")'), undefined, ['ok'], ctx), null);
  assert.match(checkCierre(l2(), cierre(ids.next, undefined, undefined, 'error branch del formulario → no preguntada'), undefined, undefined, ctx) || '', /taken without asking/, 'a code branch is still a decision');
});

test('3c (T2l): no browser step — a UI change passes with no browser attempt and no offer; the contract has no Navegador', () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), '.wm-ui-')); // outside temp so it is not exempt
  temps.push(dir);
  const ui = path.join(dir, 'modal.component.html');
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const turn = (extra = []) => currentTurn([prompt('mueve el modal'), say('Waymark → L2 · dept-frontend'), call('Skill', { skill: 'dept-frontend' }), PROC('dept-frontend'), call('AskUserQuestion'), answered('¿Cómo?', ['A', 'B'], 'A'),
    call('Edit', { file_path: ui }), call('Bash', { command: 'npx ng build' }), call('Skill', { skill: 'code-review' }), MEM(), ...extra]);
  const close = (extra = '') => `## Cierre · ${ids.next}\nResultado: hecho · Decisión: elegida A · descartadas B\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a ← b"${extra}`;
  const decisions = [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }];
  const g = cierreGaps(turn(), close(), undefined, undefined, { ids, decisions });
  assert.deepEqual(g.missing, [], 'nothing about the browser blocks');
  assert.ok(!g.steps.some((s) => s.id === 'browser'), 'no browser step in the contract');
  assert.ok(!('Navegador' in evaluate(g, { total: 1 }).steps));
  const routine = JSON.parse(fs.readFileSync(path.join(SCRIPTS, '..', 'routine.json'), 'utf8'));
  assert.ok(!routine.steps.some((s) => s.id === 'browser'));
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

test('T2l Decisión: "del usuario" read across lines, and a quoted multi-select answer counts as the user\'s', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd);
  const multi = [{ question: '¿Cuáles corrijo?', chosen: '1. Marcador antes del texto, 2. Avisar media perdida, 3. width con %', discarded: ['4. Descargar'] }];
  const close = (d) => cierre(ids.next, d);
  assert.equal(checkCierre(l2(), close('del usuario ("1. Marcador antes del texto, 2. Avisar media perdida, 3. width con %")'), undefined, ['haz el commit'], { ids, decisions: multi }), null, 'the whole multi-select answer');
  const below = `## Cierre · ${ids.next}\nResultado: hecho\nDecisión: del usuario, elegida en el choice window:\n- "Backoff"\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a ← b"`;
  assert.equal(checkCierre(l2(), below, undefined, ['x'], ctxFor(cwd)), null, 'the pick on the line below');
  const emptyThenNext = `## Cierre · ${ids.next}\nResultado:\nDecisión: elegida Backoff · descartadas Cola\nSub-decisiones: ninguna\nEvidencia: observada x\nAprendido: "a"`;
  assert.match(checkCierre(l2(), emptyThenNext, undefined, undefined, ctxFor(cwd)) || '', /Resultado: hecho/, 'an empty field still never takes the next line');
});

test('T2l Sub-decisiones: " · " separates items with several "→"; "→ única (<why>)" is a one-way technical step and passes', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const sub = 'setNodeAttribute en lugar de setNodeMarkup → única (corrige el bug: el panel se cerraba) · untracked en syncImagePanel → única (corta el bucle infinito) · textos → del usuario ("ok")';
  assert.equal(checkCierre(l2(), cierre(id, undefined, undefined, sub), undefined, ['ok'], ctx), null);
  const g = cierreGaps(l2(), cierre(id, undefined, undefined, 'a → preguntada · b → no preguntada'), undefined, undefined, ctx);
  assert.ok(g.missing.some((m) => /taken without asking \(b → no preguntada\)/.test(m)), 'only the item taken alone is named');
  assert.match(checkCierre(l2(), cierre(id, undefined, undefined, 'x → única'), undefined, undefined, ctx) || '', /each item ends with one marker/, 'única needs its reason');
});

test('T2l Aprender: memory.md written by any tool counts when it changed in the turn and holds the task ID', () => {
  const dir = fs.mkdtempSync(path.join(home, 'mem-')), mem = path.join(dir, 'memory.md');
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const noEdit = currentTurn([prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: `node "$TEMP/mem.js"` }), call('Bash', { command: 'npm run build' }), call('Skill', { skill: 'code-review' })]);
  fs.writeFileSync(mem, `## Work in progress\n- [${id}] backoff ← timeouts\n`);
  const ctx = { ...ctxFor(cwd), memoryFile: mem };
  assert.equal(cierreGaps(noEdit, cierre(id), undefined, undefined, ctx).observed.memory.written, true, 'written by a script through the shell');
  fs.writeFileSync(mem, '## Work in progress\n- [otra tarea] x\n');
  assert.match(checkCierre(noEdit, cierre(id), undefined, undefined, ctx) || '', /Aprendido is not in the project memory/, 'without the task ID it was not this task');
});

test('T2l outside the project: a turn with a Cierre and no project change is still recorded (install, cleanup)', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const turn = currentTurn([prompt('instala aquí'), say('Waymark → L2 · dept-devops'), call('Skill', { skill: 'dept-devops' }), PROC('dept-devops'), call('AskUserQuestion'), answered('¿Cómo?', ['Push + instalar', 'Solo instalar'], 'Push + instalar'), call('Bash', { command: 'cp a ~/.claude/skills/x' }), MEM()]);
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

test('T2l secrets: the record keeps picked labels only, never a free-text answer; passwords and tokens masked in text', () => {
  const lines = [prompt('x'), answered('¿Usuario de prueba?', ['Crear uno', 'Sin login'], 'te paso uno: ana@example.com y la contraseña es S3cr3t-Pass!')];
  const raw = decisionsIn(lines);
  assert.match(raw[0].chosen, /S3cr3t/, 'the hook still sees the answer live');
  const kept = recordedDecisions(raw);
  assert.ok(!/S3cr3t|ana@/.test(JSON.stringify(kept)), 'never in the record');
  assert.match(kept[0].chosen, /^\(respuesta escrita, \d+ caracteres\)$/);
  assert.equal(recordedDecisions(decisionsIn([prompt('x'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff')]))[0].chosen, 'Backoff');
  assert.equal(recordedDecisions(decisionsIn([prompt('x'), answered('¿Cuáles?', ['A', 'B', 'C'], 'A,mi texto')]))[0].chosen, 'A, (respuesta escrita, 8 caracteres)');
  for (const [s, leak] of [['la contraseña es S3cr3t-Pass!', 'S3cr3t'], ['password: hunter22', 'hunter22'], ['curl -u admin:pw123 https://x', 'pw123'], ['https://bob:pw456@host/x', 'pw456'], ['token=abc.def.ghi', 'abc.def'], ['Authorization: Bearer eyJhbGci', 'eyJhb']]) assert.ok(!maskSecrets(s).includes(leak), s);
  assert.equal(maskSecrets('npm run build'), 'npm run build');
});

test('T2l Review: a follow-up that applies the review findings passes with the code-review run earlier in the task', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next;
  const noReview = currentTurn([prompt('corrige los hallazgos'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Bash', { command: 'npm run build' }), MEM()]);
  assert.match(checkCierre(noReview, cierre(id), undefined, undefined, ctxFor(cwd)) || '', /code-review did not run/);
  assert.equal(checkCierre(noReview, cierre(id), undefined, undefined, { ...ctxFor(cwd), taskTools: [{ name: 'Skill', input: { skill: 'code-review' } }] }), null);
});

test('T2l turn start: a prompt after the last close starts the turn even when the next line has no timestamp', () => {
  const p = { ...prompt('nueva tarea'), timestamp: new Date(Date.UTC(2026, 9, 4, 5, 0)).toISOString() };
  const lines = [p, call('Edit', { file_path: FILE }), { ...say('hecho'), timestamp: new Date(Date.UTC(2026, 9, 4, 5, 1)).toISOString() }];
  assert.deepEqual(currentTurn(lines, Date.UTC(2026, 9, 4, 4, 0)).tools.map((t) => t.name), ['Edit'], 'the untimestamped tool call stays in the turn');
});

test('T2m: the block names the honest ways out; the choice window waiting for the user is userWait, not the agent\'s minutes', () => {
  const { cwd } = fresh();
  const id = taskIds(cwd).next, ctx = ctxFor(cwd);
  const msg = checkCierre(l2(), cierre(id, undefined, undefined, 'aviso en la esquina → no preguntada'), undefined, undefined, ctx) || '';
  assert.match(msg, /choice window → preguntada; only one real way \(a technical limit, or the fix of a bug you found\) → única \(<why>\) — never a user rule you cannot cite; named but not applied, left for the user → propuesta \(<what>\); otherwise ask it now/);
  assert.match(checkCierre(l2(), cierre(id, undefined, undefined, 'alcance → del usuario'), undefined, undefined, ctx) || '', /e\.g\. "texto del botón → preguntada; panel en la esquina → única/);
  const at = (min) => new Date(Date.UTC(2026, 9, 4, 6, min)).toISOString();
  const lines = [{ ...prompt('x'), timestamp: new Date(Date.now() - 62 * 60000).toISOString() }, say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'),
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
  const lines = [prompt('agrega reintentos al servicio de pedidos'), say('Waymark → L2 · dept-backend · skills: code-review'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'),
    call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), call('Edit', { file_path: FILE }), call('Skill', { skill: 'code-review' }),
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_bg2', content: 'Running in the background' }] }, toolUseResult: { background: true } }, say('Espero el code-review.')];
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: `bg-${n}`, last_assistant_message: 'Espero el code-review.' }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '', 'silent: not blocked');
  assert.ok(!fs.existsSync(log) || !readLog(cwd).length, 'nothing recorded yet');
});

test('T2o: a quote of the user\'s fragments joined with "…", "Docker" is not docs, "→ propuesta", memory commands are not gates', () => {
  const { cwd } = fresh();
  const ids = taskIds(cwd), ctx = ctxFor(cwd);
  const said = ['pero man podes usar las credenciales del env y hacer la migracion no es necesario esto y otra cosa te doy permiso'];
  assert.equal(checkCierre(l2(), cierre(ids.next, 'del usuario ("no es necesario esto … te doy permiso")'), undefined, said, ctx), null);
  assert.match(checkCierre(l2(), cierre(ids.next, 'del usuario ("no es necesario esto … borra la base")'), undefined, said, ctx) || '', /own words/, 'every fragment must be theirs');
  const docker = cierre(ids.next).replace('observada timeouts en el log de pedidos', 'observada Docker falla con dockerDesktopLinuxEngine; inferida que falta la columna (check: GET da 200)');
  assert.ok(!cierreGaps(l2(), docker, undefined, undefined, ctx).steps.find((s) => s.id === 'docs').applies, '"Docker" is not docs');
  assert.equal(checkCierre(l2(), cierre(ids.next, undefined, undefined, 'pipeline de deploy → propuesta (que corra las migraciones)'), undefined, undefined, ctx), null);
  const memGate = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
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
  const chained = currentTurn([prompt('x'), say('Waymark → L2 · dept-backend'), call('Skill', { skill: 'dept-backend' }), PROC('dept-backend'), call('AskUserQuestion'), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    call('Edit', { file_path: FILE }), call('Bash', { command: 'npx tsc --noEmit && npm run build && grep -n T1 .waymark/memory.md' }), call('Skill', { skill: 'code-review' }), MEM()]);
  assert.equal(checkCierre(chained, cierre(id), undefined, undefined, ctxFor(cwd)), null);
});
