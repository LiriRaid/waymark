// Waymark 2.0.19 · point 3: testigos that tell the truth, and hooks that do not fail open. Every case is a synthetic copy of a pattern
// (a transcript, a command, a repository); each fix has a logic case (.mjs), a CSS/HTML case (.css edit with a gate) and the counter-example
// that must keep failing. Run: node --test tests/truth.test.mjs
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-truth-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps, failingPart, keepCmd, unevaluatedRecord } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { shellRuns } = await import(`file://${SCRIPTS}/runs.mjs`);
const { commandSensitive } = await import(`file://${SCRIPTS}/lib/guard.mjs`);
const { gate: toolGate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { rowProblem } = await import(`file://${SCRIPTS}/stack.mjs`);
const { learnGates } = await import(`file://${SCRIPTS}/learn.mjs`);
const { gateCommand } = await import(`file://${SCRIPTS}/testigos.mjs`);
const W = await import(`file://${SCRIPTS}/waymark.mjs`);

const FILE = '/work/proj/src/orders.service.mjs', CSS = '/work/proj/src/app.css';
let n = 0, ids = 0;
const fresh = () => `/work/truth-${++n}`;
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const run = (name, input, { error = false, out = 'ok' } = {}) => {
  const id = `u${++ids}`;
  return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }];
};
const sh = (command, opts) => run('Bash', { command }, opts);
const answered = (question, labels, chosen) => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } });
const opening = (level = 2) => [prompt('agrega reintentos al servicio de pedidos'), say(`Waymark → L${level} · dept-backend · skills: code-review`), ...run('Skill', { skill: 'dept-backend' }), ...run('Read', { file_path: '/skills/dept-backend/procedures.md' }),
  ...sh('node "/s/waymark/scripts/waymark.mjs" pack src/orders.service.mjs'), ...run('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff')];
const edit = (file = FILE) => run('Edit', { file_path: file });
const cierre = (id) => `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada timeouts en el log de pedidos\nAprendido: backoff ← timeouts`;
const judge = (lines, more = {}, cwd = fresh()) => cierreGaps(currentTurn(lines), cierre(P.taskIds(cwd).next), undefined, undefined, { ids: P.taskIds(cwd), decisions: [{ question: '¿Cómo?', chosen: 'Backoff', discarded: ['Cola'] }], ...more });
const step = (g, id) => g.steps.find((s) => s.id === id);
const repos = { '/work/proj': '/work/proj', '/work/proj/src': '/work/proj', '/work/api': '/work/api' };
const inRepo = { cwd: '/work/proj', repoOf: (d) => repos[String(d).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')] || null };
const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = (files = {}) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-truth-')); temps.push(d); gitT(d, 'init', '-q');
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  return d;
};
const kinds = (c) => shellRuns(c).filter((p) => p.gate || p.test || p.build).map((p) => `${p.gate ? 'g' : ''}${p.build ? 'b' : ''}${p.test ? 't' : ''}`);

// ---- 3a · builds and tests are recognised ----
test('3a: a wrapper (timeout, nice, nohup, stdbuf) and the framework CLIs are read as the command they run; `timeout 5 sleep 1` is nothing', () => {
  assert.deepEqual(kinds('timeout 600 pnpm run build'), ['gb']);
  assert.deepEqual(kinds('timeout -k 5 30s npx vitest run src/a.spec.ts'), ['t']);
  assert.deepEqual(kinds('nice -n 10 pnpm test'), ['t']);
  assert.deepEqual(kinds('nohup npx nest build'), ['gb']);
  assert.deepEqual(kinds('stdbuf -oL ng build'), ['gb']);
  for (const c of ['npx nest build', 'pnpm exec nest build', 'react-scripts build', 'turbo run build --filter=web', 'nx run app:build', 'nx run-many -t build']) assert.deepEqual(kinds(c), ['gb'], c);
  assert.deepEqual(kinds('react-scripts test --watchAll=false'), ['t']);
  assert.deepEqual(kinds('vue-cli-service lint'), ['g']);
  assert.deepEqual(kinds('nx affected --target=test'), ['t']);
  assert.deepEqual(kinds('timeout 5 sleep 1'), [], 'a wrapper around a command that is no gate stays no gate');
  assert.deepEqual(kinds('command -v tsc'), [], 'a lookup runs nothing');
});

test('3a: logic — the API built with `timeout … nest build` after its last change passes the build testigo; CSS/HTML — the same through the front end\'s `nx` build', () => {
  const lines = (build, file) => [...opening(2), ...edit(file), ...sh('node --check src/orders.service.mjs'), ...run('Skill', { skill: 'code-review' }), ...sh(build)];
  assert.equal(step(judge(lines('timeout 900 npx nest build', FILE), inRepo), 'build').pass, true);
  assert.equal(step(judge(lines('nx run app:build', CSS), inRepo), 'build').pass, true);
  // counter-example: the API changed and only another repo built (the real pattern that must keep failing)
  assert.equal(step(judge(lines('cd ../api && timeout 900 npx nest build', FILE), inRepo), 'build').pass, false);
  assert.equal(step(judge(lines('timeout 5 sleep 1', FILE), inRepo), 'build').pass, false, 'sleeping is no build');
});

// ---- 3b · a command is never cut and then learned ----
test('3b: a gate keeps its whole command; only one over 2000 characters is cut, and marked', () => {
  const long = `node --check src/orders.service.mjs && node --test ${'tests/a-very-long-name-'.repeat(8)}.test.mjs`;
  assert.ok(long.length > 140);
  assert.deepEqual(keepCmd(long), { cmd: long });
  const huge = keepCmd('x '.repeat(1500));
  assert.equal(huge.cut, true);
  assert.equal(huge.cmd.length, 2000);
  const g = judge([...opening(2), ...edit(), ...sh(long)], inRepo);
  assert.equal(g.observed.gates[0].cmd, long, 'the record holds the command the hook re-runs, not 140 characters of it');
});

test('3b: logic — a cut or file-specific command is never learned into Quality gates; CSS/HTML — the same for a styles-only run', () => {
  const memory = '# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | | |\n| lint (changed files) | | |\n| test (full) | | |\n| build | | |\n';
  const rec = (cmd, more = {}) => ({ evaluation: { steps: { Verificar: true } }, observed: { gates: [{ cmd, ...more }] } });
  assert.match(learnGates(memory, rec('pnpm run test:ci'), '2026-10-24'), /\| test \(full\) \| `pnpm run test:ci` \| 2026-10-24 \|/, 'a general command is learned');
  assert.equal(learnGates(memory, rec('pnpm exec tsc --noEmit -p ts', { cut: true }), '2026-10-24'), memory, 'a command the record cut');
  assert.equal(learnGates(memory, rec('pnpm exec vitest run s'), '2026-10-24'), memory, 'a test runner\'s filter names a run, not a gate');
  assert.equal(learnGates(memory, rec('pnpm exec stylelint src/app.css'), '2026-10-24'), memory, 'a styles gate for one file');
  assert.match(learnGates(memory, rec('pnpm exec vitest run'), '2026-10-24'), /vitest run/, 'counter-example: the whole run is a gate');
});

test('3b: a Quality gates row that cannot be right is told apart from one that can, and the hook falls back to the repo\'s own script', () => {
  const root = tmpRepo({ 'tsconfig.json': '{}', 'tsconfig.app.json': '{}', 'package.json': JSON.stringify({ scripts: { 'test:ci': 'x', typecheck: 'tsc --noEmit' } }), 'src/a.spec.ts': '' });
  assert.match(rowProblem('tsc -p ts', root), /does not exist/);
  assert.match(rowProblem('pnpm exec vitest run s', root), /names no file or folder/);
  assert.match(rowProblem('pnpm run nope', root), /not in package\.json/);
  for (const ok of ['tsc -p tsconfig.app.json', 'pnpm run test:ci', 'pnpm exec vitest run src/a.spec.ts', 'pnpm exec vitest run', 'pytest -k smoke', 'none (no build step)', 'node --check <file>', 'pnpm exec vitest run "src/**/*.spec.ts"']) assert.equal(rowProblem(ok, root), '', ok);
  const memory = path.join(root, 'memory.md');
  fs.writeFileSync(memory, '# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | `tsc -p ts` | 2026-10-20 |\n');
  assert.equal(gateCommand(root, memory).from, 'package.json', 'the broken row is read as empty: the typecheck script wins');
  fs.writeFileSync(memory, '# P\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | `tsc -p tsconfig.app.json` | 2026-10-20 |\n');
  assert.equal(gateCommand(root, memory).from, 'memory.md', 'counter-example: a good row still decides');
});

test('3b: check lists the broken rows and `gates --apply` empties them, leaving the good ones', () => {
  const root = tmpRepo({ 'tsconfig.app.json': '{}', 'package.json': '{"scripts":{}}' });
  fs.mkdirSync(path.join(root, '.waymark'));
  const memory = path.join(root, '.waymark', 'memory.md');
  fs.writeFileSync(memory, '# P\n\n## Work in progress\n\n## Quality gates (verified commands)\n| Gate | Command | Verified |\n|---|---|---|\n| typecheck | `tsc -p ts` | 2026-10-20 |\n| lint (changed files) | `eslint {files}` | 2026-10-20 |\n| test (full) | `vitest run s` | 2026-10-20 |\n');
  assert.match(W.gatesLine(root), /^gates: 2 Quality gates rows in memory\.md cannot be right \(typecheck: `tsc -p ts`.*test \(full\): `vitest run s`/);
  assert.equal(W.repairGates(root).applied, false, 'the plan writes nothing');
  assert.equal(W.repairGates(root, { apply: true }).applied, true);
  const text = fs.readFileSync(memory, 'utf8');
  assert.match(text, /\| typecheck \| \| \|/);
  assert.match(text, /\| lint \(changed files\) \| `eslint \{files\}` \| 2026-10-20 \|/);
  assert.equal(W.gatesLine(root), '', 'nothing left to repair');
});

// ---- 3c · the guard does not crash ----
test('3c: logic — brackets in a command are text, not a character class: the guard neither throws nor lets a real secret through', () => {
  const dir = tmpRepo({ '.env': 'K=1', 'L1.ts': '', 'a.html': '' });
  const cfg = { sensitive: ['.env'], allow: [] };
  for (const c of ['cat L[i-1].ts', "echo ['br-1']", 'cat a[z-a].html', 'sed -n 1p x[b-a]']) assert.doesNotThrow(() => commandSensitive(c, dir, cfg), c);
  assert.equal(commandSensitive('cat L[i-1].ts', dir, cfg), null);
  assert.match(String(commandSensitive('cat L[i-1].ts .env', dir, cfg)), /\.env$/, 'a bracket beside a sensitive file does not hide it');
  assert.match(String(commandSensitive('cat .en[v]', dir, cfg)), /\.env$/, 'counter-example: a valid class still reaches the file it names');
});

test('3c: CSS/HTML — a bracket in a stylesheet command is no crash either', () => {
  const dir = tmpRepo({ 'app.css': 'a {}', 'page.html': '' });
  assert.equal(commandSensitive('grep -n "a[href]" app.css page.html', dir, { sensitive: ['.env'], allow: [] }), null);
  assert.doesNotThrow(() => commandSensitive('sed -i s/x/y/ page[2-1].html', dir, { sensitive: ['.env'], allow: [] }));
});

test('3c: a guard that cannot judge a call denies it instead of letting it through', () => {
  const agent = { call: () => ({ command: { toString() { throw new Error('boom in the guard'); } } }), note: () => '' };
  const deny = toolGate({ cwd: os.tmpdir(), session_id: 's-guard' }, agent);
  assert.match(String(deny), /sensitive-path guard could not read this call.*boom in the guard.*not run/);
  const quiet = toolGate({ cwd: os.tmpdir(), session_id: 's-guard' }, { call: () => ({ command: 'ls' }), note: () => '' });
  assert.ok(!/guard could not read/.test(String(quiet)), 'counter-example: an ordinary command is not denied by the guard');
});

test('3c: a turn the end-of-turn hook cannot judge leaves an unevaluated record that is no task', () => {
  const repo = tmpRepo();
  fs.mkdirSync(path.join(repo, '.waymark'));
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  const rec = unevaluatedRecord(new Error('Invalid regular expression: /[i-1]/'), { agent: 'claude', session: 's1', cwd: repo });
  assert.equal(rec.kind, 'unevaluated');
  assert.match(rec.cause, /^unevaluated:Invalid regular expression/);
  P.appendRecord(repo, rec);
  const h = P.projectHome(repo);
  assert.equal(P.readRecords(h.log).filter((r) => r.kind === 'unevaluated').length, 1);
  assert.equal(P.readTaskRecords(h).filter((r) => r.id).length, 0, 'it is no task: no ID, nothing in the task list');
});

// ---- 3d · failures are recognised and attributed ----
const VITEST_RED = ' FAIL  src/a.spec.ts > retries > waits\nAssertionError: expected 1 to be 2\n\n Test Files  1 failed (1)\n      Tests  2 failed | 10 passed (12)\n';
test('3d: logic — vitest\'s own summary behind a pipe fails the gate; a log line saying "fail to connect" does not', () => {
  const lines = (out) => [...opening(2), ...edit(), ...sh('pnpm exec vitest run src/a.spec.ts | tail -20', { out })];
  assert.equal(step(judge(lines(VITEST_RED), inRepo), 'gate').pass, false);
  assert.equal(step(judge(lines('      Tests  2 failed | 10 passed (12)'), inRepo), 'gate').pass, false, 'the summary line alone, filtered by tail');
  assert.equal(step(judge(lines(' FAIL  src/a.spec.ts > retries > waits'), inRepo), 'gate').pass, false, 'the failure header alone');
  assert.equal(step(judge(lines(' ✓ retries > waits\n × retries > gives up'), inRepo), 'gate').pass, false, 'a failed case alone');
  assert.equal(step(judge(lines('      Tests  12 passed (12)\nfail to reach the registry, using the cache'), inRepo), 'gate').pass, true, 'counter-example');
});

test('3d: CSS/HTML — the same summary after a stylesheet edit fails it, and a green one passes', () => {
  const lines = (out) => [...opening(2), ...edit(CSS), ...sh('pnpm exec vitest run | tail -5', { out })];
  assert.equal(step(judge(lines('      Tests  3 failed | 4 passed (7)'), inRepo), 'gate').pass, false);
  assert.equal(step(judge(lines('      Tests  7 passed (7)'), inRepo), 'gate').pass, true);
});

test('3d: the part that failed is named, never the whole chained line', () => {
  assert.equal(failingPart('prisma status | tail -3; eslint x.ts | tail -5', '✖ 1 problem (1 error, 0 warnings)'), 'eslint x.ts');
  assert.equal(failingPart('tsc --noEmit; eslint x.ts', "src/a.ts(3,1): error TS2322: Type 'string'"), 'tsc --noEmit');
  assert.equal(failingPart('pnpm exec vitest run | tail', VITEST_RED), 'pnpm exec vitest run');
  assert.equal(failingPart('tsc --noEmit; eslint x.ts', 'everything passed'), null, 'counter-example: nothing printed, nothing blamed');
  const g = judge([...opening(2), ...edit(), ...sh('prisma migrate status | tail -3; pnpm exec eslint src/orders.service.mjs | tail -5', { out: '✖ 1 problem (1 error, 0 warnings)' })], inRepo);
  const said = g.missing.find((m) => /gate after the last code change failed/.test(m)) || '';
  assert.match(said, /failed \(pnpm exec eslint src\/orders\.service\.mjs\)/);
  assert.ok(!/prisma/.test(said), said);
});

// ---- a hook reads its whole input, however late it comes ----
import { spawn } from 'node:child_process';
const hookRun = (script, payload, { delay = 0, wait = 15000, env = {} } = {}) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env, WAYMARK_HOME: home, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, wait);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  if (payload === null) return; // nothing is ever written: a hook run by hand
  setTimeout(() => { c.stdin.end(JSON.stringify(payload)); }, delay);
});
test('stdin: logic — a call that reaches the hook after its old one-second fallback is still judged (a busy machine failed open here)', async () => {
  const dir = tmpRepo({ '.env': 'K=1' });
  const r = await hookRun('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat .env' }, cwd: dir, session_id: 's-late' }, { delay: 1800 });
  assert.match(r.out, /sensitive path/, 'the guard denied it although the input came 1.8 s after the hook started');
});
test('stdin: CSS/HTML — a late call that edits a stylesheet is judged too and passes', async () => {
  const dir = tmpRepo({ 'app.css': 'a {}' });
  const r = await hookRun('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.css') }, cwd: dir, session_id: 's-late-css' }, { delay: 1800 });
  assert.ok(!/sensitive path/.test(r.out) && !r.killed, 'no denial of a stylesheet, and the hook ended');
});
test('stdin: counter-example — a hook whose stdin never closes ends by itself at its limit, it does not hang', async () => {
  const t = Date.now(), r = await hookRun('tool-hook.mjs', null, { wait: 9000, env: { WAYMARK_STDIN_MS: '1500' } });
  assert.equal(r.killed, false, 'it gave up at its limit');
  assert.ok(Date.now() - t >= 1400, 'and not before it');
});
test('stdin: an agent that writes the whole call and leaves stdin open is not waited for', async () => {
  const dir = tmpRepo({ '.env': 'K=1' });
  const t = Date.now();
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(SCRIPTS, 'tool-hook.mjs')], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, 7000);
    c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
    c.stdin.write(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat .env' }, cwd: dir, session_id: 's-open' })); // never closed
  });
  assert.match(r.out, /sensitive path/);
  assert.equal(r.killed, false, 'the hook ended on its own once the object was complete');
  assert.ok(Date.now() - t < 6000);
});
