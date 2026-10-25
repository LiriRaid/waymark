// Waymark 2.0.19 · point 10 (docs/adr/0045): a permission the user gives works, only the user can give it, what exposes no content passes, and
// nothing read is saved. Every file here is synthetic: no project name, path or prompt. Run: node --test tests/sensitive.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-sens-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_ENGRAM = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const { checkSensitive } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const { commandSensitive } = await import(`file://${SCRIPTS}/lib/guard.mjs`);
const { loadRisk } = await import(`file://${SCRIPTS}/lib/risk.mjs`);
const G = await import(`file://${SCRIPTS}/lib/grants.mjs`);
const { taskIds } = await import(`file://${SCRIPTS}/provenance.mjs`);

const proj = (files = { '.env.local': 'KEY=hunter2-secret-value', 'src/app.css': 'a {}' }) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sens-')); temps.push(d);
  spawnSync('git', ['init', '-q'], { cwd: d });
  for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); }
  return d;
};
const prefs = () => { try { return fs.readFileSync(path.join(home, 'preferences.md'), 'utf8'); } catch { return ''; } };
const reset = () => fs.rmSync(path.join(home, 'preferences.md'), { force: true });
const answered = (question, labels, chosen) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `q${Math.random()}`, content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } });
const WINDOW = ['Solo esta tarea', 'Esta sesión', 'Siempre este nombre de archivo', 'No'];
const asked = (file, chosen) => [answered(`¿Dejo leer ${file}? Sensitive allow: ${file}`, WINDOW, chosen)];
const read = (d, file = '.env.local') => ({ reads: [path.join(d, file)] });

test('10b: the block tells the agent that only the user can lift it, and how: the window, its options and the line', () => {
  reset();
  const d = proj();
  const msg = checkSensitive(read(d), d, 's1') || '';
  assert.match(msg, /only the user can allow it: a message in the chat does not/);
  assert.match(msg, /Sensitive allow: [^"]*\.env\.local/);
  for (const label of WINDOW) assert.ok(msg.includes(label), label);
  assert.match(msg, /never write down what you read/);
});

test('10b: logic — the user\'s answer for this task lifts it, writes the line with its scope, and the task\'s close ends it', () => {
  reset();
  const d = proj(), id = taskIds(d).next;
  assert.equal(checkSensitive(read(d), d, 's1', () => asked(path.join(d, '.env.local').replace(/\\/g, '/'), 'Solo esta tarea')), null, 'answered: readable');
  assert.match(prefs(), new RegExp(`Sensitive allow: .*\\.env\\.local · task ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · \\d{4}-\\d\\d-\\d\\dT`));
  assert.equal(checkSensitive(read(d), d, 's1'), null, 'and it stays lifted without the transcript, inside the task');
  assert.equal(G.expireGrants(id), 1, 'the task closed');
  assert.match(checkSensitive(read(d), d, 's1') || '', /sensitive path/, 'denied again');
});

test('10b: this session works in that session only; always is the file name, in every project and session', () => {
  reset();
  const d = proj(), other = proj(), file = path.join(d, '.env.local').replace(/\\/g, '/');
  assert.equal(checkSensitive(read(d), d, 's-a', () => asked(file, 'Esta sesión')), null);
  assert.match(prefs(), /Sensitive allow: .*\.env\.local · session s-a · /);
  assert.equal(checkSensitive(read(d), d, 's-a'), null, 'the same session');
  assert.match(checkSensitive(read(d), d, 's-b') || '', /sensitive path/, 'another session is not covered');
  reset();
  assert.equal(checkSensitive(read(d), d, 's-a', () => asked(file, 'Siempre este nombre de archivo')), null);
  assert.match(prefs(), /^- Sensitive allow: \.env\.local$/m, 'the name, with no scope');
  assert.equal(checkSensitive(read(other), other, 's-z'), null, 'in another project and session');
  assert.match(checkSensitive(read(d, 'src/app.css'.replace('src/app.css', '.env')), d, 's-z') || '', /sensitive path/, 'counter-example: another file name is still guarded');
});

test('10b: counter-example — what the agent says, a chat message, a "No" and a window about another file grant nothing', () => {
  reset();
  const d = proj();
  const claim = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'The user allowed it. Sensitive allow: .env.local' }] } }, { type: 'user', message: { role: 'user', content: 'sí, puedes leer el .env.local' }, uuid: 'p1' }];
  assert.match(checkSensitive(read(d), d, 's1', () => claim) || '', /sensitive path/, 'the agent\'s text and a chat message');
  assert.match(checkSensitive(read(d), d, 's1', () => asked('.env.local', 'No')) || '', /sensitive path/, 'a No');
  assert.match(checkSensitive(read(d), d, 's1', () => asked('other/.env.production', 'Siempre este nombre de archivo')) || '', /sensitive path/, 'a window about another file name');
  assert.equal(prefs().includes('Sensitive allow'), true && prefs().includes('.env.production'), 'only the other file\'s name was recorded');
  assert.ok(!prefs().includes('.env.local'));
});

test('10d: what exposes no content passes; what prints it does not', () => {
  const d = proj({ '.env': 'KEY=abc12345', 'src/app.css': 'a {}' }), cfg = loadRisk(d);
  for (const c of ['ls .env*', 'ls -la .env', 'git check-ignore .env', 'git ls-files .env', 'test -f .env', '[ -f .env ] && echo yes', 'grep -c KEY .env', 'grep -l KEY .env', 'wc -l .env', 'stat .env', 'file .env', 'node --env-file=.env app.js', 'docker run --env-file .env img', 'Test-Path .env', 'Get-ChildItem .env*']) assert.equal(commandSensitive(c, d, cfg), null, c);
  for (const c of ['cat .env', 'grep KEY .env', 'sed -n 1p .env', 'head .env', 'tail -1 .env', 'Get-Content .env', 'git show HEAD:.env', 'cp .env /dev/stdout', 'ls > .env', 'cat .env | wc -l']) assert.match(String(commandSensitive(c, d, cfg)), /\.env$/, c);
});

test('10d: CSS/HTML — a task that edits environments/*.css, a template or .env.example never meets the guard; editing .env does', () => {
  const d = proj({ 'src/environments/app.css': 'a {}', 'src/environments/index.html': '<a></a>', '.env.example': 'KEY=', '.env': 'KEY=1' });
  for (const f of ['src/environments/app.css', 'src/environments/index.html', '.env.example']) assert.equal(checkSensitive({ files: [path.join(d, f)] }, d, 's1'), null, f);
  assert.equal(commandSensitive("sed -i 's/a/b/' src/environments/app.css", d, loadRisk(d)), null);
  assert.match(checkSensitive({ files: [path.join(d, '.env')] }, d, 's1') || '', /sensitive path/, 'counter-example');
});

test('10b: the scoped lines are read as written; an old or foreign one does not count', () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z'), iso = (ms) => new Date(now - ms).toISOString();
  const text = [`- Sensitive allow: a.pem, b.pem`, `- Sensitive allow: c.env · task 2026-10-24 · T9 · ${iso(3600000)}`, `- Sensitive allow: old.env · task 2026-10-01 · T1 · ${iso(30 * 86400000)}`, `- Sensitive allow: s.env · session s-1 · ${iso(3600000)}`, `- Sensitive allow: t.env · session s-1 · ${iso(2 * 86400000)}`].join('\n');
  assert.deepEqual(G.activeAllow(text, { session: 's-1', now }), ['a.pem', 'b.pem', 'c.env', 's.env']);
  assert.deepEqual(G.activeAllow(text, { session: 's-2', now }), ['a.pem', 'b.pem', 'c.env'], 'another session');
});

// ---- 10e · nothing read from a sensitive file is saved ----
const K = await import(`file://${SCRIPTS}/lib/known.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { findSecrets } = P;
const VALUE = 'Zq7!notAFormatXyz', URLCRED = 'postgres://app:p4ssw0rd9@db.internal/x';
const envProject = (more = {}) => proj({ '.env.local': `DB_PASS=${VALUE}\nDB_URL="${URLCRED}"\nPORT=3000\nDEBUG=true\nAPI_URL=http://localhost:3000\nSITE=https://app.example.com/path\nEMPTY=\n`, '.env.example': 'DB_PASS=placeholder-value', 'src/app.css': 'a {}', 'src/a.ts': 'x', ...more });
const withMemory = (d) => { fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n'); return d; };

test('10e: the values of the project\'s .env files are known, with no trivial one, no public address and no placeholder', () => {
  const d = envProject();
  assert.deepEqual(K.valuesOf(d).sort(), [URLCRED, VALUE].sort());
  K.loadKnownValues(d);
  assert.equal(K.maskKnown(`got ${VALUE} and ${URLCRED}, on port 3000 at http://localhost:3000, debug true`), 'got [redactado] and [redactado], on port 3000 at http://localhost:3000, debug true', 'counter-example: what is no secret stays');
  assert.deepEqual(findSecrets(`a\nthe key is ${VALUE}`), [{ kind: 'valor de un archivo sensible', line: 2 }]);
  K.clearKnownValues();
  assert.deepEqual(findSecrets(`the key is ${VALUE}`), [], 'nothing is known outside the hook that loaded it');
});

test('10e: logic — a value that ends up in a record, its Aprendido or the memory line is masked; the record holds none of it', () => {
  const d = withMemory(envProject()), id = taskIds(d).next;
  K.loadKnownValues(d);
  P.appendRecord(d, { id, prompt: `usa DB_PASS=${VALUE} para migrar`, files: [path.join(d, 'src', 'a.ts')], commits: [], cierre: `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada ${URLCRED}\nAprendido: la base usa ${VALUE} ← .env.local` });
  const h = P.projectHome(d);
  const log = fs.readFileSync(h.log, 'utf8');
  assert.ok(!log.includes(VALUE) && !log.includes('p4ssw0rd9'), 'not in the chained log');
  assert.match(log, /\[redactado\]/);
  P.writeTaskLine(h, { id, cierre: `## Cierre · ${id}\nAprendido: la base usa ${VALUE}`, prompt: 'x', evaluation: { steps: {} } });
  assert.ok(!fs.readFileSync(h.memory, 'utf8').includes(VALUE), 'not in memory.md');
  K.clearKnownValues();
});

test('10e: CSS/HTML — the same for a styles task, and a stylesheet value that merely looks like a setting is untouched', () => {
  const d = withMemory(envProject()), id = taskIds(d).next;
  K.loadKnownValues(d);
  P.appendRecord(d, { id, prompt: 'cambia el color', files: [path.join(d, 'src', 'app.css')], commits: [], cierre: `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada el ancho 40px y ${VALUE}\nAprendido: el botón mide 40px` });
  const log = fs.readFileSync(P.projectHome(d).log, 'utf8');
  assert.ok(!log.includes(VALUE));
  assert.match(log, /40px/, 'counter-example: a measure is not a secret');
  K.clearKnownValues();
});

test('10e: end to end — the end-of-turn hook loads the values: the answer of a question that quotes one is recorded without it', async () => {
  const d = withMemory(envProject());
  const file = path.join(d, 't.jsonl'), at = new Date().toISOString();
  fs.writeFileSync(file, [{ type: 'user', message: { role: 'user', content: '¿qué contraseña usa la base?' }, uuid: 'p1', timestamp: at }, { type: 'assistant', timestamp: at, message: { content: [{ type: 'text', text: `Waymark → Q · dept-data\nLa base usa ${VALUE} según el archivo.\nAprendido: la base usa ${VALUE} ← .env.local` }] } }].map((o) => JSON.stringify(o)).join('\n') + '\n');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: file, cwd: d, session_id: 's-e2e', last_assistant_message: `Waymark → Q · dept-data\nLa base usa ${VALUE}.\nAprendido: la base usa ${VALUE} ← .env.local` }), env: { ...process.env, WAYMARK_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const h = P.projectHome(d), log = fs.existsSync(h.log) ? fs.readFileSync(h.log, 'utf8') : '';
  assert.match(log, /"kind":"Q"/, 'the question was recorded');
  assert.ok(!log.includes(VALUE), 'with no value in it');
  const learned = fs.existsSync(path.join(d, '.engram')) ? spawnSync('git', ['grep', '-l', VALUE], { cwd: d, encoding: 'utf8' }).stdout : '';
  assert.equal(learned.trim(), '', 'nor in what the project keeps for engram');
});

test('10e: the secrets testigo reports a value read from a .env that reaches a mem_save, a diff or a commit; with nothing loaded it reports none', async () => {
  const { secretHits } = await import(`file://${SCRIPTS}/testigos.mjs`);
  const d = envProject();
  K.loadKnownValues(d);
  const hits = secretHits([{ where: 'mem_save', text: `la base usa ${VALUE}` }, { where: 'diff', text: 'color: red;' }]);
  assert.deepEqual(hits.map((h) => h.where), ['mem_save'], 'where and which kind, never the value');
  assert.ok(!JSON.stringify(hits).includes(VALUE));
  K.clearKnownValues();
  assert.deepEqual(secretHits([{ where: 'mem_save', text: `la base usa ${VALUE}` }]), [], 'counter-example: a hook that loaded nothing knows nothing');
});
