// Waymark 2.0.19 · point 13 (ADR 0049): the model is in the record and in `cost`. A task keeps the models its responses came from, in order, and whether they
// changed; `cost` groups by model; a task whose model changed is shown apart and out of the routine share (the cache rewrite after `/model` is not the
// routine's). Synthetic transcripts and records, a logic case, a style-only case and the counter-examples. Run: node --test tests/model.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-model-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_ENGRAM = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const T = await import(`file://${SCRIPTS}/transcript.mjs`);
const C = await import(`file://${SCRIPTS}/cost.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

let id = 0;
const at = () => new Date().toISOString();
const prompt = (text) => ({ type: 'user', uuid: `p${Math.random()}`, timestamp: at(), message: { role: 'user', content: text } });
const reply = (model, extra = {}) => ({ type: 'assistant', timestamp: at(), ...extra, message: { id: `m${++id}`, model, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 5 }, content: [{ type: 'text', text: 'ok' }] } });
const SONNET = 'claude-sonnet-5-5', OPUS = 'claude-opus-5-5';

test('13: logic — the models of a turn, in order, once each; a change is read from the responses', () => {
  assert.deepEqual(T.modelsOf([prompt('x'), reply(SONNET), reply(SONNET)]), [SONNET]);
  assert.deepEqual(T.modelsOf([prompt('x'), reply(SONNET), reply(OPUS), reply(SONNET)]), [SONNET, OPUS], 'a model that comes back is not listed twice');
  assert.deepEqual(T.modelsOf([prompt('antes'), reply(OPUS), prompt('x'), reply(SONNET)]), [SONNET], 'only the current turn');
  assert.deepEqual(T.modelsOf([prompt('x'), reply('<synthetic>'), reply(SONNET, { isSidechain: true })]), [], 'counter-example: a synthetic message and a subagent are not the session\'s model');
  assert.deepEqual(T.modelsOf([prompt('x')]), []);
});

const task = (idn, model, level, links, extra = {}) => ({ id: idn, session: 's', cwd: null, version: '2.0.19', level, model, tokens: 1000, units: 1000, usage: {}, links, subagents: 0, responses: 5, quotaPct: null, quotaBy: null, taskType: null, cited: 0, unbacked: 0, ...extra });
const links = (routine, work) => ({ routine: { input: routine, cacheWrite: 0, cacheRead: 0, output: 0, responses: 1 }, work: { input: work, cacheWrite: 0, cacheRead: 0, output: 0, responses: 1 }, reply: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, responses: 0 } });

test('13: cost groups by model, and a task whose model changed is a group of its own', () => {
  const g = C.groups([task('T1', SONNET, 2, links(10, 90)), task('T2', OPUS, 2, links(10, 90)), task('T3', OPUS, 2, links(10, 90)), task('T4', SONNET, 2, links(10, 90), { modelChanged: true })]);
  assert.deepEqual(g.map((x) => [x.model, x.tasks]).sort(), [[OPUS, 2], [SONNET, 1], ['switched', 1]].sort());
  assert.ok(g.every((x) => 'model' in x));
  assert.match(C.render({ schema: C.SCHEMA, tasks: 4, fixed: { chars: 1, tokens: 1, perPromptChars: 1, parts: { instructionsBlock: 1, contextCard: 1, skillDescriptions: 1 } }, groups: g }), /claude-opus-5-5/);
});

test('13: CSS/HTML — the same for style-only tasks: the model of a task does not depend on what it touched', () => {
  const g = C.groups([task('T1', SONNET, 1, links(5, 95), { taskType: 'style' }), task('T2', SONNET, 1, links(5, 95), { taskType: 'style', modelChanged: true })]);
  assert.deepEqual(g.map((x) => x.model).sort(), ['switched', SONNET].sort());
});

test('13: the routine share leaves out a task whose model changed; the counter-example keeps the others', () => {
  const plain = [task('T1', SONNET, 2, links(10, 90)), task('T2', SONNET, 2, links(10, 90))];
  const switched = task('T3', OPUS, 2, links(900, 100), { modelChanged: true }); // the cache rewrite after /model landed in the routine link
  assert.deepEqual(C.routineShare([...plain, switched], 2, 10), { share: 0.1, tasks: 2 });
  assert.equal(C.routineShare([switched], 2, 10), null, 'with only that task there is no share');
});

test('13: the record keeps the models and the change, through the end-of-turn hook', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-model-')); temps.push(dir); spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.waymark')); fs.writeFileSync(path.join(dir, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src', 'a.css'), 'a{}\n');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: dir }); spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'src', 'a.css'), 'a{color:red}\n');
  const tool = { type: 'tool_use', id: 'u1', name: 'Edit', input: { file_path: path.join(dir, 'src', 'a.css') } };
  const lines = [prompt('ajusta el estilo'), reply(SONNET, {}), { type: 'assistant', timestamp: at(), message: { id: 'mt', model: SONNET, usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: 'Waymark → L1 · dept-frontend' }, tool] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }] } }, reply(OPUS, {})];
  const transcript = path.join(dir, 't.jsonl');
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const id1 = P.taskIds(dir).next;
  await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify({ transcript_path: transcript, cwd: dir, session_id: 's-model', stop_hook_active: true, last_assistant_message: `## Cierre · ${id1}\nResultado: parcial (falta el hover)\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y` }));
  });
  const rec = P.readRecords(P.projectHome(dir).log).find((r) => r.id);
  assert.deepEqual(rec.models, [SONNET, OPUS]);
  assert.equal(rec.modelChanged, true);
});
