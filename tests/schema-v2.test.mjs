// Waymark 2.0.18 · point 2: record schema v2 (docs/adr/0030): the fields the hooks derive, and v1 and v2 read together.
// Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-v2-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const V = await import(`file://${SCRIPTS}/verify.mjs`);
const T = await import(`file://${SCRIPTS}/transcript.mjs`);
const { provenanceRecord } = await import(`file://${SCRIPTS}/stop-hook.mjs`);

const day = new Date().toLocaleDateString('sv');
const id = (n, letter = '') => `${day} · T${n}${letter}`;

test('taskType: files decide docs, test and config; a verb decides the rest; nothing decides → null, never a guess', () => {
  const t = (prompt, files, level = 2) => P.taskTypeOf({ prompt, files, level });
  assert.equal(t('lo que sea', []), 'question', 'nothing changed');
  assert.equal(t('lo que sea', ['a.js'], 'Q'), 'question', 'a Q');
  assert.equal(t('arregla el bug', ['README.md', 'docs/a.md']), 'docs', 'every file is a doc: the files win over the verb');
  assert.equal(t('agrega un caso', ['tests/a.test.mjs', 'tests/corpus/x.json']), 'test', 'a fixture under tests/ is a test');
  assert.equal(t('sube la versión', ['package.json', '.github/workflows/ci.yml']), 'config');
  assert.equal(t('Corrige el error de login', ['src/auth.js', 'README.md']), 'fix', 'mixed files: the verb');
  assert.equal(t('refactoriza el módulo de pagos', ['src/pay.js', 'tests/pay.test.js']), 'refactor');
  assert.equal(t('Agrega soporte para Rust', ['src/stack.mjs']), 'feature');
  assert.equal(t('add a retry to the client', ['client.js']), 'feature');
  assert.equal(t('agrega la opción y corrige el bug', ['a.js']), 'feature', 'the verb that comes first in the ask decides');
  assert.equal(t('sigue con el paso 2', ['src/a.js']), null, 'no verb, code files: not derivable');
});

test('askedItems: a numbered or bulleted ask is its items; prose and a single line are not a list', () => {
  assert.deepEqual(P.askedItems('haz esto:\n1. arregla el login\n2) agrega el test\n- y documenta'), ['arregla el login', 'agrega el test', 'y documenta']);
  assert.deepEqual(P.askedItems('solo una línea'), []);
  assert.deepEqual(P.askedItems('1. único'), [], 'one item is not a list');
  assert.equal(P.askedItems(Array.from({ length: 20 }, (_, i) => `- item ${i}`).join('\n')).length, 12, 'capped');
});

test('optionAttrs: recommended from the label, files, risk and cost from the description, null when it does not say', () => {
  assert.deepEqual(P.optionAttrs({ label: 'Archivos primero (Recomendada)', description: 'Archivos: 3. Riesgo bajo; costo: ~2 KB. Más texto.' }),
    { label: 'Archivos primero (Recomendada)', recommended: true, files: 3, risk: 'bajo', estCost: '~2 KB' });
  assert.deepEqual(P.optionAttrs({ label: 'B', description: 'touches 4 files, risk: High, cost medium' }), { label: 'B', recommended: false, files: 4, risk: 'high', estCost: 'medium' });
  assert.deepEqual(P.optionAttrs({ label: 'Cola (Recomendado)' }), { label: 'Cola (Recomendado)', recommended: true, files: null, risk: null, estCost: null });
  assert.equal(P.optionAttrs({ label: 'Recomendada sí' }).recommended, false, 'only the suffix counts');
});

test('decisions: a recorded decision keeps its options with their attributes, besides the picked and discarded labels it always had', () => {
  const q = '¿Cómo?';
  const lines = [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c1', name: 'AskUserQuestion', input: { questions: [] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'answered' }] }, toolUseResult: { questions: [{ question: q, options: [{ label: 'A (Recomendada)', description: 'Riesgo bajo' }, { label: 'B', description: 'Riesgo alto, 5 archivos' }] }], answers: { [q]: 'A (Recomendada)' } } }];
  const [d] = P.recordedDecisions(P.decisionsIn(lines));
  assert.deepEqual([d.chosen, d.discarded], ['A (Recomendada)', ['B']]);
  assert.deepEqual(d.options.map((o) => [o.label, o.recommended, o.risk, o.files]), [['A (Recomendada)', true, 'bajo', null], ['B', false, 'alto', 5]]);
});

test('reworkOf: an earlier task that changed the same files within the window; not itself, not an older one, not a question', () => {
  const now = Date.parse('2026-10-16T12:00:00Z'), ago = (d) => new Date(now - d * 24 * 3600 * 1000).toISOString();
  const records = [
    { id: id(1), at: ago(2), files: ['/p/a.js', '/p/b.js'] },
    { id: id(2), at: ago(9), files: ['/p/c.js'] },
    { id: id(3), at: ago(1), files: ['/p/d.js'] },
    { id: id(4), at: ago(1), files: ['/p/a.js'], kind: 'Q' },
    { id: id(5), at: ago(1), files: ['/P/B.JS'] },
    { id: id(6, 'b'), at: ago(0.5), files: ['/p/a.js'] },
  ];
  const r = P.reworkOf(['/p/a.js', '/p/c.js'], records, { now, self: id(7), norm: (f) => String(f).toLowerCase() });
  assert.deepEqual(r, { reworks: [id(1), id(6, 'b')], reworkFiles: ['/p/a.js'] }, 'T2 is 9 days old (7-day window), T4 is a question');
  assert.deepEqual(P.reworkOf(['/p/a.js'], records, { now, self: id(1) }).reworks, [id(6, 'b')], 'a task is not its own rework');
  assert.deepEqual(P.reworkOf([], records, { now }), { reworks: [], reworkFiles: [] });
});

test('followUps: the letters of a task, read from the records and never stored', () => {
  const rs = [{ id: id(3) }, { id: id(3, 'b') }, { id: id(3, 'c') }, { id: id(4) }, { id: id(4, 'b') }];
  assert.deepEqual(P.followUps(rs, id(3)), [id(3, 'b'), id(3, 'c')]);
  assert.deepEqual(P.followUps(rs, id(3, 'b')), [id(3, 'c')]);
  assert.deepEqual(P.followUps(rs, id(9)), []);
});

test('costByCall: a tuple per tool call; a response with several calls is split without losing a token; replies are not calls', () => {
  const u = (i, cw, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: o });
  const use = (mid, usage, calls, text) => ({ type: 'assistant', message: { id: mid, usage, content: [...(text ? [{ type: 'text', text }] : []), ...calls.map(([name, input], k) => ({ type: 'tool_use', id: `${mid}-${k}`, name, input }))] } });
  const lines = [
    { type: 'user', timestamp: '2026-10-16T10:00:00Z', message: { role: 'user', content: 'haz algo' } },
    use('m1', u(10, 100, 1000, 50), [['Skill', { skill: 'dept-devex' }]]),
    use('m2', u(7, 31, 1001, 11), [['Read', { file_path: '/p/a.js' }], ['Edit', { file_path: '/p/a.js' }], ['Bash', { command: 'node --test' }]]),
    use('m3', u(1, 2, 3, 4), [], 'listo'),
  ];
  const calls = T.costByCall(lines);
  assert.deepEqual(calls.map((c) => c.slice(0, 2)), [['Skill', 'r'], ['Read', 'w'], ['Edit', 'w'], ['Bash', 'w']]);
  assert.deepEqual(calls[0].slice(2), [10, 100, 1000, 50]);
  const split = calls.slice(1);
  assert.deepEqual([0, 1, 2, 3].map((k) => split.reduce((a, c) => a + c[2 + k], 0)), [7, 31, 1001, 11], 'the three calls add up to the response');
  assert.deepEqual(split.map((c) => c[2]), [3, 2, 2], 'the remainder goes to the first calls');
  const links = T.turnLinks(lines);
  const all = (k) => calls.reduce((a, c) => a + c[2 + k], 0) + [links.reply.input, links.reply.cacheWrite, links.reply.cacheRead, links.reply.output][k];
  assert.deepEqual([0, 1, 2, 3].map(all), [links.routine, links.work].map((l) => [l.input, l.cacheWrite, l.cacheRead, l.output]).reduce((a, l) => a.map((x, i) => x + l[i]), [links.reply.input, links.reply.cacheWrite, links.reply.cacheRead, links.reply.output]), 'calls + replies = every response of the turn');
});

test('provenanceRecord: a new record is v2 and carries what the hooks derive; a field with nothing to say is absent', () => {
  const when = Date.now();
  const ctx = { ids: { next: id(9), known: new Set(), committed: new Set() }, decisions: [], inputs: {}, commits: [], records: [{ id: id(8), at: new Date(when - 3600e3).toISOString(), files: ['/p/src/a.mjs'] }] };
  const turn = { prompt: 'Corrige:\n1. el login\n2. el logout', tools: [] };
  const gaps = { reply: '## Cierre\nResultado: hecho', level: 2, dept: { declared: 'dept-devex' }, changed: ['/p/src/a.mjs', '/p/src/b.mjs'], observed: {}, missing: [], findings: [] };
  const rec = provenanceRecord(turn, gaps, ctx, { cost: { v: 1, byCall: [['Edit', 'w', 1, 2, 3, 4]] } });
  assert.equal(rec.schema, 'waymark.record/v2');
  assert.equal(rec.taskType, 'fix');
  assert.deepEqual(rec.asked, ['el login', 'el logout']);
  assert.deepEqual([rec.reworks, rec.reworkFiles], [[id(8)], ['/p/src/a.mjs']]);
  assert.deepEqual(rec.cost.byCall, [['Edit', 'w', 1, 2, 3, 4]]);
  const bare = provenanceRecord({ prompt: 'sigue', tools: [] }, { ...gaps, changed: ['/p/z.js'] }, { ...ctx, records: [] }, {});
  for (const k of ['taskType', 'asked', 'reworks', 'reworkFiles', 'cost', 'precedent']) assert.equal(k in bare, false, `${k} is absent when there is nothing to say`);
});

test('v1 and v2 records are read together: the chain verifies with both, and the shapes are counted', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-v2-chain-'));
  temps.push(d);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'x'); git('add', 'a.txt'); git('commit', '-q', '-m', 'init');
  const rec = (n, extra) => ({ id: id(n), agent: 'claude', at: new Date().toISOString(), session: 's', files: ['a.txt'], commits: [], prompt: `pedido ${n}`, cierre: `## Cierre · ${id(n)}\nResultado: hecho\nEvidencia: observada x\nAprendido: y ← z`, ...extra });
  P.appendRecord(d, rec(1, { schema: 'waymark.record/v1' }));
  P.appendRecord(d, rec(2, { schema: 'waymark.record/v2', taskType: 'docs', cost: { v: 1, byCall: [] } }));
  P.appendRecord(d, rec(3, { schema: 'waymark.record/v9' }));
  const r = V.verify(d, []);
  assert.equal(r.code, 0, 'an unknown shape is a warning, not a failure');
  assert.match(r.lines.join('\n'), /record shapes: v1 ×1 · v2 ×1 · v9 ×1 · warning: unknown shape waymark\.record\/v9/);
  assert.deepEqual(V.schemaReport(d).counts, { 'waymark.record/v1': 1, 'waymark.record/v2': 1, 'waymark.record/v9': 1 });
});

test('replayV2: a v1 record seen as v2 gets what can be derived from what it holds, and nothing it cannot', () => {
  const v1 = { schema: 'waymark.record/v1', id: id(5), at: '2026-10-16T10:00:00Z', level: 2, prompt: 'arregla el error del arranque', files: ['/p/src/boot.mjs'],
    decisions: [{ question: '¿Cómo?', chosen: 'A (Recomendada)', discarded: ['B'] }] };
  const earlier = [{ id: id(4), at: '2026-10-15T10:00:00Z', files: ['/p/src/boot.mjs'] }, v1];
  const v = P.replayV2(v1, earlier);
  assert.equal(v.taskType, 'fix');
  assert.deepEqual(v.reworks, [id(4)]);
  assert.deepEqual(v.decisions[0].options.map((o) => [o.label, o.recommended]), [['A (Recomendada)', true], ['B', false]]);
  assert.equal('cost' in v, false, 'the tokens per call were not kept in a v1 record');
  assert.equal(v1.taskType, undefined, 'the original is untouched');
  assert.equal(P.replayV2({ id: id(6), prompt: 'x', files: [], level: 2, at: v1.at }, []).taskType, 'question');
  const again = P.replayV2({ ...v1, taskType: 'feature' }, earlier);
  assert.equal(again.taskType, 'feature', 'a field the record already holds is never replaced');
});
