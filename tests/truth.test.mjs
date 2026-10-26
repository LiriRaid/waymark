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

// ---- 3e · a change and the check after it, in one command, count in order ----
const { splitAtChange, changesProject, scriptWrites } = await import(`file://${SCRIPTS}/runs.mjs`);
const { commandFiles } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const PY = (file) => `python - <<'EOF'\nfrom pathlib import Path\nPath('${file}').write_text('retry = 3')\nEOF\n`;
test('3e: logic — a script that rewrites a file and builds in the same command: the build counts as after the change', () => {
  const lines = (command) => [...opening(2), ...sh(command), ...run('Skill', { skill: 'code-review' })];
  const more = { ...inRepo, gitChanged: [FILE] };
  const g = judge(lines(`${PY('src/orders.service.mjs')}pnpm exec tsc --noEmit && pnpm run build`), more);
  assert.equal(step(g, 'build').pass, true, 'the build ran after the write');
  assert.equal(g.observed.gates.length, 1, 'the check after the change is a gate of the task');
  // counter-example: the build came first and the write after it
  const before = judge(lines(`pnpm run build && sed -i s/a/b/ src/orders.service.mjs`), more);
  assert.equal(step(before, 'build').pass, false, 'a build before the change proves nothing');
});

test('3e: CSS/HTML — `sed -i` on a stylesheet followed by the build in one command counts the same', () => {
  const more = { ...inRepo, gitChanged: [CSS] };
  const ok = judge([...opening(2), ...sh("sed -i 's/28px/40px/' src/app.css && pnpm run build"), ...run('Skill', { skill: 'code-review' })], more);
  assert.equal(step(ok, 'build').pass, true);
  assert.equal(step(judge([...opening(2), ...sh("pnpm run build; sed -i 's/28px/40px/' src/app.css"), ...run('Skill', { skill: 'code-review' })], more), 'build').pass, false, 'counter-example');
});

test('3e: sed -i, perl -pi and a script that writes are changes for the pack and the decision gate; a script that only prints, or writes to temp, is not', () => {
  assert.ok(changesProject("sed -i 's/a/b/' src/a.ts"));
  assert.ok(changesProject("perl -pi -e 's/a/b/' src/a.ts"));
  assert.ok(changesProject(PY('src/a.ts')));
  assert.ok(changesProject(`node -e "require('fs').writeFileSync('src/a.js','x')"`));
  assert.ok(!changesProject("perl -ne 'print' src/a.ts"), 'reading with perl');
  assert.ok(!changesProject(`node -e "console.log(1)"`));
  assert.ok(!scriptWrites(`node -e "require('fs').writeFileSync('/tmp/x.js','x')"`), 'a temp file');
  const repo = tmpRepo({ 'src/a.ts': 'x' });
  assert.deepEqual(commandFiles(PY('src/a.ts'), repo).map((f) => path.relative(repo, f).replace(/\\/g, '/')), ['src/a.ts'], 'the pack is handed for the file the script writes');
  assert.equal(splitAtChange('pnpm exec tsc --noEmit'), null);
  assert.equal(splitAtChange('sed -i s/a/b/ src/a.ts'), null, 'a change with no check after it is one event');
});

// ---- 3f · reds clear properly ----
const RED = ' FAIL  src/a.spec.ts > waits\nAssertionError: expected 1 to be 2';
const redAfterEdit = (file, runs) => judge([...opening(2), ...edit(file), ...sh('node --check src/orders.service.mjs'), ...runs], inRepo).observed.tests.failed;
test('3f: logic — a folder run that passes clears the red of one spec run filtered by name', () => {
  const failed = (...tail) => redAfterEdit(FILE, [...sh('pnpm exec vitest run src/a.spec.ts -t "waits"', { error: true, out: RED }), ...tail]);
  assert.deepEqual(failed(...sh('pnpm exec vitest run src')), [], 'the folder covers the spec');
  assert.deepEqual(failed(...sh('pnpm exec vitest run')), [], 'the whole suite covers it too');
  assert.equal(failed().length, 1, 'counter-example: nothing ran after it');
  assert.equal(failed(...sh('pnpm exec vitest run tests/other.spec.ts')).length, 1, 'counter-example: a green run of other files covers nothing');
  assert.equal(failed(...sh('pnpm exec vitest run src', { error: true, out: RED })).length, 2, 'counter-example: the folder run is red too');
});
test('3f: CSS/HTML — the same after a stylesheet edit; a load timeout is a flake the same green run clears', () => {
  const failed = (out, ...tail) => redAfterEdit(CSS, [...sh('pnpm exec vitest run src/app.spec.ts', { error: true, out }), ...tail]);
  assert.deepEqual(failed(RED, ...sh('pnpm exec vitest run src')), []);
  const TIMEOUT = ' FAIL  src/app.spec.ts\nError: Hook timed out in 10000ms.';
  assert.deepEqual(failed(TIMEOUT, ...sh('pnpm exec vitest run src/app.spec.ts')), [], 'the same file, green: the timeout was the load');
  assert.equal(failed(TIMEOUT).length, 1, 'counter-example: without that green run it stays red');
});

// ---- 3g · red-first only where there is new behavior ----
const caseText = (n) => Array.from({ length: n }, (_, i) => `it('case ${i}', () => {});`).join('\n');
const specEdit = (file, oldCases, newCases) => run('Edit', { file_path: file, old_string: caseText(oldCases), new_string: caseText(newCases) });
const SPEC_A = '/work/proj/src/a.spec.mjs', SPEC_B = '/work/proj/src/b.spec.mjs';
test('3g: logic — a spec that only moved its cases, a barrel and a red from an unresolved import ask for no clean copy', () => {
  const red = (lines, more = {}) => judge([...opening(2), ...lines], { ...inRepo, ...more }).observed.tests.red;
  assert.equal(red([...specEdit(SPEC_A, 2, 0), ...specEdit(SPEC_B, 0, 2)]), true, 'cases left one spec and entered another');
  assert.equal(red([...specEdit(SPEC_B, 0, 2)]), false, 'counter-example: new cases and no run before the code');
  const barrel = run('Write', { file_path: '/work/proj/src/index.mjs', content: "export * from './orders.service.mjs';\n" });
  assert.equal(red([...barrel, ...specEdit(SPEC_B, 0, 1), ...sh('node --test src/b.spec.mjs')]), true, 'a barrel before the spec is no behavior');
  assert.equal(red([...edit(), ...specEdit(SPEC_B, 0, 1), ...sh('node --test src/b.spec.mjs')]), false, 'counter-example: real code first, then a green run');
  assert.equal(red([...edit(), ...specEdit(SPEC_B, 0, 1), ...sh('node --test src/b.spec.mjs | tail -5', { out: 'Error: Failed to resolve import "./orders.service.mjs"' })]), true, 'its import does not resolve: that is a red');
  const earlier = { taskTools: [{ name: 'Edit', id: 'earlier-1', input: { file_path: SPEC_B, new_string: caseText(1) } }] };
  assert.equal(red([...edit(), ...specEdit(SPEC_B, 0, 1), ...sh('node --test src/b.spec.mjs')], earlier), true, 'a spec an earlier turn of the task already changed');
});
test('3g: logic — a spec that only moved (git mv, mv, Move-Item), with no write, asks for no red; a spec moved and given new cases still does', () => {
  const red = (lines, gitChanged) => judge([...opening(2), ...lines], { ...inRepo, gitChanged }).observed.tests.red;
  for (const mv of ['git mv src/a.spec.mjs src/b.spec.mjs', 'mv src/a.spec.mjs src/b.spec.mjs', 'Move-Item src/a.spec.mjs src/b.spec.mjs']) {
    assert.equal(red([...edit(), ...sh(mv)], [FILE, SPEC_B]), true, mv);
  }
  assert.equal(red([...edit(), ...sh('git mv src/a.spec.mjs src/b.spec.mjs'), ...specEdit(SPEC_B, 0, 2)], [FILE, SPEC_B]), false, 'counter-example: moved, then new cases');
  assert.equal(red([...edit()], [FILE, SPEC_B]), false, 'counter-example: a spec changed by a command that is no move');
});
test('3g: a runner that cannot start in the copy is the environment, not a red; an import of the code that does not resolve still is', () => {
  const failedRun = (out) => judge([...opening(2), ...edit(), ...specEdit(SPEC_B, 0, 1), ...sh('pnpm exec vitest run src/b.spec.mjs', { error: true, out })], inRepo);
  for (const out of ["Error: Cannot find module 'vitest/config'", "Error: Cannot find module 'C:/copy/node_modules/jest/bin/jest.js'", "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'mocha' imported from x"]) {
    assert.equal(failedRun(out).observed.tests.red, false, `${out}: no red`);
  }
  assert.equal(failedRun("Error: Cannot find module '../src/orders.service.mjs'").observed.tests.red, true, 'counter-example: the code under test does not resolve: a red');
});
test('3f: logic — a red run before the code it tests is the intended red, never "failed after the last change"; CSS/HTML — a red of the template spec before the template', () => {
  const RED_B = ' FAIL  src/b.spec.mjs > retries\nAssertionError: expected 1 to be 3';
  const g = judge([...opening(2), ...specEdit(SPEC_B, 0, 1), ...sh('pnpm exec vitest run src/b.spec.mjs', { error: true, out: RED_B }), ...edit(), ...sh('pnpm exec vitest run src/b.spec.mjs')], inRepo);
  assert.deepEqual([g.observed.tests.red, g.observed.tests.failed], [true, []]);
  const tpl = judge([...opening(2), ...specEdit('/work/proj/src/app.spec.ts', 0, 1), ...sh('pnpm exec vitest run src/app.spec.ts', { error: true, out: ' FAIL  src/app.spec.ts > renders' }), ...run('Edit', { file_path: '/work/proj/src/app.html', new_string: '<a (click)="go()">x</a>' }), ...sh('pnpm exec vitest run src/app.spec.ts')], inRepo);
  assert.deepEqual(tpl.observed.tests.failed, []);
  const after = judge([...opening(2), ...specEdit(SPEC_B, 0, 1), ...edit(), ...sh('pnpm exec vitest run src/b.spec.mjs', { error: true, out: RED_B })], inRepo);
  assert.equal(after.observed.tests.failed.length, 1, 'counter-example: the red after the code is a real failure');
});
test('3d: a line marked ✗ is a failure line, as FAIL and × are; prose is not', () => {
  // read from the output when a filter hides the exit code, as `| tail` does
  const failed = (out) => judge([...opening(2), ...edit(), ...sh('npx mocha src/a.spec.mjs | tail -20', { out })], inRepo).observed.tests.failed.length;
  assert.equal(failed('  ✗ retries three times\n  1 test failed'), 1);
  assert.equal(failed('  ✔ retries three times'), 0, 'counter-example: a pass mark');
});
test('3a: a command that is the body of the package\'s build script is the build; another node script is not', () => {
  const root = tmpRepo({ 'package.json': JSON.stringify({ scripts: { build: 'node scripts/build.mjs --prod' } }) });
  const lines = (cmd, file) => [...opening(2), ...edit(file), ...sh('node --check src/orders.service.mjs'), ...run('Skill', { skill: 'code-review' }), ...sh(cmd)];
  assert.equal(step(judge(lines('node scripts/build.mjs --prod', FILE), { ...inRepo, root }), 'build').pass, true, 'logic');
  assert.equal(step(judge(lines('node scripts/build.mjs --prod', CSS), { ...inRepo, root }), 'build').pass, true, 'CSS/HTML');
  assert.equal(step(judge(lines('node scripts/seed.mjs', FILE), { ...inRepo, root }), 'build').pass, false, 'counter-example');
});
test('3g: CSS/HTML — a stylesheet with a spec beside it needs no spec; a template that touches a binding does', () => {
  const repo = tmpRepo({ 'src/app.css': 'a {}', 'src/app.html': '<a></a>', 'src/app.spec.ts': '' });
  const at = (f) => path.join(repo, f);
  const spec = (lines) => step(judge([...opening(2), ...lines, ...sh('node --check src/orders.service.mjs')], { cwd: repo }), 'spec');
  assert.ok(!spec(edit(at('src/app.css'))) || spec(edit(at('src/app.css'))).pass !== false, 'a stylesheet');
  assert.ok(!spec(run('Edit', { file_path: at('src/app.html'), new_string: '<a class="b">x</a>' })) || spec(run('Edit', { file_path: at('src/app.html'), new_string: '<a class="b">x</a>' })).pass !== false, 'markup with no binding');
  assert.equal(spec(run('Edit', { file_path: at('src/app.html'), new_string: '<a (click)="go()">{{ label }}</a>' })).pass, false, 'counter-example: a binding brings the spec back');
});

// ---- 3h · a build is not asked again for a spec; Evidencia reads commands, not words ----
test('3h: a spec edited after a passing build needs no new build; the same after real code does', () => {
  const lines = (last) => [...opening(2), ...edit(), ...sh('node --check src/orders.service.mjs'), ...run('Skill', { skill: 'code-review' }), ...sh('pnpm run build'), ...last];
  const specAfter = judge(lines([...specEdit(SPEC_A, 0, 1), ...sh('node --test src/a.spec.mjs')]), inRepo);
  assert.equal(step(specAfter, 'build').pass, true, 'only a spec changed since the build');
  assert.equal(step(judge(lines([...edit(), ...sh('node --check src/orders.service.mjs')]), inRepo), 'build').pass, false, 'counter-example: code changed since the build');
});
const judgeEv = (lines, evidencia, more = {}) => cierreGaps(currentTurn(lines), `## Cierre · ${P.taskIds(fresh()).next}\nResultado: hecho\nEvidencia: ${evidencia}\nAprendido: x ← y`, undefined, undefined, { ids: P.taskIds(fresh()), decisions: [{ question: '¿Cómo?', chosen: 'Backoff', discarded: ['Cola'] }], ...inRepo, ...more });
const evid = (lines, evidencia, more) => judgeEv(lines, evidencia, more).observed.evidence;
test('3h: logic — a command is found as a person writes it (W, npx, a package script, counts); identifiers are checked against the diff, not the output', () => {
  const root = tmpRepo({ 'package.json': JSON.stringify({ scripts: { build: 'node scripts/create-env.mjs && ng build' } }) });
  const base = [...opening(2), ...edit('/work/proj/src/orders.service.mjs'), ...sh('node "/s/waymark/scripts/waymark.mjs" review src/orders.service.mjs'), ...sh('pnpm run build', { out: 'Build at: ok' }), ...sh('npx karma start', { out: 'Executed 5 of 5 SUCCESS' }), ...sh('pnpm exec vitest run', { out: ' Tests  8 passed (8)' })];
  const e = (text, more) => evid(base, text, { root, ...more });
  assert.deepEqual(e('observada `W review` sin hallazgos').unbacked, [], 'the W alias');
  assert.deepEqual(e('observada `ng build` pasó').unbacked, [], 'the script that ran is the build');
  assert.deepEqual(e('observada 5/5 en Karma y 8/8 en vitest').unbacked, [], 'counts as the tools print them');
  assert.deepEqual(e('observada la ruta `/help/<key>` y `--p-orange-100` en `app.html`', { gitChanged: [] }).unbacked.sort(), ['--p-orange-100', '/help/<key>', 'app.html'], 'counter-example: identifiers nobody wrote or changed are still unbacked');
  assert.deepEqual(e('observada `pnpm run lint` sin errores').unbacked, ['pnpm run lint'], 'counter-example: a command that never ran');
  assert.deepEqual(e('inferida de los docs (check: `git stash` y `pnpm run build`)').unbacked, [], 'what the user is told to check is no claim');
});
test('3h: CSS/HTML — a class name or variable the task wrote in a stylesheet is backed by the diff', () => {
  const lines = [...opening(2), ...run('Edit', { file_path: CSS, new_string: '.btn-primary { width: var(--btn-width); }' }), ...sh('pnpm run build')];
  assert.deepEqual(evid(lines, 'observada `--btn-width` y `.btn-primary` en el CSS').unbacked, []);
  assert.deepEqual(evid(lines, 'observada `--other-var` en el CSS').unbacked, ['--other-var'], 'counter-example');
});
test('3h: .env.example and a popped git stash are not changes', () => {
  assert.equal(judge([...opening(2), ...sh('git stash -u && pnpm run build; git stash pop')], inRepo), null, 'a stash that came back leaves the tree as it was: nothing to judge');
  const g = judge([...opening(2), ...edit('/work/proj/.env.example'), ...edit(FILE), ...sh('node --check src/orders.service.mjs')], inRepo);
  const asked = g.missing.find((m) => /review/i.test(m)) || '';
  assert.match(asked, /orders\.service\.mjs/, 'counter-example: real code still asks for its review');
  assert.doesNotMatch(asked, /\.env\.example/, 'a placeholder file is no code to review');
});

// ---- 3i · routing is not rewritten ----
const { routedLevel, routedDept } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { effectiveReply } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
test('3i: logic — a Q line after an L1-L3 route does not lower the level or change the department; a lone Q is still a Q; a later real route still wins', () => {
  assert.equal(routedLevel(['Waymark → L2 · dept-backend · skills: code-review', 'revisé el diff\nWaymark → Q · dept-qa'], []), 2);
  assert.equal(routedDept(['Waymark → L2 · dept-backend', 'Waymark → Q · dept-qa'], []), 'dept-backend');
  assert.equal(routedLevel(['Waymark → Q · dept-qa'], []), 'Q', 'counter-example: a question stays one');
  assert.equal(routedLevel(['Waymark → Q · dept-qa', 'Waymark → L2 · dept-backend'], []), 2, 'a question that turns into a change');
  assert.equal(routedLevel(['Waymark → L2 · dept-backend', 'Waymark → L1 · dept-backend'], []), 1, 'a real re-route still wins');
});
test('3i: CSS/HTML — the same for a styles task answered with a Q line after its edit', () => {
  const g = judge([...opening(2), ...edit(CSS), ...sh('pnpm run build'), say('Waymark → Q · dept-qa'), ...run('Skill', { skill: 'code-review' })], inRepo);
  assert.ok(step(g, 'build'), 'the task is still judged as an L2 with a build, not lowered to a question');
  assert.equal(routedDept(['Waymark → L2 · dept-frontend', 'Waymark → Q · dept-qa'], []), 'dept-frontend');
});
test('3i: a background notification gets a short note, not the full reminder and not a new task; an ordinary prompt still gets the reminder', async () => {
  const dir = tmpRepo();
  const note = await hookRun('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>', cwd: dir, session_id: 's-note' });
  assert.match(note.out, /background task's result, not a new request/);
  assert.ok(!/Repo:/.test(note.out), 'no stack or git line: nothing of a new task');
  const normal = await hookRun('rule0-hook.mjs', { hook_event_name: 'UserPromptSubmit', prompt: 'agrega reintentos', cwd: dir, session_id: 's-note-2' });
  assert.ok(!/background task's result/.test(normal.out) && /Waymark/.test(normal.out), 'counter-example');
});
test('3i: a question that prints a Cierre with an ID is sent back once; a plain answer, and the retry, are not', async () => {
  const dir = tmpRepo();
  const file = path.join(dir, 't.jsonl');
  const line = (o) => JSON.stringify(o);
  const reply = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] }, timestamp: new Date().toISOString() });
  const write = (text) => fs.writeFileSync(file, [line({ type: 'user', message: { role: 'user', content: '¿qué hace el guard?' }, uuid: 'p1', timestamp: new Date().toISOString() }), line(reply(text))].join('\n') + '\n');
  const stop = (text, more = {}) => { write(text); return hookRun('stop-hook.mjs', { transcript_path: file, cwd: dir, session_id: 's-q', last_assistant_message: text, ...more }); };
  const withCierre = 'Waymark → Q · dept-qa\nEl guard lee cada comando.\n\n## Cierre · 2026-10-24 · T6\nResultado: hecho';
  assert.match((await stop(withCierre)).out, /routed as a question \(Q\)/, 'blocked once');
  assert.ok(!/routed as a question/.test((await stop(withCierre, { stop_hook_active: true })).out), 'counter-example: the retry is not blocked again');
  assert.ok(!/routed as a question/.test((await stop('Waymark → Q · dept-qa\nEl guard lee cada comando.')).out), 'counter-example: a plain answer');
});
test('3i: a corrected heading inherits the fields of the Cierre it corrects', () => {
  const full = '## Cierre · 2026-10-21 · T6c\nResultado: hecho\nEvidencia: observada el build\nAprendido: x ← y';
  const heading = '## Cierre · 2026-10-21 · T6';
  const merged = effectiveReply([full, heading], heading);
  assert.match(merged, /Cierre · 2026-10-21 · T6\n/);
  assert.ok(!/T6c/.test(merged));
  assert.match(merged, /Resultado: hecho[\s\S]*Evidencia: observada el build[\s\S]*Aprendido: x ← y/);
  assert.equal(effectiveReply([heading], heading), heading, 'counter-example: nothing earlier to inherit from');
  const own = '## Cierre · 2026-10-21 · T6\nResultado: parcial (x)';
  assert.equal(effectiveReply([full, own], own), own, 'counter-example: a heading with its own fields is taken as written');
});

// ---- 3j · smaller items ----
const { maskSecrets } = P;
const { optionsLint, taskTypeOf } = P;
const { costByCall, currentTurn: turnOf } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { questionRecord, trailerIds } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
test('3j: the masker redacts what is shaped like a secret, not the prose around the word', () => {
  assert.equal(maskSecrets('the token expires in an hour'), 'the token expires in an hour');
  assert.equal(maskSecrets('la clave es larga y la contraseña cambia'), 'la clave es larga y la contraseña cambia');
  assert.equal(maskSecrets('password=hunter2'), 'password=[redactado]');
  assert.equal(maskSecrets('contraseña: Abc123!xyz'), 'contraseña: [redactado]');
  assert.match(maskSecrets('Authorization: Bearer ' + 'ey' + 'J'.repeat(1) + 'hbGciOiJIUzI1NiJ9abc1234567890'), /\[redactado\]/);
  assert.ok(!maskSecrets('api key is sk-' + 'a1B2c3D4'.repeat(4)).includes('a1B2c3D4'), 'counter-example: a strong format is masked wherever it is');
});
test('3j: the options attributes are never asked: only the mark (one option Recomendada)', () => {
  const win = (rec, alt, label = 'A (Recomendada)') => [{ callId: 'c1', question: '¿Cómo?', optionList: [{ label, description: rec }, { label: 'B', description: alt }] }];
  assert.deepEqual(optionsLint(win('riesgo bajo; 3 archivos', 'la otra manera'), 2).missing, [], 'a plain alternative is fine');
  assert.deepEqual(optionsLint(win('hace lo que se pide', 'riesgo bajo; 3 archivos'), 2).missing, [], 'a recommended option that says no risk is fine too (368 of 398 real windows fired on it)');
  assert.equal(optionsLint(win('hace lo que se pide', 'la otra', 'A'), 2).missing.length, 1, 'counter-example: no option marked');
});
test('3j: the cache a model change re-writes is not a routine call\'s cost; with the same model every call keeps its share', () => {
  const at = '2026-10-24T10:00:00.000Z';
  const msg = (id, model, cache, tool, name) => ({ type: 'assistant', timestamp: at, message: { id, model, usage: { input_tokens: 10, cache_creation_input_tokens: cache, cache_read_input_tokens: 0, output_tokens: 5 }, content: [{ type: 'tool_use', id: `t${id}`, name: tool, input: { command: name } }] } });
  const lines = (second) => [{ type: 'user', message: { role: 'user', content: 'haz algo' }, uuid: 'p1', timestamp: at }, msg('m1', 'model-a', 100, 'Bash', 'ls'), msg('m2', second, 90000, 'Bash', 'node waymark.mjs check')];
  assert.equal(costByCall(lines('model-b'))[1][3], 0, 'the rewrite after /model is not attributed');
  assert.equal(costByCall(lines('model-a'))[1][3], 90000, 'counter-example: the same model keeps what it cost');
});
test('3j: minutes of work cap an idle gap and leave out the choice window', () => {
  const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString();
  const ev = (name, startMs, endMs, id) => [{ type: 'assistant', timestamp: iso(startMs), message: { content: [{ type: 'tool_use', id, name, input: name === 'Bash' ? { command: 'ls' } : {} }] } }, { type: 'user', timestamp: iso(endMs), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }];
  const turn = (since, ...evs) => [{ type: 'user', message: { role: 'user', content: 'agrega reintentos' }, uuid: 'p', timestamp: iso(since * 60000) }, say('Waymark → L1 · dept-backend'), ...evs.flat()];
  const minutes = (lines) => judge([...lines, ...edit()], inRepo).observed.time.minutes;
  assert.ok(minutes(turn(180, ev('Bash', 179 * 60000, 178 * 60000, 'a1'), ev('Bash', 2 * 60000, 1 * 60000, 'a2'))) < 25, 'three idle hours are not three hours of work');
  assert.ok(minutes(turn(4, ev('Bash', 3 * 60000, 2 * 60000, 'b1'), ev('Bash', 1 * 60000, 30000, 'b2'))) < 8, 'counter-example: a short run is counted as it was');
});
test('3j: a question\'s record keeps the answer the hook was given when the transcript lags; ops is a kind of task', () => {
  const lines = [{ type: 'user', message: { role: 'user', content: '¿qué hace el guard?' }, uuid: 'p', timestamp: new Date().toISOString() }, say('Waymark → Q · dept-qa\nVoy a leerlo.')];
  const rec = questionRecord(turnOf(lines), { agent: 'claude', last: 'Waymark → Q · dept-qa\nEl guard lee cada comando y deniega el que nombra un archivo sensible.' });
  assert.match(rec.answer, /deniega el que nombra un archivo sensible/);
  assert.match(questionRecord(turnOf(lines), { agent: 'claude' }).answer, /Voy a leerlo/, 'counter-example: with no message given, the transcript\'s');
  assert.equal(taskTypeOf({ prompt: 'haz commit y push de los cambios', files: ['src/a.ts'] }), 'ops');
  assert.equal(taskTypeOf({ prompt: 'despliega a staging y migra la base', files: ['src/a.ts'] }), 'ops');
  assert.equal(taskTypeOf({ prompt: 'muestra el total en la tarjeta', files: ['src/card.css', 'src/card.ts'] }), 'feature');
  assert.equal(taskTypeOf({ prompt: 'arregla el commit que rompe el build', files: ['src/a.ts'] }), 'fix', 'counter-example: the first verb decides');
});
test('3j: the Waymark-Task trailer is read as git reads it, from the last paragraph', () => {
  const body = 'fix retries\n\nlonger body';
  assert.deepEqual(trailerIds(`${body}\n\nWaymark-Task: 2026-10-24 · T7\n\nCo-Authored-By: A <a@b>`), [], 'in the middle of the message git sees no trailer');
  assert.deepEqual(trailerIds(`${body}\n\nWaymark-Task: 2026-10-24 · T7\nCo-Authored-By: A <a@b>\n`), ['2026-10-24 · T7']);
  assert.deepEqual(trailerIds(`${body}\r\n\r\nWaymark-Task: 2026-10-24 · T7\r\n`), ['2026-10-24 · T7'], 'CRLF');
  assert.deepEqual(trailerIds('Waymark-Task: 2026-10-24 · T7'), ['2026-10-24 · T7'], 'a message that is only the trailer');
  assert.deepEqual(trailerIds(body), []);
});
