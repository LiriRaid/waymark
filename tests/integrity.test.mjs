// Waymark 2.0.3 · point 1: the integrity of the testigos (no false ✔). Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME; nothing reads or writes the real ~/.waymark or ~/.claude.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-integrity-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { taskIds, shellRuns, appendRecord, readLog, projectHome, writeTaskLine, logHookError } = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps, evaluate, summaryLine, turnCommitsAll } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { secretSources, secretHits } = await import(`file://${SCRIPTS}/testigos.mjs`);
const { missingTrailer } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { currentTurn, sessionTools } = await import(`file://${SCRIPTS}/transcript.mjs`);

const FILE = '/work/proj/src/orders.service.mjs';
let n = 0, ids = 0;
const fresh = () => `/work/integrity-${++n}`;
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
// a tool call and its result, linked by id (the result carries the exit and the output)
const run = (name, input, { error = false, out = 'ok' } = {}) => {
  const id = `u${++ids}`;
  return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }];
};
const sh = (command, opts) => run('Bash', { command }, opts);
const answered = (question, labels, chosen) => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } });
const opening = (level = 2) => [prompt('agrega reintentos al servicio de pedidos'), say(`Waymark → L${level} · dept-backend · skills: code-review`), ...run('Skill', { skill: 'dept-backend' }), ...run('Read', { file_path: '/skills/dept-backend/procedures.md' }),
  ...sh('node "/s/waymark/scripts/waymark.mjs" pack src/orders.service.mjs'), ...run('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff')];
const edit = (file = FILE) => run('Edit', { file_path: file });
const cierre = (id, extra = '') => `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada timeouts en el log de pedidos\nAprendido: backoff ← timeouts${extra}`;
const ctxFor = (cwd, more = {}) => ({ ids: taskIds(cwd), decisions: [{ question: '¿Cómo?', chosen: 'Backoff', discarded: ['Cola'] }], ...more });
const judge = (lines, extra = '', more = {}, cwd = fresh()) => cierreGaps(currentTurn(lines), cierre(taskIds(cwd).next, extra), undefined, undefined, ctxFor(cwd, more));
const step = (g, id) => g.steps.find((s) => s.id === id);
const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const tmpRepo = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-int-')); temps.push(d); gitT(d, 'init', '-q'); gitT(d, 'config', 'user.email', 't@t'); return d; };

test('gate: a word in an argument or a commit message is no gate; the executable of each part decides', () => {
  const kinds = (c) => shellRuns(c).filter((p) => p.gate || p.test || p.build).map((p) => `${p.gate ? 'g' : ''}${p.build ? 'b' : ''}${p.test ? 't' : ''}`);
  assert.deepEqual(kinds('git commit -m "fix build and lint"'), []);
  assert.deepEqual(kinds('ls build && cat tests/a.txt'), []);
  assert.deepEqual(kinds('grep -r "npm test" docs'), []);
  assert.deepEqual(kinds('npx --no-install tsc --noEmit -p tsconfig.app.json'), ['g']);
  assert.deepEqual(kinds('pnpm run build:prod'), ['gb']);
  assert.deepEqual(kinds('npm test -- --run'), ['t']);
  assert.deepEqual(kinds('node --check a.mjs && node --test tests/a.test.mjs'), ['g', 't']);
  assert.deepEqual(kinds('bash -c "npx tsc --noEmit"'), ['g'], 'a quoted command still runs');
  assert.deepEqual(kinds('C:/repo/node_modules/.bin/eslint.cmd src'), ['g']);
  assert.deepEqual(kinds('bundle exec rspec spec/models'), ['t']);
  assert.deepEqual(kinds("cat > x.spec.ts <<'EOF'\nnpm test\nEOF"), [], 'a heredoc body is text');
  assert.deepEqual(shellRuns('cd ../api && npm run build').map((p) => p.cd), [null, '../api']);
  assert.deepEqual(kinds('pnpm --filter web build'), ['gb'], 'flags before the command');
  assert.deepEqual(shellRuns('npm --prefix ../api run build').map((p) => p.cd), ['../api']);
  assert.deepEqual(kinds('env CI=1 npm test'), ['t']);
  assert.deepEqual(kinds('node scripts/build.mjs'), ['gb'], 'a build script by its interpreter');

  for (const cmd of ['git commit -m "fix build"', 'ls build']) {
    const g = judge([...opening(), ...edit(), ...sh(cmd)]);
    assert.deepEqual(g.observed.gates, [], `${cmd}: nothing checked`);
    assert.ok(g.missing.some((m) => /no typecheck, lint or build ran after the last code change/.test(m)), cmd);
  }
});

test('gate: a red tsc followed by another command stays red (its exit is not the gate\'s)', () => {
  const lines = (cmd, out) => [...opening(1), ...edit(), ...sh(cmd, { out })];
  const red = judge(lines('npx tsc --noEmit; echo done', 'src/a.ts(3,1): error TS2322: Type…\ndone'));
  assert.equal(red.observed.gate.ok, false, 'the output shows the failure');
  assert.ok(red.missing.some((m) => /the gate after the last code change failed/.test(m)));
  const piped = judge(lines('npx tsc --noEmit | tail -5', 'clean'), '', { rerun: () => ({ cmd: 'npx tsc --noEmit', ok: false, s: 4 }) });
  assert.deepEqual([piped.observed.gate.by, piped.observed.gate.ok], ['testigo', false], 'a pipe decides through the hook\'s own run');
  const green = judge(lines('npx tsc --noEmit && echo done', 'done'));
  assert.deepEqual([green.observed.gate.by, green.observed.gate.ok], ['agent', true], '&& reaches the end only when the gate passed');
});

test('tests: a red test after the last change leaves the gate ✘, even with a later passing node --check', () => {
  const lines = [...opening(1), ...edit(), ...sh('node --test tests/orders.test.mjs', { error: true, out: '✖ retries (2ms)\nℹ fail 1' }), ...sh('node --check src/orders.service.mjs')];
  const g = judge(lines);
  assert.equal(step(g, 'gate').pass, false);
  assert.ok(g.missing.some((m) => /a test after the last code change failed \(node --test tests\/orders\.test\.mjs\)/.test(m)));
  const clean = judge([...opening(1), ...edit(), ...sh('node --check src/orders.service.mjs'), ...sh('git worktree add -q /tmp/w HEAD && (cd /tmp/w && node --test tests/orders.test.mjs)', { error: true, out: 'ℹ fail 1' })]);
  assert.deepEqual(clean.observed.tests.failed, [], 'a red run in a clean copy is meant to fail');
  const titled = judge([...opening(1), ...edit(), ...sh('node --test 2>&1 | tail -3', { out: '✔ reports 2 errors on bad input\nℹ pass 4\nℹ fail 0' })]);
  assert.deepEqual(titled.observed.tests.failed, [], 'a count inside a test title is no failure');
  const fixed = judge([...lines, ...sh('node --test tests/orders.test.mjs')]);
  assert.equal(step(fixed, 'gate').pass, true, 'the same test passing later clears it');
});

test('exceptions: "no comprobado", "Tests: no", "Build: no", "Secretos: no" pass as ⚠, never as ✔', () => {
  const lines = [...opening(1), ...edit(), ...sh('npx tsc --noEmit', { error: true, out: 'error TS2322' })];
  const g = judge(lines, '\nno comprobado (falla en un archivo que esta tarea no tocó)', { blocked: true });
  assert.deepEqual(g.missing, []);
  assert.match(step(g, 'gate').exception, /^no comprobado \(falla en un archivo/);
  const ev = evaluate(g, { total: 10 });
  assert.deepEqual([ev.steps.Verificar, ev.steps.Previos], ['exception', 'exception'], 'the gate and the pre-existing failure, both declared');
  assert.equal(ev.exceptions, 2);
  assert.ok(!ev.score.startsWith(`${Object.keys(ev.steps).length}/`), 'an exception is not a ✔ in the score');
  assert.match(summaryLine('x', ev), /Verificar ⚠/);
  const build = judge([...opening(2), ...edit(), ...sh('node --check src/orders.service.mjs'), ...run('Skill', { skill: 'code-review' })], '\nBuild: no (el proyecto no tiene build)', { blocked: true });
  assert.match(step(build, 'build').exception, /^Build: no/);
});

test('user skip: the quote needs 3 words (or 12 characters) from the user\'s messages', () => {
  const lines = [...opening(2), ...edit(), ...sh('node --check src/orders.service.mjs && npm run build')];
  const short = cierreGaps(currentTurn(lines), cierre(taskIds(fresh()).next, '\nReview: omitido (usuario: "sin")'), undefined, ['sin review'], ctxFor(fresh()));
  assert.equal(step(short, 'review').pass, false);
  assert.ok(short.findings.some((f) => /too short/.test(f)));
  const ok = cierreGaps(currentTurn(lines), cierre(taskIds(fresh()).next, '\nReview: omitido (usuario: "sin review por ahora")'), undefined, ['hazlo sin review por ahora'], ctxFor(fresh()));
  assert.equal(step(ok, 'review').pass, true);
  const picked = cierreGaps(currentTurn(lines), cierre(taskIds(fresh()).next, '\nReview: omitido (usuario: "Sin review")'), undefined, ['x'], ctxFor(fresh(), { decisions: [{ question: '¿Review?', chosen: 'Sin review', discarded: ['Con review'] }] }));
  assert.equal(step(picked, 'review').pass, true, 'a whole option the user picked counts, short or not');
});

test('review: only a run without error, after the task\'s first code change, that covers the changed code', () => {
  const after = [...opening(2), ...edit(), ...sh('node --check src/orders.service.mjs && npm run build')];
  assert.equal(step(judge([...after, ...run('Skill', { skill: 'code-review' })]), 'review').pass, true);
  assert.equal(step(judge([...after, ...run('Skill', { skill: 'code-review' }, { error: true })]), 'review').pass, false, 'a failed review reviewed nothing');
  const before = [...opening(2), ...run('Skill', { skill: 'code-review' }), ...edit(), ...sh('node --check src/orders.service.mjs && npm run build')];
  assert.equal(step(judge(before), 'review').pass, false, 'a review before the code reviewed nothing');
  const W = 'node "/s/waymark/scripts/waymark.mjs" review';
  assert.equal(step(judge([...after, ...sh(`${W} src/other.mjs`)]), 'review').pass, false, 'it must name the changed code');
  assert.equal(step(judge([...after, ...sh(`${W} src/orders.service.mjs`)]), 'review').pass, true);
  const fixedAfter = [...after, ...run('Skill', { skill: 'code-review' }), ...edit(), ...sh('node --check src/orders.service.mjs && npm run build')];
  assert.equal(step(judge(fixedAfter), 'review').pass, true, 'applying its findings needs no second review');
});

test('review in Codex: reading code-review/SKILL.md is no review', async () => {
  const cx = await import(`file://${SCRIPTS}/agents/codex.mjs`);
  const item = (it) => ({ timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'item_completed', item: it } });
  const lines = cx.toLines([item({ type: 'UserMessage', id: 'i1', content: [{ type: 'text', text: 'x' }] }),
    item({ type: 'CommandExecution', id: 'c1', command: ['pwsh', '-Command', 'Get-Content C:/skills/code-review/SKILL.md'], status: 'completed', exit_code: 0, aggregated_output: '' }),
    item({ type: 'CommandExecution', id: 'c2', command: ['pwsh', '-Command', 'Get-Content C:/skills/dept-qa/SKILL.md'], status: 'completed', exit_code: 0, aggregated_output: '' })]);
  const skills = sessionTools(lines).filter((t) => t.name === 'Skill').map((t) => t.input.skill);
  assert.deepEqual(skills, ['dept-qa']);
});

test('build: exit 0, after the last code change, in the repo of the code', () => {
  // the repo of each folder, as git would answer it (the hook skips temp folders, so the paths are not on disk)
  const repos = { '/work/proj': '/work/proj', '/work/proj/src': '/work/proj', '/work/api': '/work/api' };
  const more = { cwd: '/work/proj', repoOf: (d) => repos[String(d).replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')] || null };
  const lines = (...tail) => [...opening(2), ...edit(), ...sh('node --check src/orders.service.mjs'), ...run('Skill', { skill: 'code-review' }), ...tail];
  const pass = (l) => step(judge(l, '', more), 'build').pass;
  assert.equal(pass(lines(...sh('npm run build'))), true);
  assert.equal(pass(lines(...sh('npm run build', { error: true, out: 'ELIFECYCLE' }))), false, 'a failed build');
  assert.equal(pass(lines(...sh('npm run build | tail -3', { out: 'npm ERR! code ELIFECYCLE' }))), false, 'a failure behind a pipe');
  assert.equal(pass([...opening(2), ...sh('npm run build'), ...edit(), ...sh('node --check src/orders.service.mjs'), ...run('Skill', { skill: 'code-review' })]), false, 'before the last change');
  assert.equal(pass(lines(...sh('cd ../api && npm run build'))), false, 'another repo');
});

test('secrets: every commit of the turn is read, with or without trailer, in any repo', () => {
  const repo = tmpRepo(), fake = 'gh' + 'p_' + 'A1b2'.repeat(9), start = Date.now();
  fs.writeFileSync(path.join(repo, 'k.mjs'), `export const k = '${fake}';\n`);
  gitT(repo, 'add', '.');
  gitT(repo, 'commit', '-q', '-m', 'add k');
  const tools = sessionTools([...sh(`cd "${repo.replace(/\\/g, '/')}" && git add . && git commit -m "add k"`)]);
  const commits = turnCommitsAll(tools, fresh(), start);
  assert.equal(commits.length, 1);
  const hits = secretHits(secretSources([], commits, fresh(), null));
  assert.deepEqual(hits.map((h) => h.kind), ['GitHub token']);
});

test('Aprendido: unresolved testigos keep the Work in progress line open and go to engram as "sin verificar"', async () => {
  const repo = tmpRepo(), h = projectHome(repo);
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(h.memory, '# Project: x\n\n## Work in progress\n\n## Identity\n');
  const rec = { id: '2026-10-12 · T1', prompt: 'x', cierre: '## Cierre · x\nResultado: hecho\nAprendido: backoff ← timeouts', unresolved: ['the gate after the last code change failed'], evaluation: { steps: { Verificar: false, Cierre: true } } };
  writeTaskLine(h, rec);
  assert.match(fs.readFileSync(h.memory, 'utf8'), /- ▶ \[2026-10-12 · T1\] backoff ← timeouts/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-engram-')); temps.push(dir);
  const log = path.join(dir, 'calls.jsonl'), bin = path.join(dir, 'engram.mjs');
  fs.writeFileSync(bin, `import fs from 'node:fs';\nconst a = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');\nif (a[0] === 'version') console.log('engram 3.1.0');\n`);
  process.env.WAYMARK_ENGRAM = bin;
  try {
    const { saveLearned } = await import(`file://${SCRIPTS}/engram.mjs`);
    assert.equal(saveLearned(h, rec), true);
  } finally { process.env.WAYMARK_ENGRAM = ''; }
  const save = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((c) => c[0] === 'save');
  assert.match(save[1], /^2026-10-12 · T1 · sin verificar · /);
  assert.match(save[2], /^Sin verificar: Verificar\nAprendido: backoff ← timeouts/);
});

test('quota: a turn that ended without a task does not leave its start behind; a routed task that stopped keeps it', async () => {
  const { recordStatus, markStart, readQuota } = await import(`file://${SCRIPTS}/statusline.mjs`);
  const t0 = 1799991000000, status = (pct) => ({ session_id: 'q1', rate_limits: { five_hour: { used_percentage: pct, resets_at: 1800000000 } }, context_window: { used_percentage: 5, total_input_tokens: 100, total_output_tokens: 0 } });
  recordStatus(status(10), t0);
  markStart('q1', t0 + 1000);
  recordStatus(status(12), t0 + 2000);
  markStart('q1', t0 + 3000);
  assert.equal(readQuota().starts.q1.pct, 10, 'the same task keeps its start');
  // an L0 turn (no task, no record) ends: the next prompt starts its own measure
  const cwd = fresh(), transcript = path.join(home, 'l0.jsonl');
  fs.writeFileSync(transcript, [prompt('cambia el color'), say('Waymark → L0 · dept-frontend')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(home, '.quota-starts.json'), JSON.stringify({ l0: { at: Date.now(), pct: 5, resetsAt: null } }));
  spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'l0', last_assistant_message: 'Listo' }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(readQuota().starts.l0, undefined);
  // a routed task that stopped to ask before its first change keeps its start
  fs.writeFileSync(transcript, [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  fs.writeFileSync(path.join(home, '.quota-starts.json'), JSON.stringify({ l2: { at: Date.now(), pct: 5, resetsAt: null } }));
  spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd, session_id: 'l2', last_assistant_message: '¿Backoff o cola?' }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(readQuota().starts.l2?.pct, 5);
});

test('trailer: a heredoc that only mentions git commit is no commit; the trailer is read in the message', () => {
  const cwd = tmpRepo(), state = path.join(home, `trailer-${n}.json`);
  assert.equal(missingTrailer("cat > notes.md <<'EOF'\nrun git commit -m \"x\" later\nEOF", 's1', cwd, state), null);
  assert.equal(missingTrailer("git commit -m \"$(cat <<'EOF'\nfix\n\nWaymark-Task: 2026-10-12 · T1\nEOF\n)\"", 's1', cwd, state), null);
  assert.match(missingTrailer('git commit -m "fix"', 's1', cwd, state) || '', /no "Waymark-Task: <task ID>"/);
});

test('errors: a hook that fails writes ~/.waymark/hook-errors.log and check reports it', async () => {
  logHookError('stop-hook', new Error('boom'));
  const text = fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8');
  assert.match(text, /stop-hook .*boom/);
  spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: '{not json', env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(fs.readFileSync(path.join(home, 'hook-errors.log'), 'utf8').split('\n').filter(Boolean).length, 2);
  const { hookErrors } = await import(`file://${SCRIPTS}/waymark.mjs`);
  assert.match(hookErrors(), /^hooks: 2 errors? in the last 7 days .*hook-errors\.log/);
});
