import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
// The measure with and without Waymark (tests/ab/ab.mjs): the plan, the seed repositories, the checks that say a task was done,
// the verdict the README may state, and the README line itself. Nothing here runs an agent: a run spends the user's quota.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const AB = await import(`file:///${path.join(ROOT, 'tests', 'ab', 'ab.mjs').replace(/\\/g, '/')}`);
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const task = (id) => AB.TASKS.find((t) => t.id === id);
const seeded = (id) => { const d = AB.seed(task(id)); temps.push(d); return d; };

test('the plan: 4 tasks (2 logic, 2 CSS/HTML) × 3 × 2 arms = 24 runs, the arms swapping places on each repetition', () => {
  const p = AB.plan();
  assert.equal(p.length, 24);
  assert.deepEqual([...new Set(AB.TASKS.map((t) => t.kind))], ['logic', 'css/html']);
  assert.deepEqual(p.slice(0, 6).map((s) => s.arm), ['with', 'without', 'without', 'with', 'with', 'without']);
  assert.equal(spawnSync(process.execPath, [path.join(ROOT, 'tests', 'ab', 'ab.mjs')], { encoding: 'utf8' }).stdout.includes('Nothing ran'), true, 'without --run it spends nothing');
});

test('a seed is a clean repository with one commit', () => {
  const d = seeded('logic-slug');
  assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: d, encoding: 'utf8' }).stdout, '');
  assert.match(spawnSync('git', ['log', '--oneline'], { cwd: d, encoding: 'utf8' }).stdout, /seed/);
});

test('logic — the check passes on a correct change and fails on the seed and on a change that breaks the old calls', async () => {
  const d = seeded('logic-discount'), f = path.join(d, 'src', 'price.mjs');
  assert.equal(await AB.isDone(task('logic-discount'), d), false, 'the seed is not done');
  fs.writeFileSync(f, 'export function total(items, { percent = 0 } = {}) {\n  const s = items.reduce((a, i) => a + i.price * i.qty, 0);\n  return Math.round(s * (1 - percent / 100) * 100) / 100;\n}\n');
  assert.equal(await AB.isDone(task('logic-discount'), d), true);
  fs.writeFileSync(f, 'export function total(items, { percent }) {\n  return items.reduce((a, i) => a + i.price * i.qty, 0) * (1 - percent / 100);\n}\n');
  assert.equal(await AB.isDone(task('logic-discount'), d), false, 'counter-example: a call without the option breaks');
  const s = seeded('logic-slug');
  fs.writeFileSync(path.join(s, 'src', 'slug.mjs'), "export function slugify(s) {\n  return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');\n}\n");
  assert.equal(await AB.isDone(task('logic-slug'), s), true);
});

test('CSS/HTML — the check passes on the asked stylesheet and markup, and fails on :focus or a 1px ring and on a label not tied to the input', async () => {
  const d = seeded('css-button'), css = path.join(d, 'src', 'app', 'button.css');
  assert.equal(await AB.isDone(task('css-button'), d), false);
  fs.writeFileSync(css, '.btn-primary {\n  min-height: 44px;\n  padding: 4px 12px;\n}\n.btn-primary:focus-visible {\n  outline: 2px solid #fff;\n}\n');
  assert.equal(await AB.isDone(task('css-button'), d), true);
  fs.writeFileSync(css, '.btn-primary {\n  min-height: 44px;\n}\n.btn-primary:focus {\n  outline: 1px solid #fff;\n}\n');
  assert.equal(await AB.isDone(task('css-button'), d), false, 'counter-example: every focus, and a thinner ring');
  const h = seeded('html-form'), html = path.join(h, 'src', 'app', 'form.html');
  fs.writeFileSync(html, '<form>\n  <label for="email">Correo</label>\n  <input id="email" type="email" name="email" required>\n</form>\n');
  assert.equal(await AB.isDone(task('html-form'), h), true);
  fs.writeFileSync(html, '<form>\n  <label>Correo</label>\n  <input type="email" name="email" required>\n</form>\n');
  assert.equal(await AB.isDone(task('html-form'), h), false, 'counter-example: a label tied to nothing');
});

const run = (task, arm, input, done = true, extra = {}) => ({ task, arm, repeat: 1, usage: { input, output: 0 }, costUsd: input / 1e6, turns: 3, done, ...extra });
const results = (runs) => ({ schema: AB.SCHEMA, model: 'sonnet', at: '2026-10-26T12:00:00Z', runs });
test('the verdict: a saving only when Waymark costs less at its worst in every task and gets as much done; costs more the other way; else none', () => {
  const both = (w, wo, wDone = true) => ['a', 'b'].flatMap((t) => [...w.map((u) => run(t, 'with', u, wDone)), ...wo.map((u) => run(t, 'without', u))]);
  assert.equal(AB.summarize(results(both([100, 120], [200, 260]))).verdict, 'saving shown');
  assert.equal(AB.summarize(results(both([300, 320], [200, 260]))).verdict, 'costs more');
  assert.equal(AB.summarize(results(both([100, 220], [200, 260]))).verdict, 'no saving shown', 'the ranges overlap');
  assert.equal(AB.summarize(results(both([100, 120], [200, 260], false))).verdict, 'no saving shown', 'counter-example: cheaper but the task was not done');
  assert.equal(AB.summarize(results([run('a', 'with', 100)])).verdict, 'not measured', 'one arm only');
  const s = AB.summarize(results([...both([100, 120], [200, 260]), run('a', 'without', 5, true, { invalid: 'leaked' })]));
  assert.equal(s.invalid, 1);
  assert.equal(s.rows.find((r) => r.task === 'a').without.min, 200, 'an invalid run counts for nothing');
});

test('a run of the arm without Waymark that shows Waymark is caught; the arm with it is not', () => {
  assert.equal(AB.leaked({ arm: 'without', result: 'Waymark → L1 · dept-frontend' }), true);
  assert.equal(AB.leaked({ arm: 'without', result: 'done: the label is tied to the input' }), false);
  assert.equal(AB.leaked({ arm: 'with', result: 'Waymark → L1 · dept-frontend' }), false);
});

test('the README states only what was measured: with no result file, that nothing is claimed; with one, its line', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const files = fs.readdirSync(path.join(ROOT, 'tests', 'ab')).filter((f) => /^results-.*\.json$/.test(f)).sort();
  const latest = files.length ? AB.summarize(JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'ab', files.at(-1)), 'utf8'))) : null;
  assert.ok(readme.includes(AB.readmeLine(latest)), AB.readmeLine(latest));
  const line = AB.readmeLine(AB.summarize(results(['a', 'b'].flatMap((t) => [run(t, 'with', 100), run(t, 'with', 120), run(t, 'without', 200), run(t, 'without', 260)]))));
  assert.match(line, /2026-10-26, sonnet, 2 tasks, 8 runs in Claude Code\): saving shown; the arm with Waymark used 48 % of the cost units/);
});

test('the runner: the arm without Waymark runs in safe mode with none of this checkout; the arm with it keeps its hooks and may append the block', () => {
  const src = fs.readFileSync(path.join(ROOT, 'tests', 'external', 'run-agent.mjs'), 'utf8');
  assert.match(src, /arm === 'without'\s*\? \[[^\]]*'--safe-mode'/);
  assert.doesNotMatch(src.match(/arm === 'without'\s*\? (\[[^\]]*\])/)[1], /--settings|--add-dir|--append-system-prompt/);
  assert.match(src, /'--append-system-prompt-file', path\.resolve\(instructions\)/);
  assert.ok(fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'templates', 'instructions.md'), 'utf8').includes(AB.PROBE_PHRASE), 'the probe asks for the block\'s own heading');
  for (const f of ['rule0-hook.mjs', 'session-hook.mjs', 'stop-hook.mjs', 'tool-hook.mjs']) assert.ok(!fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'scripts', f), 'utf8').includes(AB.PROBE_PHRASE), `${f} never says it`);
});
