// Waymark 2.0.20 · point 19 (rows 44 to 47): the gates and detectors read the commands the agents really run. Every case is a synthetic copy of a pattern seen in
// real use (ADR 0042): no project name, path, prompt or code of a real project. Run: node --test tests/gates-real.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-gates-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_REVIEW_MODE = 'always';
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { cierreGaps } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);
const { checkDecision } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { changesProject, mutatesFiles, shellRuns } = await import(`file://${SCRIPTS}/runs.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

let ids = 0, gate = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
const call = (name, input, out = 'ok', error = false) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }]; };
const state = () => path.join(home, `gate-${gate++}.json`);
const FILE = '/work/proj/src/orders.service.mjs';

test('19: the L1 gate accepts what Rule 0 and the end-of-turn hook accept: a `Camino:` line before the first change owes no window', () => {
  const l1 = [prompt('corrige el typo del título'), say('Waymark → L1 · dept-frontend')];
  assert.match(checkDecision(FILE, l1, 's1', state()) || '', /L1 decision gate/, 'no Camino, no window: denied');
  const camino = [...l1, say('Camino: cambiar el texto en el template, un solo archivo.')];
  assert.equal(checkDecision(FILE, camino, 's1', state()), null, 'Camino: before the change passes');
  assert.equal(checkDecision(FILE, [...l1, say('- Camino: cambiar el texto')], 's1', state()), null, 'in a bullet');
  assert.equal(checkDecision(FILE, [...l1, say('**Camino:** cambiar el texto')], 's1', state()), null, 'in bold');
  assert.match(checkDecision(FILE, [...l1, say('El camino: es incierto')], 's1', state()) || '', /L1 decision gate/, 'counter-example: a sentence that only holds the word');
  assert.match(checkDecision(FILE, [prompt('agrega reintentos'), say('Waymark → L2 · dept-backend'), say('Camino: reintentos con backoff')], 's1', state()) || '', /L2 decision gate/, 'counter-example: an L2 owes the window, a Camino does not replace it');
});

test('19: a redirect to a temp place or to a variable that points there is no change; a redirect into the project still is', () => {
  for (const command of [
    '& $eb skill > "$env:TEMP\\ego-skill.md"',
    '& $eb skill > $env:TEMP\\ego-skill.md',
    '& $eb skill > $env:TMP/ego-skill.md',
    '$out = "$env:TEMP\\skill.md"; & $eb skill > $out',
    'out=/tmp/skill.md; ego-browser skill > "$out"',
    'ego-browser skill > /dev/null 2>&1',
    'ego-browser skill 2> $null',
  ]) assert.equal(changesProject(command), false, command);
  for (const command of ['ego-browser skill > docs/skill.md', 'out=docs/skill.md; ego-browser skill > "$out"', '& $eb skill > src\skill.md']) assert.equal(changesProject(command), true, command);
});

test('19: text between quotes is no command: a grep for a word like Move-Item or rm, or a commit message that holds one', () => {
  for (const command of [
    'grep -nE "Remove-Item|Move-Item" scripts/uninstall.mjs',
    'grep -n "(?:rm|mv) " notes.md',
    'rg "a|rm -rf" src',
    'git commit -m "fix: stop calling rm; mv the file"',
    'echo "step 1; rm -rf build" | head',
    "git log --grep='x|git rm' --oneline",
  ]) assert.equal(changesProject(command), false, command);
  // what runs inside quotes (another shell) is still a command
  for (const command of ['bash -c "rm -rf dist"', 'pwsh -Command "Move-Item a.txt b.txt"', "sh -c 'sed -i s/a/b/ src/x.ts'", 'cmd /c "del src/x.ts"', 'rm -rf dist', 'git rm src/x.ts', 'sed -i s/a/b/ src/x.ts', 'Move-Item a.txt b.txt']) assert.equal(mutatesFiles(command), true, command);
});

// ---- the end-of-turn reading: what changed, and which build counts ----
const SPEC = '/work/proj/src/orders.service.spec.mjs';
const ASKED = [...call('AskUserQuestion', { questions: [] }), { type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question: '¿Cómo?', options: [{ label: 'A' }, { label: 'B' }] }], answers: { '¿Cómo?': 'A' } } }];
const CIERRE = '## Cierre · 2026-10-29 · T1\nResultado: hecho\nEvidencia: observada ok\nAprendido: x ← y';
const judge = (lines, ctx = {}, reply = CIERRE) => cierreGaps(currentTurn(lines), reply, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: [{ question: '¿Cómo?', chosen: 'A', discarded: ['B'] }], cwd: '/work/proj', procDelivered: ['dept-backend'], packed: 1, ...ctx });
const head = (level) => [prompt('agrega reintentos'), say(`Waymark → L${level} · dept-backend`), ...call('Skill', { skill: 'dept-backend' })];
const step = (g, id) => g.steps.find((s) => s.id === id);

test('19: a write the hook denied is not a changed file: a turn of ego calls whose script write was refused is no task', () => {
  const denied = call('Write', { file_path: '/home/u/ego/round-14.mjs', content: 'console.log(1)' }, 'PreToolUse:Write hook error: decision gate', true);
  const turn = [prompt('mira cómo quedó'), say('Waymark → L1 · dept-frontend'), ...denied, ...call('Bash', { command: 'ego-browser nodejs -e "console.log(1)"' })];
  assert.equal(judge(turn, {}, 'Listo, lo miré.'), null, 'nothing changed: no record, no testigos');
  const g = judge([...head(2), ...ASKED, ...denied, ...call('Edit', { file_path: FILE })]);
  assert.deepEqual(g.changed, [FILE], 'only the edit that went through');
});

test('19: a change made by a script kept in a file or by a PowerShell rename is a change: git saw it, so the review, the build and the spec are owed', () => {
  const run = (command) => judge([...head(2), ...ASKED, ...call('Bash', { command })], { gitChanged: ['/work/proj/src/a.ts', '/work/proj/src/b.ts', '/work/proj/src/c.ts'] });
  for (const command of ['node scripts/reorganize.mjs', 'node "$SCRIPT"', 'Rename-Item src/a.ts src/b.ts', 'ren src\a.ts b.ts', 'python tools/move_modules.py']) {
    const g = run(command);
    assert.equal(g.changed.length, 3, `git's list is the task's files: ${command}`);
    assert.ok(g.missing.some((m) => /no review ran/.test(m)), `review owed: ${command}`);
    assert.ok(g.missing.some((m) => /run the build once/.test(m)), `build owed: ${command}`);
  }
});

const L2_EDIT = [...head(2), ...ASKED, ...call('Edit', { file_path: FILE })];
const buildOwed = (g) => g.missing.some((m) => /run the build once/.test(m));
test('19: the build counts by form: piped, in a subshell, in a chain of two repos, in the background with its result by notification', () => {
  const ok = (command, out = 'Build at: now\nCompiled successfully', error = false) => buildOwed(judge([...L2_EDIT, ...call('Bash', { command }, out, error)])) === false;
  assert.ok(ok('pnpm run build'), 'plain');
  assert.ok(ok('pnpm run build 2>&1 | tail -20'), 'piped to tail: its exit is tail\'s, the output says it passed');
  assert.ok(ok('(cd web && pnpm run build 2>&1 | grep -v warning | head -30)'), 'a subshell with grep and head');
  assert.ok(ok('cd api && pnpm run build 2>&1 | tail -5 && cd ../web && pnpm run build 2>&1 | tail -5'), 'two repos in one chain');
  assert.ok(ok('cd api && pnpm run build && cd ../web && pnpm run build'), 'two repos, plain');
  assert.equal(ok('pnpm run build 2>&1 | tail -20', 'error TS2322: Type string is not assignable', true), false, 'counter-example: the output shows a failure');
  assert.equal(ok('(cd web && pnpm run build 2>&1 | head -30)', 'error TS2322: Type string is not assignable to type number'), false, 'counter-example: a failure in a subshell whose last pipe part exits 0');
  const launch = call('Bash', { command: 'pnpm run build', run_in_background: true }, 'Command running in background with ID: bg1. Output is being written to: /tmp/bg1.output');
  const done = call('BashOutput', { bash_id: 'bg1' }, '<exit_code>0</exit_code>\nBuild at: now');
  assert.equal(buildOwed(judge([...L2_EDIT, ...launch, ...done])), false, 'background: the later read of its result credits it');
  assert.equal(buildOwed(judge([...L2_EDIT, ...launch])), true, 'counter-example: a launch nobody saw finish');
});

// ---- 2.0.20 point 30, from the first real task of checkpoint B: the API was compiled to a temp folder, the front by node running the Angular CLI ----
const isBuild = (command) => shellRuns(command).some((p) => p.build);
test('30: the forms real agents use to build count: tsc of a build tsconfig or to an --outDir, and node running a framework CLI', () => {
  assert.ok(isBuild('cd "/work/api" && ls tsconfig.build.json >/dev/null && pnpm exec tsc -p tsconfig.build.json --outDir "/tmp/api-build" 2>&1 | tail -5; echo BUILD_EXIT=$?'), 'tsc -p tsconfig.build.json --outDir');
  assert.ok(isBuild('npx tsc -p tsconfig.build.json 2>&1 | tail -5'), 'a build tsconfig with no outDir flag');
  assert.ok(isBuild('pnpm exec tsc --project tsconfig.json --outDir /tmp/x'), 'any tsconfig to an --outDir');
  assert.ok(isBuild('node --max_old_space_size=6144 ./node_modules/@angular/cli/bin/ng build --output-path /tmp/dist > /tmp/build.log 2>&1'), 'node running the Angular CLI');
  assert.ok(isBuild('node --max-old-space-size 6144 ./node_modules/@angular/cli/bin/ng build'), 'a flag with its value apart');
  assert.ok(isBuild('node ./node_modules/@nestjs/cli/bin/nest.js build'), 'node running the Nest CLI');
  assert.ok(isBuild('node ./node_modules/vite/bin/vite.js build'), 'node running vite');
  for (const [command, why] of [
    ['pnpm exec tsc --noEmit -p tsconfig.app.json', 'the typecheck stays a typecheck'],
    ['pnpm exec tsc -p tsconfig.build.json --noEmit', 'a build tsconfig with --noEmit emits nothing'],
    ['pnpm exec tsc --noEmit --outDir /tmp/x -p tsconfig.json', '--noEmit wins'],
    ['pnpm exec tsc -p tsconfig.json', 'no build tsconfig and no --outDir: a plain compile in place is not named a build'],
    ['node ./node_modules/@angular/cli/bin/ng test', 'node running the CLI is read by its verb: test is no build'],
    ['node --max-old-space-size 6144 server.js', 'a server is no build'],
    ['node --max-old-space-size 6144 ./node_modules/@angular/cli/bin/ng serve', 'serve is no build'],
  ]) assert.equal(isBuild(command), false, why);
  assert.ok(shellRuns('pnpm exec tsc -p tsconfig.build.json --outDir /tmp/x').some((p) => p.gate), 'it is still a gate');
});

test('30: a task that changes two repos owes the build of each, and the block names the one that has none', () => {
  const repoOf = (d) => String(d).replace(/\\/g, '/').replace(/^[a-z]:/i, '').match(/^\/work\/(api|web)\b/)?.[0] || null;
  const WEB = '/work/web/src/a.mjs', API = '/work/api/src/b.mjs';
  const two = [...head(2), ...ASKED, ...call('Edit', { file_path: WEB }), ...call('Edit', { file_path: API })];
  const fe = call('Bash', { command: 'cd "/work/web" && pnpm run build 2>&1 | grep -E "ERROR|error TS|complete" | head -5' }, 'Application bundle generation complete.');
  const none = judge([...two, ...fe], { repoOf });
  const msg = none.missing.find((m) => /run the build once/.test(m)) || '';
  assert.ok(msg, 'the API has no build: owed');
  assert.match(msg, /\bapi\b/, msg);
  assert.doesNotMatch(msg, /\bweb\b/, 'the front was built: it is not named');
  const api = call('Bash', { command: 'cd "/work/api" && pnpm exec tsc -p tsconfig.build.json --outDir "/tmp/api-build" 2>&1 | tail -5; echo BUILD_EXIT=$?' });
  assert.equal(buildOwed(judge([...two, ...fe, ...api], { repoOf })), false, 'the API compiled to a temp folder counts');
  assert.equal(buildOwed(judge([...two, ...api], { repoOf })), true, 'counter-example: the front is missing now');
});

const NODE_RED = 'ℹ tests 40\nℹ pass 39\nℹ fail 1\n✖ failing tests:\n\ntest at tests/hooks.test.mjs:120:1\n✖ the hook stays under its cap (310.2ms)\n  AssertionError: 310 > 300';
test('19: a project with no typecheck: a suite that passed after the last change is the gate; node --check is one too', () => {
  const run = (...calls) => judge([...L2_EDIT, ...calls.flat()]);
  assert.equal(run(call('Bash', { command: 'node --test tests/orders.test.mjs' }, 'ℹ pass 12\nℹ fail 0')).missing.some((m) => /no typecheck, lint or build ran/.test(m)), false, 'the suite stands in');
  assert.equal(run(call('Bash', { command: 'node --check src/orders.service.mjs' })).missing.some((m) => /no typecheck, lint or build ran/.test(m)), false, 'node --check is a gate');
  assert.equal(run(call('Bash', { command: 'git status' })).missing.some((m) => /no typecheck, lint or build ran/.test(m)), true, 'counter-example: nothing ran');
});

test('19: a full suite that flaked under load is cleared by the isolated repeat of each file it named; a red file that was not repeated stays', () => {
  const failed = (g) => (g.missing || []).some((m) => /a test after the last code change failed/.test(m));
  const full = call('Bash', { command: 'node --test tests/*.test.mjs' }, NODE_RED, true);
  assert.equal(failed(judge([...L2_EDIT, ...full])), true, 'red, no repeat');
  assert.equal(failed(judge([...L2_EDIT, ...full, ...call('Bash', { command: 'node --test tests/hooks.test.mjs' }, 'ℹ pass 12\nℹ fail 0')])), false, 'its file alone, green');
  assert.equal(failed(judge([...L2_EDIT, ...full, ...call('Bash', { command: 'node --test tests/other.test.mjs' }, 'ℹ pass 3\nℹ fail 0')])), true, 'counter-example: another file passing clears nothing');
  assert.equal(failed(judge([...L2_EDIT, ...full, ...call('Bash', { command: 'node --test tests/hooks.test.mjs' }, NODE_RED, true)])), true, 'counter-example: the repeat is red too');
  const vitest = call('Bash', { command: 'pnpm exec vitest run' }, ' FAIL  src/orders.service.spec.ts > retries > backs off\nTests  1 failed | 11 passed', true);
  assert.equal(failed(judge([...L2_EDIT, ...vitest, ...call('Bash', { command: 'pnpm exec vitest run src/orders.service.spec.ts' }, 'Tests  12 passed')])), false, 'vitest names its file the same way');
});

test('19: evidence read in an earlier turn of the same stretch (a question answered before the change) backs what the Cierre cites', () => {
  const earlier = [{ id: 'q-turn-1', name: 'Bash', input: { command: 'node --test tests/orders.test.mjs' }, out: 'ℹ pass 29\n29/29 specs' }];
  const cite = '## Cierre · 2026-10-29 · T1\nResultado: hecho\nEvidencia: observada `29/29`\nAprendido: x ← y';
  const lines = [...L2_EDIT, ...call('Bash', { command: 'node --check src/orders.service.mjs && pnpm run build' }, 'ok')];
  const without = judge(lines, {}, cite);
  const withStretch = judge(lines, { stretchTools: earlier }, cite);
  assert.ok((without.observed.evidence?.unbacked || []).includes('29/29'), 'nothing shows it');
  assert.deepEqual(withStretch.observed.evidence?.unbacked || [], [], 'the earlier read backs it');
});

test('19: an ego script written outside the project (a folder named ego) is no change: the gate does not deny it and no task is made of it; inside the project it still is', () => {
  const script = '/home/u/ego/round-03.mjs', nested = 'C:/Users/dev/.ego/scripts/round-03.mjs', inRepo = '/work/proj/ego/round-03.mjs';
  const l1 = [prompt('mira cómo quedó'), say('Waymark → L1 · dept-frontend')];
  assert.equal(checkDecision(script, l1, 's-ego', state(), '/work/proj'), null);
  assert.equal(checkDecision(nested, l1, 's-ego', state(), '/work/proj'), null);
  assert.match(checkDecision(inRepo, l1, 's-ego', state(), '/work/proj') || '', /L1 decision gate/, 'counter-example: the same folder name inside the project is the project\'s');
  assert.match(checkDecision('/home/u/notes/round-03.mjs', l1, 's-ego', state(), '/work/proj') || '', /L1 decision gate/, 'counter-example: a script elsewhere is not an ego script');
  assert.match(checkDecision('/home/u/ego/readme.md', [...l1], 's-ego', state(), '/work/proj') || '', /L1 decision gate/, 'counter-example: only scripts');
});

test('19: the design link the user wrote stays theirs for the whole job: a later task of the session that does not repeat it may still look at it', async () => {
  const { gate } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
  const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-job-'));
  const write = (file, text) => fs.writeFileSync(file, [prompt(text)].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const first = path.join(proj, 'one.jsonl'), second = path.join(proj, 'two.jsonl');
  write(first, 'ajusta el botón como en https://www.figma.com/design/abc/Pieza');
  write(second, 'ahora la tabla, igual que antes');
  const run = (transcript, url) => gate({ tool_name: 'Bash', tool_input: { command: `"$EGO" nodejs -e 'await page.goto("${url}")'` }, cwd: proj, session_id: 's-job', transcript_path: transcript }, claude);
  const link = 'https://www.figma.com/design/abc/Pieza';
  assert.match(run(second, link) || '', /neither the local dev server/, 'counter-example: before the user wrote it in this session, it is off-host');
  assert.equal(run(first, link), null, 'the task that carries the link');
  assert.equal(run(second, link), null, 'a later task of the same session, whose prompt does not repeat it');
  assert.match(run(second, 'https://prod.example.com/') || '', /neither the local dev server/, 'counter-example: only the hosts the user wrote');
  const other = (url) => gate({ tool_name: 'Bash', tool_input: { command: `"$EGO" nodejs -e 'await page.goto("${url}")'` }, cwd: proj, session_id: 's-other-job', transcript_path: second }, claude);
  assert.match(other(link) || '', /neither the local dev server/, 'counter-example: another session never wrote it');
  fs.rmSync(proj, { recursive: true, force: true });
});

test('review fix: only an ego-named scripts folder is exempt: a repository whose name starts with ego is a project; a narrowed run does not clear a red file', () => {
  const l1 = [prompt('mira cómo quedó'), say('Waymark → L1 · dept-frontend')];
  assert.match(checkDecision('/work/ego-web/src/app.js', l1, 's-egoweb', state(), '/work/proj') || '', /L1 decision gate/, 'a sibling repo named ego-web');
  assert.equal(checkDecision('/home/u/ego-scripts/r.mjs', l1, 's-egoweb', state(), '/work/proj'), null, 'ego-scripts');
  const full = call('Bash', { command: 'node --test tests/*.test.mjs' }, NODE_RED, true);
  const failed = (g) => (g.missing || []).some((m) => /a test after the last code change failed/.test(m));
  assert.equal(failed(judge([...L2_EDIT, ...full, ...call('Bash', { command: 'pnpm exec vitest run tests/hooks.test.mjs -t "other case"' }, 'Tests  1 passed')])), true, 'a run narrowed to one case clears nothing');
  assert.equal(failed(judge([...L2_EDIT, ...full, ...call('Bash', { command: 'node --test tests/hooks.test.mjs' }, 'ℹ pass 12\nℹ fail 0')])), false, 'the whole file does');
});

// ---- review of level 3: a script that only has the name of a framework CLI is not that CLI ----
test('30 (review): node running a file called vite.js or next.js of the project is no framework CLI; one under node_modules or a bin folder is', () => {
  assert.equal(isBuild('node scripts/vite.js build'), false, 'the project\'s own script');
  assert.equal(isBuild('node tools/next.js build'), false);
  assert.equal(isBuild('node ./node_modules/vite/bin/vite.js build'), true, 'the package\'s bin');
  assert.equal(isBuild('node ./node_modules/@angular/cli/bin/ng build'), true);
  assert.equal(isBuild('node ./node_modules/@nestjs/cli/bin/nest.js build'), true);
  assert.equal(isBuild('node ./node_modules/typescript/bin/tsc -p tsconfig.build.json --outDir out'), true);
  assert.equal(isBuild('node ./bin/ng build'), true, 'a bin folder of the project holding the CLI');
});
