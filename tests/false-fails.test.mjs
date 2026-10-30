// Waymark 2.0.3 · point 3: no false ✘ (the routine passes when the work was done). Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME and temporary repos; nothing reads or writes the real ~/.waymark.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-false-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const { cierreGaps, pausedReply } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const { packContext, commandFiles, commandRepos } = await import(`file://${SCRIPTS}/tool-hook.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);
const cx = await import(`file://${SCRIPTS}/agents/codex.mjs`);
const claude = await import(`file://${SCRIPTS}/agents/claude.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
// outside the temp folder: the hooks exempt temp paths from the routine
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-false-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
let ids = 0, n = 0;
const prompt = (text, at) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at, message: { role: 'user', content: text } });
const say = (text, at) => ({ type: 'assistant', timestamp: at, message: { content: [{ type: 'text', text }] } });
const run = (name, input, { error = false, out = 'ok' } = {}) => {
  const id = `u${++ids}`;
  return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: error }] } }];
};
const sh = (command, opts) => run('Bash', { command }, opts);
const answered = (question, labels, chosen) => ({ type: 'user', message: { content: [{ type: 'tool_result', content: 'answered' }] }, toolUseResult: { questions: [{ question, options: labels.map((label) => ({ label })) }], answers: { [question]: chosen } } });
const FILE = '/work/proj/src/orders.service.mjs';
const opening = () => [prompt('agrega reintentos'), say('Waymark → L1 · dept-backend · skills: ninguna'), ...run('Skill', { skill: 'dept-backend' }), ...run('Read', { file_path: '/skills/dept-backend/procedures.md' }),
  ...run('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff')];
const cierre = (id) => `## Cierre · ${id}\nResultado: hecho\nEvidencia: observada timeouts en el log de pedidos\nAprendido: backoff ← timeouts`;
const judge = (lines, more = {}) => { const cwd = `/work/false-${++n}`, id = P.taskIds(cwd).next; return cierreGaps(T.currentTurn(lines), cierre(id), undefined, undefined, { ids: P.taskIds(cwd), decisions: [{ question: '¿Cómo?', chosen: 'Backoff', discarded: ['Cola'] }], ...more }); };
const step = (g, id) => g.steps.find((s) => s.id === id);

test('Recordar por shell: the files a shell command names get their pack before it runs', async () => {
  const repo = withMemory(repoAt('pack'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.mjs'), 'x');
  fs.writeFileSync(path.join(repo, 'src', 'b.mjs'), 'y');
  const rel = (list) => list.map((f) => path.relative(repo, f).replace(/\\/g, '/')).sort();
  assert.deepEqual(rel(commandFiles("sed -i 's/x/z/' src/a.mjs", repo)), ['src/a.mjs']);
  assert.deepEqual(rel(commandFiles('cd src && rm -f b.mjs', repo)), ['src/b.mjs'], 'relative to the cd before it');
  assert.deepEqual(rel(commandFiles('echo 1 > src/new.txt && git checkout -- src/a.mjs', repo)), ['src/a.mjs', 'src/new.txt'], 'a redirect target, even a new file');
  assert.deepEqual(rel(commandFiles("cat > src/c.mjs <<'EOF'\nsrc/b.mjs\nEOF", repo)), ['src/c.mjs'], 'a heredoc body names nothing');
  assert.deepEqual(commandFiles('rm -rf missing/', repo), [], 'nothing that exists, nothing named');
  const file = path.join(home, 'packed-shell.json');
  const text = await packContext({ tool_name: 'Bash', tool_input: { command: "sed -i 's/x/z/' src/a.mjs" }, cwd: repo, session_id: 's-pack' }, claude, file);
  assert.match(text || '', /src\/a\.mjs/);
  const again = await packContext({ tool_name: 'Bash', tool_input: { command: "sed -i 's/z/w/' src/a.mjs" }, cwd: repo, session_id: 's-pack' }, claude, file);
  assert.equal(again, null, 'once per file and task');
  assert.equal(await packContext({ tool_name: 'Bash', tool_input: { command: 'ls src' }, cwd: repo, session_id: 's-pack' }, claude, file), null, 'a command that changes nothing gets no pack');
});

test('Recordar tardío: a pack run after the first change no longer blocks; it is recorded late', () => {
  const late = judge([...opening(), ...run('Edit', { file_path: FILE }), ...sh('node "/s/waymark.mjs" pack src/orders.service.mjs'), ...sh('node --check src/orders.service.mjs')]);
  assert.ok(!late.missing.some((m) => /project memory/.test(m)), late.missing.join(' | '));
  assert.equal(step(late, 'memory').pass, false);
  assert.ok(late.findings.some((f) => /after the task's first change/.test(f)));
  const never = judge([...opening(), ...run('Edit', { file_path: FILE }), ...sh('node --check src/orders.service.mjs')]);
  assert.ok(never.missing.some((m) => /project memory/.test(m)), 'no pack at all still blocks');
});

test('task start: the per-prompt mark starts the task (first task of a session too); a close or a Q clears it', () => {
  const s = `s-start-${Math.random()}`;
  assert.equal(P.taskStart([], s), 0);
  const at = Date.now();
  P.markTaskStart(s, at);
  P.markTaskStart(s, at + 50000);
  assert.equal(P.taskStart([], s), at - 1000, 'the first prompt of the task; a later prompt keeps it');
  assert.equal(P.taskStart([{ id: '2026-10-12 · T1', session: s, at: new Date(at + 9000).toISOString() }], s), at + 9000, 'a close after it wins');
  assert.equal(P.taskStart([{ id: '2026-10-12 · T1', session: s, at: new Date(at - 9000).toISOString() }], s, '2026-10-12 · T1b'), 0, 'a follow-up reaches back to its task');
  P.clearTaskStart(s);
  assert.equal(P.taskStart([], s), 0);
  // four prompts in the task: the decision asked at the first one is still the task's
  const t0 = Date.parse('2026-10-12T10:00:00Z');
  const ts = (k) => new Date(t0 + k * 1000).toISOString();
  const lines = [prompt('arma el modal', ts(1)), say('Waymark → L2 · dept-frontend', ts(2)), { ...answered('¿Estilo?', ['A', 'B'], 'A'), timestamp: ts(3) },
    prompt('ok', ts(4)), prompt('sigue', ts(5)), prompt('y el botón', ts(6)), say('listo', ts(7))];
  assert.equal(P.decisionsIn(P.taskLines(lines)).length, 0, 'without the mark: only the last 3 prompts');
  assert.equal(P.decisionsIn(P.taskLines(lines, { since: t0 })).length, 1, 'from the mark: the whole task');
});

test('long turns: readTurns reads back until it reaches the task start, not only 3 prompts', () => {
  const t0 = Date.parse('2026-10-12T10:00:00Z');
  const all = Array.from({ length: 40 }, (_, k) => (k % 4 === 0 ? prompt(`p${k}`, new Date(t0 + k * 1000).toISOString()) : say(`r${k}`, new Date(t0 + k * 1000).toISOString())));
  const read = (bytes) => all.slice(-Math.ceil(bytes / 100)); // 100 bytes a line
  const short = T.readTurns(read, 3, 400);
  assert.equal(short.filter(T.isPrompt).length, 4, 'three prompts are enough without a start (4 lines a prompt, doubling)');
  assert.ok(Date.parse(short[0].timestamp) > t0 + 5000, 'so the start stays out of view');
  const back = T.readTurns(read, 3, 400, 64 * 1024, t0 + 5000);
  assert.ok(Date.parse(back[0].timestamp) <= t0 + 5000, 'with the start: reads back to it');
});

test('other repos: the first shell change that enters another repo snapshots it first; the close sees its files', () => {
  const fe = withMemory(repoAt('fe')), api = repoAt('api');
  fs.writeFileSync(path.join(api, 'a.rb'), 'x'); gitT(api, 'add', '.'); gitT(api, 'commit', '-q', '-m', 'x');
  assert.deepEqual(commandRepos(`cd ${api.replace(/\\/g, '/')} && sed -i s/x/y/ a.rb`, fe).map((d) => path.resolve(d)), [path.resolve(api)]);
  assert.deepEqual(commandRepos(`git -C "${api}" checkout -- a.rb`, fe).map((d) => path.resolve(d)), [path.resolve(api)]);
  assert.deepEqual(commandRepos('sed -i s/x/y/ b.ts', fe), [], 'the session repo itself is in the snapshot already');
  const s = `s-repos-${Math.random()}`;
  P.saveSnapshot(s, fe);
  P.addRepoSnapshot(s, api);
  fs.writeFileSync(path.join(api, 'a.rb'), 'y');
  assert.deepEqual(P.turnChanged(s, fe).map((f) => path.basename(f)), ['a.rb']);
  P.saveSnapshot(s, fe);
  assert.deepEqual(P.turnChanged(s, fe), [], 'a new prompt starts clean');
});

test('repos with no typecheck: a green test after the last change is the gate', () => {
  const tested = judge([...opening(), ...sh('node "/s/waymark.mjs" pack x'), ...run('Edit', { file_path: FILE }), ...sh('bundle exec rspec spec/models')]);
  assert.ok(!tested.missing.some((m) => /no typecheck/.test(m)), tested.missing.join(' | '));
  assert.match(tested.observed.gate?.cmd || '', /rspec/);
  const red = judge([...opening(), ...sh('node "/s/waymark.mjs" pack x'), ...run('Edit', { file_path: FILE }), ...sh('bundle exec rspec spec/models', { error: true, out: '3 examples, 1 failure' })]);
  assert.ok(red.missing.some((m) => /failed/.test(m)), 'a red test is no gate');
  const typed = judge([...opening(), ...sh('node "/s/waymark.mjs" pack x'), ...run('Edit', { file_path: FILE }), ...sh('npm test')], { rerun: () => ({ cmd: 'npx tsc --noEmit', ok: false, s: 3 }) });
  assert.ok(typed.missing.some((m) => /tsc/.test(m)), 'a repo with a typecheck is still judged by it');
});

test('pauses: a reply with no Cierre that ends asking with options is a task in progress; "¿Algo más?" is not', () => {
  assert.ok(pausedReply('Cambié el servicio.\n\n¿Sigo con backoff o con una cola?'));
  assert.ok(pausedReply('Listo el primer paso.\nOpciones:\n1) Backoff (recomendado)\n2) Cola\n¿Cuál prefieres?'));
  assert.ok(!pausedReply('Hecho. ¿Algo más?'), 'no options: not a pause');
  assert.ok(!pausedReply('¿Backoff o cola?\n\nLo aplico con backoff.'), 'the reply does not end asking');
  assert.ok(!pausedReply('## Cierre · 2026-10-12 · T1\nResultado: parcial\n\n¿Sigo con backoff o con una cola?'), 'a Cierre closes it');
  // the snapshot survives the pause: the next turn sees the files the paused one changed
  const repo = withMemory(repoAt('pause'));
  fs.writeFileSync(path.join(repo, 'a.mjs'), 'x'); gitT(repo, 'add', '.'); gitT(repo, 'commit', '-q', '-m', 'x');
  const s = `s-pause-${Math.random()}`;
  P.saveSnapshot(s, repo);
  fs.writeFileSync(path.join(repo, 'a.mjs'), 'y');
  P.markPaused(s);
  P.saveSnapshot(s, repo); // the user's answer: the per-prompt hook keeps the paused task's snapshot
  assert.deepEqual(P.turnChanged(s, repo).map((f) => path.basename(f)), ['a.mjs']);
  P.saveSnapshot(s, repo);
  assert.deepEqual(P.turnChanged(s, repo), [], 'once resumed, prompts snapshot again');
});

test('codex chat: only the questions a message ends asking, with options, are decisions', () => {
  const row = (type, payload) => ({ type, timestamp: new Date(Date.now() + ++n).toISOString(), payload });
  const user = (t, i, text) => row('event_msg', { type: 'item_completed', turn_id: t, item: { type: 'UserMessage', id: i, content: [{ type: 'text', text }] } });
  const msg = (t, text) => row('event_msg', { type: 'item_completed', turn_id: t, item: { type: 'AgentMessage', content: [{ type: 'text', text }] } });
  const asked = (rows) => P.decisionsIn(P.taskLines(cx.toLines(rows))).map((d) => d.question);
  assert.deepEqual(asked([user('t1', 'i1', 'x'), msg('t1', 'Listo, apliqué el cambio. ¿Algo más?'), user('t2', 'i2', 'sí, agrega logs')]), [], 'no options: no decision');
  assert.deepEqual(asked([user('t1', 'i1', 'x'), msg('t1', '¿Qué hace este servicio? Revisé y aplico backoff.'), user('t2', 'i2', 'ok')]), [], 'a question that does not end the message');
  assert.deepEqual(asked([user('t1', 'i1', 'x'), msg('t1', 'Opciones: 1) Backoff (recomendado) 2) Cola.\n¿Cuál prefieres?'), user('t2', 'i2', 'backoff')]), ['¿Cuál prefieres?']);
  assert.deepEqual(asked([user('t1', 'i1', 'x'), msg('t1', '1) ¿Backoff o cola?\n2) ¿Cuántos reintentos?'), user('t2', 'i2', 'backoff, 3')]), ['1) ¿Backoff o cola?', '2) ¿Cuántos reintentos?']);
});

test('/compact: the summary that continues a session is not a prompt', () => {
  assert.equal(T.isPrompt({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'resumen' } }), false);
  assert.equal(T.isPrompt({ type: 'user', message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context. Summary: …' } }), false);
  assert.equal(T.isPrompt({ type: 'user', message: { role: 'user', content: 'sigue con el punto 3' } }), true);
});

test('procedures by the hook: the owner\'s procedures.md goes in once per task at the first change, and the delivery counts as the read', async () => {
  const repo = withMemory(repoAt('proc'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.mjs'), 'x');
  fs.writeFileSync(path.join(repo, 'src', 'b.mjs'), 'y');
  const transcript = path.join(home, 'proc-session.jsonl');
  fs.writeFileSync(transcript, [prompt('agrega reintentos', '2026-10-15T10:00:00Z'), ...run('Skill', { skill: 'dept-backend', args: 'L1' })].map((l) => JSON.stringify(l)).join('\n'));
  const file = path.join(home, 'packed-proc.json');
  const call = (f) => ({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', f) }, cwd: repo, session_id: 's-proc', transcript_path: transcript });
  const first = await packContext(call('a.mjs'), claude, file);
  assert.match(first || '', /Waymark procedures of dept-backend/);
  assert.match(first || '', /Waymark memory for the file/);
  const second = await packContext(call('b.mjs'), claude, file);
  assert.doesNotMatch(second || '', /Waymark procedures/, 'once per task and department');
  assert.match(second || '', /src\/b\.mjs/, 'the next file still gets its pack');
  const { procDelivered } = await import(`file://${SCRIPTS}/lib/packed.mjs`);
  assert.deepEqual([...procDelivered('s-proc', 0, file)], ['dept-backend']);
  // no department invoked yet, or no transcript (an agent without it): nothing is handed over
  const bare = await packContext({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', 'a.mjs') }, cwd: repo, session_id: 's-proc-2' }, claude, path.join(home, 'packed-proc2.json'));
  assert.doesNotMatch(bare || '', /Waymark procedures/);
});

// The department loaded after the first change (a Stop asked for it) hands its own procedures at the load: no edit follows to carry them.
test('procedures at the department load: a Skill dept-* call (or a read of its SKILL.md) hands that department\'s procedures.md; late after a change', async () => {
  const repo = withMemory(repoAt('load'));
  fs.mkdirSync(path.join(repo, 'src'));
  for (const f of ['a.css', 'b.html', 'c.mjs']) fs.writeFileSync(path.join(repo, 'src', f), 'x');
  const transcript = path.join(home, 'load-session.jsonl');
  fs.writeFileSync(transcript, [prompt('ajusta el botón', '2026-10-21T19:20:00Z'), ...run('Skill', { skill: 'dept-qa' })].map((l) => JSON.stringify(l)).join('\n'));
  const { procDelivered, procLate } = await import(`file://${SCRIPTS}/lib/packed.mjs`);
  const at = (session) => ({ cwd: repo, session_id: session, transcript_path: transcript });
  // CSS/HTML: the stylesheet changed first (the session's last department went in), then the owner is loaded: its procedures go in, late
  const file = path.join(home, 'packed-load.json');
  const edit = await packContext({ ...at('s-load'), tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', 'a.css') } }, claude, file);
  assert.match(edit || '', /Waymark procedures of dept-qa/);
  const load = await packContext({ ...at('s-load'), tool_name: 'Skill', tool_input: { skill: 'dept-frontend' } }, claude, file);
  assert.match(load || '', /Waymark procedures of dept-frontend/);
  assert.deepEqual([[...procDelivered('s-load', 0, file)].sort(), [...procLate('s-load', 0, file)]], [['dept-frontend', 'dept-qa'], ['dept-frontend']]);
  assert.equal(await packContext({ ...at('s-load'), tool_name: 'Skill', tool_input: { skill: 'dept-frontend' } }, claude, file), null, 'once per task and department');
  // logic: loaded before any change, nothing goes in at the load (a turn that changes nothing is handed nothing); the first edit hands it, in time
  const file2 = path.join(home, 'packed-load2.json');
  assert.equal(await packContext({ ...at('s-load2'), tool_name: 'Skill', tool_input: { skill: 'waymark:dept-backend', args: 'L2' } }, claude, file2), null, 'counter-example: no change yet');
  assert.match(await packContext({ ...at('s-load2'), tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', 'c.mjs') } }, claude, file2) || '', /Waymark procedures of dept-qa/, 'the first edit hands as before');
  assert.match(await packContext({ ...at('s-load2'), tool_name: 'Skill', tool_input: { skill: 'waymark:dept-backend' } }, claude, file2) || '', /Waymark procedures of dept-backend/, 'the plugin form of the name');
  // another agent loads a skill by reading its SKILL.md, by a read tool or a shell command (after a change)
  const file3 = path.join(home, 'packed-load3.json');
  await packContext({ ...at('s-load3'), tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', 'b.html') } }, claude, file3);
  assert.match(await packContext({ ...at('s-load3'), tool_name: 'Read', tool_input: { file_path: path.join(home, 'skills', 'dept-data', 'SKILL.md') } }, claude, file3) || '', /Waymark procedures of dept-data/);
  assert.match(await packContext({ ...at('s-load3'), tool_name: 'Bash', tool_input: { command: 'cat ~/.agents/skills/dept-security/SKILL.md' } }, claude, file3) || '', /Waymark procedures of dept-security/);
  // counter-example: a skill that is no department, a procedures.md read, another SKILL.md: nothing handed
  for (const [tool_name, tool_input] of [['Skill', { skill: 'ui-build' }], ['Read', { file_path: path.join(home, 'skills', 'dept-data', 'procedures.md') }], ['Read', { file_path: path.join(home, 'skills', 'ui-build', 'SKILL.md') }]]) {
    assert.equal(await packContext({ ...at('s-load4'), tool_name, tool_input }, claude, path.join(home, 'packed-load4.json')), null, JSON.stringify(tool_input));
  }
});

test('procedure testigo: a delivery late after the first change is recorded ✘ "after the first change", never blocks', () => {
  const lines = [prompt('ajusta el botón'), say('Waymark → L1 · dept-frontend · skills: ninguna'), ...run('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'),
    ...run('Edit', { file_path: '/work/proj/src/button.component.css', old_string: 'a', new_string: 'b' }), ...run('Skill', { skill: 'dept-frontend' })];
  const g = judge(lines, { procDelivered: ['dept-frontend'], procLate: ['dept-frontend'] }), proc = step(g, 'procedure');
  assert.equal(proc.pass, false);
  assert.match(proc.why.join(' '), /after the task's first change/);
  assert.ok(!g.missing.some((m) => /procedure|Enrutar|procedures\.md/.test(m)), `not blocked: ${g.missing.join(' | ')}`);
  assert.equal(step(judge(lines, { procDelivered: ['dept-frontend'] }), 'procedure').pass, true, 'counter-example: delivered in time, read in time');
});

test('procedure testigo: a delivery counts as read; with neither a read nor a delivery it still blocks', () => {
  const lines = [prompt('agrega reintentos'), say('Waymark → L1 · dept-backend · skills: ninguna'), ...run('Skill', { skill: 'dept-backend' }),
    ...run('AskUserQuestion', { questions: [] }), answered('¿Cómo?', ['Backoff', 'Cola'], 'Backoff'), ...run('Edit', { file_path: FILE, old_string: 'a', new_string: 'b' })];
  const handed = step(judge(lines, { procDelivered: ['dept-backend'] }), 'procedure');
  assert.equal(handed.pass, true, 'handed over by the hook');
  const none = step(judge(lines), 'procedure');
  assert.equal(none.pass, false, 'nothing delivered, nothing read');
  assert.match(none.why.join(' '), /procedures\.md never read/);
  const other = step(judge(lines, { procDelivered: ['dept-qa'] }), 'procedure');
  assert.equal(other.pass, false, 'another department\'s delivery is not the owner\'s');
});

// point 10(a): what the level asks at the close is handed with the first change, so the Cierre is written last and no turn is spent on a list the hook already knew
test('owed at the end: the first change of a task hands what the close asks, once per task; a UI file adds the eyes', async () => {
  const repo = withMemory(repoAt('owed'));
  fs.mkdirSync(path.join(repo, 'src'));
  for (const f of ['a.mjs', 'b.mjs', 'app.css']) fs.writeFileSync(path.join(repo, 'src', f), 'x');
  const transcript = path.join(home, 'owed-session.jsonl');
  fs.writeFileSync(transcript, [prompt('agrega reintentos', '2026-10-15T10:00:00Z'), ...run('Skill', { skill: 'dept-backend', args: 'L2' })].map((l) => JSON.stringify(l)).join('\n'));
  const call = (f, session) => ({ tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src', f) }, cwd: repo, session_id: session, transcript_path: transcript });
  const first = await packContext(call('a.mjs', 's-owed'), claude, path.join(home, 'packed-owed.json'));
  assert.match(first || '', /At L2 and above the close also asks for/);
  assert.match(first || '', /one Cierre last/);
  assert.match(first || '', /code-review once/);
  // 2.0.20 point 31: the order that stops the proofs going stale (a finding of the review changes the code) and the Cierre being written over a running review
  assert.match(first || '', /code-review \(wait for its result: never write a Cierre while it runs[^)]*\), apply its findings, then the final gate, the build of every repo you changed, and write the one Cierre last/);
  assert.doesNotMatch(first || '', /eyes/, 'a logic file owes no look at the screen');
  const second = await packContext(call('b.mjs', 's-owed'), claude, path.join(home, 'packed-owed.json'));
  assert.doesNotMatch(second || '', /At L2 and above/, 'once per task, with the first change');
  const ui = await packContext(call('app.css', 's-owed-ui'), claude, path.join(home, 'packed-owed.json'));
  const l1 = path.join(home, 'owed-l1.jsonl');
  fs.writeFileSync(l1, [prompt('cambia el color', '2026-10-15T10:00:00Z'), ...run('Skill', { skill: 'dept-frontend', args: 'L1' })].map((l) => JSON.stringify(l)).join('\n'));
  const small = await packContext({ ...call('a.mjs', 's-owed-l1'), transcript_path: l1 }, claude, path.join(home, 'packed-owed.json'));
  assert.doesNotMatch(small || '', /At L2 and above/, 'an L1 is not handed a list it does not owe');
  assert.match(ui || '', /eyes: look at what you built in the browser/, 'a styles file adds the look');
  assert.match(ui || '', /the build of every repo you changed and the eyes on the final code, and write the one Cierre last/, 'and the order puts the eyes after the review');
});
