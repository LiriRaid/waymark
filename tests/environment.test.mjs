// Waymark 2.0.19 · point 11: the safety of the user's environment: their account and pull requests are theirs, a repository the ask does not name is
// asked first, a project's own migration script comes first, what the user chose in the window is answered in the Cierre, and the public signers
// carry no address. Synthetic copies of the patterns: a logic case, a CSS/HTML case and the counter-example for each. Run: node --test tests/environment.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.env.WAYMARK_REVIEW_MODE = 'always';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = process.env.WAYMARK_HOME;
process.env.WAYMARK_ENGRAM = '';
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const T = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { cierreGaps, outcome, reposNotNamed, namedRepos } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { currentTurn } = await import(`file://${SCRIPTS}/transcript.mjs`);
const V = await import(`file://${SCRIPTS}/verify.mjs`);
const { repoOf } = await import(`file://${SCRIPTS}/lib/paths.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const mk = (files = {}, memory = '# P\n\n## Work in progress\n') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-env-')); temps.push(d); gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark')); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), memory);
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  gitT(d, 'add', '-A'); gitT(d, 'commit', '-q', '-m', 'base');
  return d;
};
const hookRun = (script, payload) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(SCRIPTS, script)], { env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => { c.kill(); resolve({ out, killed: true }); }, 20000);
  c.on('close', () => { clearTimeout(timer); resolve({ out, killed: false }); });
  c.stdin.end(JSON.stringify(payload));
});
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text }] } });
let ids = 0;
const call = (name, input) => { const id = `u${++ids}`; return [{ type: 'assistant', timestamp: at(), message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }]; };
const answered = (question, labels, chosen) => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } });

// ---- the account and the pull requests are the user's ----
test('11: logic — switching or logging into a gh account is denied always; a pull request only when the task asks for one', () => {
  for (const c of ['gh auth switch -u otra-cuenta', 'gh auth login', 'cd api && gh auth logout', 'gh auth setup-git'])
    assert.match(T.checkGh(c, 'abre el PR de este cambio'), /changing the gh account.*is the user's/, `${c}: even when the task asks for a PR`);
  assert.match(T.checkGh('gh pr create --title "x"', 'agrega reintentos al servicio'), /opening or merging a pull request is the user's/);
  assert.match(T.checkGh('gh pr merge 12 --squash', 'revisa el diff'), /is the user's/);
  assert.equal(T.checkGh('gh pr create --title "x"', 'abre el PR de este cambio'), null, 'asked for: it goes through');
  for (const c of ['gh auth status', 'gh pr view 12', 'gh pr list', 'git commit -m "gh pr create is the user\'s"', "git commit -F - <<'EOF'\ngh auth switch is denied\nEOF"])
    assert.equal(T.checkGh(c, 'agrega reintentos'), null, `counter-example: ${c}`);
});
test('11: the gh guard sees past a prefix and a negation, and "merge" alone opens nothing', () => {
  for (const c of ['GH_TOKEN=x gh pr create --fill', 'command gh auth switch -u x', '& gh pr create', 'gh.exe auth switch', 'sudo gh auth login', 'cd api && gh.exe pr create'])
    assert.ok(T.checkGh(c, 'agrega reintentos'), c);
  assert.ok(T.checkGh('gh pr create --fill', 'no abras el PR todavía, solo deja el cambio'), 'a denied PR is not asked for');
  assert.ok(T.checkGh('gh pr create --fill', 'resuelve el conflicto de merge'), '"merge" alone does not open one');
  assert.equal(T.checkGh('gh pr merge 4', 'mergea el PR 4'), null, 'counter-example: merging one that was asked to merge');
  assert.equal(T.checkGh('gh pr create --fill', 'ajusta el botón y abre el PR'), null, 'counter-example: asked');
});
test('11: CSS/HTML — the same for a styles task: its PR is not opened unasked, a `gh pr view` of it is read freely', async () => {
  const d = mk({ 'src/app.css': 'a{}\n' });
  const run = (command, text) => {
    const lines = [prompt(text), say('Waymark → L1 · dept-frontend')];
    const file = path.join(d, 't.jsonl'); fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return hookRun('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: d, session_id: 's-gh', transcript_path: file });
  };
  assert.match((await run('gh pr create --fill', 'ajusta el color del botón')).out, /opening or merging a pull request is the user's/);
  assert.match((await run('gh auth switch -u x', 'ajusta el color del botón')).out, /changing the gh account/);
  assert.ok(!/is the user's/.test((await run('gh pr view 3', 'ajusta el color del botón')).out), 'counter-example: reading one is free');
  assert.ok(!/opening or merging/.test((await run('gh pr create --fill', 'ajusta el botón y abre el pull request')).out), 'counter-example: asked for');
});

// ---- a repository the request does not name is asked first ----
const stateFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-gate-')), 'repo.json');
test('11: logic — a change in a repo the Pedido does not name is denied once, with the way out; one it names (or the user named in the window) is not', () => {
  const lines = (...more) => [prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend'), ...more];
  const f = stateFile();
  const deny = T.checkRepo('/work/api', '/work/web', lines(), 's1', f);
  assert.match(deny, /this change is in api, a repository the task's request does not name \(the session works in web\).*Repos: <each repo/);
  assert.equal(T.checkRepo('/work/api', '/work/web', lines(), 's1', f), null, 'asked once: the same repo again goes through');
  assert.equal(T.checkRepo('/work/web', '/work/web', lines(), 's2', stateFile()), null, 'counter-example: the session\'s own repo is never judged');
  assert.equal(T.checkRepo('/work/api', '/work/web', lines(say('Pedido: 1) uno · 2) dos\nRepos: web, api')), 's3', stateFile()), null, 'named in the Pedido');
  assert.equal(T.checkRepo('/work/api', '/work/web', lines(answered('¿Toco también api?', ['Sí, api', 'No'], 'Sí, api')), 's4', stateFile()), null, 'the user named it in the window');
  assert.ok(T.checkRepo('/work/api', '/work/web', lines(say('Repos: api-gateway')), 's5', stateFile()), 'a longer name is not this name');
});
test('11: the repo question is asked once per task, Waymark\'s own copies and a submodule are no other repository', () => {
  const lines = [prompt('ajusta el servicio'), say('Waymark → L2 · dept-backend')];
  const f = stateFile();
  assert.ok(T.checkRepo('/work/api', '/work/web', lines, 's1', f, '1000'));
  assert.equal(T.checkRepo('/work/api', '/work/web', lines, 's1', f, '1000'), null, 'the same task: once');
  assert.ok(T.checkRepo('/work/api', '/work/web', lines, 's1', f, '2000'), 'a later task of the session asks again');
  const C = path.join(process.env.WAYMARK_HOME, 'tmp', '1');
  assert.equal(T.checkRepo(C, '/work/web', lines, 's9', stateFile(), '1'), null, 'a clean copy Waymark made is not the user\'s repository');
  const a = mk({ 'src/a.mjs': 'a\n' }), sub = path.join(a, 'vendor', 'lib');
  fs.mkdirSync(path.join(a, '.git', 'modules', 'lib'), { recursive: true }); fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, '.git'), `gitdir: ${path.join(a, '.git', 'modules', 'lib')}\n`);
  assert.equal(repoOf(path.join(sub, 'x.mjs')).toLowerCase(), a.toLowerCase(), 'a submodule belongs to the project');
  const sib = path.join(a, 'sibling'); fs.mkdirSync(sib); gitT(sib, 'init', '-q');
  assert.equal(repoOf(path.join(sib, 'x.mjs')).toLowerCase(), sib.toLowerCase(), 'counter-example: a nested repository of its own is another');
});
test('11: CSS/HTML — through the hook: an edit of a stylesheet in a sibling repo asks first; the same edit in the own repo does not', async () => {
  const a = mk({ 'src/a.css': 'a{}\n' }), b = path.join(a, 'sibling');
  fs.mkdirSync(path.join(b, 'src'), { recursive: true }); gitT(b, 'init', '-q'); fs.writeFileSync(path.join(b, 'src', 'b.css'), 'b{}\n');
  const file = path.join(a, 't.jsonl');
  fs.writeFileSync(file, [prompt('ajusta el estilo'), say('Waymark → L1 · dept-frontend'), ...call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['A', 'B'], 'A')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const edit = (p, session) => hookRun('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: p }, cwd: a, session_id: session, transcript_path: file });
  assert.match((await edit(path.join(b, 'src', 'b.css'), 's-repo')).out, /this change is in sibling, a repository the task's request does not name/);
  assert.ok(!/does not name/.test((await edit(path.join(a, 'src', 'a.css'), 's-repo-own')).out), 'counter-example: the own repo');
});
test('11: the end-of-turn hook records a changed repo the Pedido never named, and what it named', () => {
  const a = mk({ 'src/a.mjs': 'a\n' }), b = path.join(a, 'sibling');
  fs.mkdirSync(path.join(b, 'src'), { recursive: true }); gitT(b, 'init', '-q'); fs.writeFileSync(path.join(b, 'src', 'b.mjs'), 'b\n');
  assert.deepEqual(reposNotNamed([path.join(b, 'src', 'b.mjs'), path.join(a, 'src', 'a.mjs')], a, []), ['sibling']);
  assert.deepEqual(reposNotNamed([path.join(b, 'src', 'b.mjs')], a, namedRepos(['Pedido: 1) x · 2) y · Repos: sibling'])), [], 'named');
  assert.deepEqual(reposNotNamed([path.join(b, 'src', 'b.mjs')], a, [], '¿Toco sibling? Sí'), [], 'named in the window');
  assert.deepEqual(reposNotNamed([path.join(a, 'src', 'a.mjs')], a, []), [], 'counter-example: only the own repo');
  assert.deepEqual(namedRepos(['Repos: web, api y gateway']), ['web', 'api', 'gateway']);
});

// ---- the project's own migration script comes first ----
const CONV = '# P\n\n## Conventions specific to this project\n- Migrations: bin/migrate new <name> (it backs up the database first)\n';
test('11: logic — a migration file written by hand where the project has its own script is denied once, naming the script; an edit, or another folder, is not', () => {
  const d = mk({ 'db/migrate/001_a.rb': 'a\n', 'src/a.rb': 'a\n' }, CONV);
  const f = path.join(d, 'db', 'migrate', '002_b.rb'), sf = path.join(d, 'm.json');
  assert.match(T.checkMigration(f, CONV, 's1', sf), /migrates with its own script \(Conventions: "Migrations: bin\/migrate new <name>/);
  assert.equal(T.checkMigration(f, CONV, 's1', sf), null, 'asked once per file');
  assert.equal(T.checkMigration(path.join(d, 'db', 'migrate', '001_a.rb'), CONV, 's2', sf), null, 'counter-example: editing a migration that exists');
  assert.equal(T.checkMigration(path.join(d, 'src', 'b.rb'), CONV, 's3', sf), null, 'counter-example: not a migrations folder');
  assert.equal(T.checkMigration(f, '# P\n\n## Conventions\n- …\n', 's4', sf), null, 'counter-example: no script in the Conventions: nothing to prefer');
  assert.equal(T.checkMigration(f, '<!-- Migrations: bin/migrate -->\n', 's5', sf), null, 'the template\'s own example is no rule');
});
test('11: CSS/HTML — a styles file under a folder with "migrate" in a path is no migration; through the hook the file is denied', async () => {
  const d = mk({ 'db/migrate/001_a.rb': 'a\n', 'src/app.css': 'a{}\n' }, CONV);
  assert.equal(T.checkMigration(path.join(d, 'src', 'app.css'), CONV, 's1', path.join(d, 'm.json')), null);
  const file = path.join(d, 't.jsonl');
  fs.writeFileSync(file, [prompt('agrega la tabla'), say('Waymark → L2 · dept-data'), ...call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['A', 'B'], 'A')].map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = await hookRun('tool-hook.mjs', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(d, 'db', 'migrate', '002_new.rb') }, cwd: d, session_id: 's-mig', transcript_path: file });
  assert.match(r.out, /migrates with its own script/);
});

// ---- what the user chose in the window is answered in the Cierre ----
const DEC = (...chosen) => chosen.map((c) => ({ question: '¿Cómo?', chosen: c, discarded: [] }));
test('11: logic — a chosen option the Cierre does not name, or marks ✘, keeps hecho from standing; a label with two actions is flagged', () => {
  const ok = P.windowCheck(DEC('Backoff exponencial con tope'), '## Cierre · x\nResultado: hecho\nDecisión: ✔ backoff exponencial, con tope de 5 intentos');
  assert.deepEqual([ok.unanswered, ok.failed, ok.twoActions], [[], [], []]);
  const missing = P.windowCheck(DEC('Backoff exponencial con tope', 'Aplicar y ejecutar la migración'), '## Cierre · x\nResultado: hecho\nEvidencia: observada el log\nDecisión: ✔ backoff exponencial con tope');
  assert.deepEqual(missing.unanswered, ['Aplicar y ejecutar la migración']);
  assert.deepEqual(missing.twoActions, ['Aplicar y ejecutar la migración']);
  const failed = P.windowCheck(DEC('Aplicar la migración en producción'), '## Cierre · x\nResultado: hecho\n✘ aplicar la migración en producción: no hubo acceso');
  assert.deepEqual(failed.failed, ['Aplicar la migración en producción']);
  assert.equal(outcome('Resultado: hecho', [], [], 2, new Set(), missing).result, 'parcial');
  assert.equal(outcome('Resultado: hecho', [], [], 2, new Set(), failed).result, 'parcial');
  assert.equal(outcome('Resultado: hecho', [], [], 2, new Set(), ok).result, 'hecho', 'counter-example: every choice answered');
  assert.equal(outcome('Resultado: parcial (falta)', [], [], 2, new Set(), missing).result, 'parcial');
  assert.deepEqual(P.windowCheck(DEC('Otra cosa', 'Sí'), 'sin nada').unanswered, [], 'counter-example: "otra cosa" and an item with no word to look for are not judged');
  assert.deepEqual(P.windowCheck(DEC('Backoff (Recommended)', 'Cola (Recomendado)'), 'Aprendido: backoff y cola').unanswered, [], 'the window\'s own marker is not part of the choice');
});
test('11: a multi-select answer is one item per option picked', () => {
  const d = [{ question: '¿Qué?', chosen: 'Tests unitarios, Documentación del límite', discarded: [] }];
  Object.defineProperty(d[0], 'labels', { value: ['Tests unitarios', 'Documentación del límite', 'Otra cosa'], enumerable: false });
  const w = P.windowCheck(d, '## Cierre · x\nResultado: hecho\nAprendido: tests unitarios del servicio ← pedido');
  assert.deepEqual(w.items, ['Tests unitarios', 'Documentación del límite']);
  assert.deepEqual(w.unanswered, ['Documentación del límite'], 'only the option the Cierre left out');
});
test('11: CSS/HTML — the same through the end-of-turn judgment: the finding is recorded, the task is not blocked for it', () => {
  const lines = [prompt('ajusta el botón'), say('Waymark → L2 · dept-frontend'), ...call('Skill', { skill: 'dept-frontend' }), ...call('Read', { file_path: '/skills/dept-frontend/procedures.md' }), ...call('Bash', { command: 'node "/s/waymark/scripts/waymark.mjs" pack src/app.css' }),
    ...call('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Ancho fijo de 40 px', 'Ancho automático'], 'Ancho fijo de 40 px'), ...call('Edit', { file_path: '/work/proj/src/app.css' })];
  const cierre = '## Cierre · 2026-10-25 · T1\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el botón)\nAprendido: x ← y';
  const g = cierreGaps(currentTurn(lines), cierre, undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: P.decisionsIn(lines), cwd: '/work/proj' });
  assert.ok(g.findings.some((f) => /does not answer what the user chose in the window.*Ancho fijo de 40 px/.test(f)));
  assert.ok(!g.missing.some((m) => /window|choice/.test(m)), 'recorded, never blocked');
  const named = cierreGaps(currentTurn(lines), cierre.replace('Resultado: hecho', 'Resultado: hecho\nDecisión: ✔ ancho fijo de 40 px'), undefined, undefined, { ids: P.taskIds('/nowhere'), decisions: P.decisionsIn(lines), cwd: '/work/proj' });
  assert.ok(!named.findings.some((f) => /does not answer what the user chose/.test(f)), 'counter-example: named in the Cierre');
});

// ---- the public signers carry no address, and the release still verifies ----
test('11: the public ALLOWED_SIGNERS names its key under a wildcard principal, never an address', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'ALLOWED_SIGNERS'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.ok(lines.length >= 1 && lines.every((l) => /^\* ssh-ed25519 \S+/.test(l)), lines.join('|').slice(0, 80));
  assert.ok(!lines.join('\n').includes('@'), 'no address');
});
test('11: git verifies a tag signed by the key under the wildcard principal, and calls any other key untrusted', () => {
  const keys = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-keys-')); temps.push(keys);
  const key = (n) => { const f = path.join(keys, n); spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', n, '-f', f]); return f; };
  const mine = key('mine'), other = key('other');
  const pub = (f) => fs.readFileSync(`${f}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ');
  const allowed = path.join(keys, 'ALLOWED_SIGNERS'); fs.writeFileSync(allowed, `# keys\n* ${pub(mine)}\n`);
  const d = mk({ 'a.txt': 'x' });
  const tag = (name, k) => gitT(d, '-c', 'gpg.format=ssh', '-c', `user.signingkey=${k}`, 'tag', '-s', '-m', name, name);
  assert.equal(tag('v1', mine).status, 0, tag('v1x', mine).stderr);
  assert.equal(tag('v2', other).status, 0);
  const a = V.signatureState(d, 'v1', { tag: true, allowed });
  assert.equal(a.state, 'signed', JSON.stringify(a));
  assert.equal(V.signatureState(d, 'v2', { tag: true, allowed }).state, 'untrusted', 'counter-example: a key the file does not hold');
});
