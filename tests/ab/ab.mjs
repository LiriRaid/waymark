#!/usr/bin/env node
// Waymark · the measure with and without Waymark (2.0.19, plan decision 18). Not shipped: it lives with the tests.
// The same task, in the same seed repository, with the same model and prompt, runs in two arms through
// tests/external/run-agent.mjs: "with" (this checkout's hooks, departments and instructions block) and "without" (`--safe-mode`:
// nothing of Waymark and none of the user's own configuration). Each run gets a fresh copy; the order of the arms alternates by
// repetition, so a warm cache or a busy hour does not favour one side. After a run the task's own check says whether it was
// done. Tokens become cost units with the weights of cost.mjs; the README may state only what `verdict` says.
//   node tests/ab/ab.mjs                         prints the plan and spends nothing
//   node tests/ab/ab.mjs --run [--model sonnet] [--repeats 3] [--out <dir>]   runs it (the user launches it: it spends their quota)
//   node tests/ab/ab.mjs --summarize <results.json>                          the table and the verdict of a finished run
// A run worth keeping is copied to tests/ab/results-<date>.json (it holds only these synthetic prompts and the token counts); the
// README's line is then readmeLine() of the newest such file, and tests/ab.test.mjs fails until the README says exactly that.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { units } = await import(new URL(`file:///${path.join(ROOT, 'skills', 'waymark', 'scripts', 'cost.mjs').replace(/\\/g, '/')}`).href);
export const SCHEMA = 'waymark.ab/v1';
// A module is cached by its URL: each check reads the file as it is now only when the URL is new, and two reads in one millisecond (Linux) shared a Date.now().
let loads = 0;
const fresh = () => `${Date.now()}-${++loads}`;
export const PROBE_PHRASE = 'Waymark on every request'; // the heading of the instructions block, in no hook's text

// Two logic tasks and two of CSS/HTML, each a seed repository, a prompt and the check that it was done.
export const TASKS = [
  { id: 'logic-discount', kind: 'logic', prompt: 'Add an optional discount to total() in src/price.mjs: total(items, { percent }) takes percent off the sum, rounded to 2 decimals. Calls without the option must keep working.',
    files: { 'src/price.mjs': 'export function total(items) {\n  return items.reduce((s, i) => s + i.price * i.qty, 0);\n}\n', 'src/price.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from './price.mjs';\ntest('sum', () => assert.equal(total([{ price: 2, qty: 3 }]), 6));\n" },
    check: async (dir) => { const { total } = await import(`${fileUrl(path.join(dir, 'src', 'price.mjs'))}?${fresh()}`); return total([{ price: 10, qty: 3 }]) === 30 && total([{ price: 10, qty: 3 }], { percent: 15 }) === 25.5 && total([{ price: 1.11, qty: 3 }], { percent: 10 }) === 3; } },
  { id: 'logic-slug', kind: 'logic', prompt: 'slugify() in src/slug.mjs must also drop accents (á → a, ñ → n) and never leave two hyphens in a row or one at either end.',
    files: { 'src/slug.mjs': "export function slugify(s) {\n  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');\n}\n" },
    check: async (dir) => { const { slugify } = await import(`${fileUrl(path.join(dir, 'src', 'slug.mjs'))}?${fresh()}`); return slugify('Año  Nuevo!') === 'ano-nuevo' && slugify('--Café con leche--') === 'cafe-con-leche'; } },
  { id: 'css-button', kind: 'css/html', prompt: 'The primary button in src/app/button.css must be at least 44px tall and show a visible 2px focus ring only for keyboard focus. Change only the stylesheet.',
    files: { 'src/app/button.css': '.btn-primary {\n  padding: 4px 12px;\n  background: #0a58ca;\n  color: #fff;\n  border: 0;\n}\n', 'src/app/button.html': '<button class="btn-primary" type="button">Guardar</button>\n' },
    check: async (dir) => { const css = read(path.join(dir, 'src', 'app', 'button.css')); return /\.btn-primary\s*\{[^}]*min-height:\s*(4[4-9]|[5-9]\d)px/.test(css) && /\.btn-primary:focus-visible\s*\{[^}]*outline:\s*2px/.test(css) && read(path.join(dir, 'src', 'app', 'button.html')).includes('class="btn-primary"'); } },
  { id: 'html-form', kind: 'css/html', prompt: 'The email field in src/app/form.html has no label: give it a visible label "Correo" tied to the input, and make the field required.',
    files: { 'src/app/form.html': '<form>\n  <input type="email" name="email">\n  <button type="submit">Enviar</button>\n</form>\n' },
    check: async (dir) => { const html = read(path.join(dir, 'src', 'app', 'form.html')); const id = html.match(/<input[^>]*\bid="([^"]+)"[^>]*>/)?.[1]; return !!id && new RegExp(`<label[^>]*for="${id}"[^>]*>\\s*Correo\\s*</label>`).test(html) && /<input[^>]*type="email"[^>]*\brequired\b/.test(html.replace(/\n/g, ' ')); } },
];
// A check that throws (a change that broke the module) is a task not done.
export async function isDone(task, dir) { try { return (await task.check(dir)) === true; } catch { return false; } }
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const fileUrl = (f) => `file:///${path.resolve(f).replace(/\\/g, '/')}`;

// → [{ task, repeat, arm }] in the order they run: the arms swap places on each repetition.
export function plan(tasks = TASKS, repeats = 3) {
  const out = [];
  for (const t of tasks) for (let r = 0; r < repeats; r++) for (const arm of r % 2 ? ['without', 'with'] : ['with', 'without']) out.push({ task: t.id, repeat: r + 1, arm });
  return out;
}

// A fresh repository with the task's seed, one commit, so the agent sees a clean tree.
export function seed(task, root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ab-'))) {
  for (const [f, body] of Object.entries(task.files)) { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), body); }
  const g = (...a) => spawnSync('git', ['-c', 'user.name=ab', '-c', 'user.email=ab@example.invalid', ...a], { cwd: root });
  g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'seed');
  return root;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
// The table of a finished run: per task and arm the median cost units, USD and turns, the range of the units and the share done.
export function summarize(results) {
  const valid = results.runs.filter((r) => !r.invalid);
  const rows = [];
  for (const id of [...new Set(valid.map((r) => r.task))]) {
    const row = { task: id };
    for (const arm of ['with', 'without']) {
      const rs = valid.filter((r) => r.task === id && r.arm === arm), u = rs.map((r) => units(r.usage || {}));
      row[arm] = rs.length ? { n: rs.length, units: median(u), min: Math.min(...u), max: Math.max(...u), usd: median(rs.map((r) => r.costUsd || 0)), turns: median(rs.map((r) => r.turns || 0)), done: rs.filter((r) => r.done).length / rs.length } : null;
    }
    rows.push(row);
  }
  return { rows, invalid: results.runs.length - valid.length, verdict: verdict(rows), model: results.model, at: results.at };
}
// What the README may say. A saving is shown only when, in every task, the arm with Waymark costs less at its worst than the arm
// without at its best and gets the task done at least as often; it costs more when the reverse holds in every task; anything
// else is "no saving shown". A task missing either arm decides nothing, so the verdict is "not measured".
export function verdict(rows) {
  if (!rows.length || rows.some((r) => !r.with || !r.without)) return 'not measured';
  if (rows.every((r) => r.with.max < r.without.min && r.with.done >= r.without.done)) return 'saving shown';
  if (rows.every((r) => r.with.min > r.without.max)) return 'costs more';
  return 'no saving shown';
}
// The one README line: what was measured, how, and the verdict; with no run, that nothing is claimed.
export function readmeLine(summary) {
  if (!summary) return 'Token use with and without Waymark has not been measured yet (`tests/ab/ab.mjs`), so no saving is claimed.';
  const n = summary.rows.reduce((a, r) => a + (r.with?.n || 0) + (r.without?.n || 0), 0);
  const ratio = median(summary.rows.filter((r) => r.with && r.without && r.without.units).map((r) => r.with.units / r.without.units));
  const done = (arm) => Math.round(100 * median(summary.rows.map((r) => r[arm]?.done ?? 0)));
  return `With and without Waymark (\`tests/ab/ab.mjs\`, ${summary.at?.slice(0, 10)}, ${summary.model}, ${summary.rows.length} tasks, ${n} runs in Claude Code): ${summary.verdict}; the arm with Waymark used ${ratio === null ? '—' : `${Math.round(ratio * 100)} %`} of the cost units of the arm without (median of the tasks), and got the task done in ${done('with')} % against ${done('without')} %.`;
}

// A run of the arm without Waymark whose output carries Waymark's own words leaked the user's configuration: it does not count.
export const leaked = (summaryJson, streamText = '') => summaryJson.arm === 'without' && /Waymark →|## Cierre ·|dept-[a-z]+/.test(`${summaryJson.result || ''}\n${streamText}`);

const RUN = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (RUN) {
  const argv = process.argv.slice(2), opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('--summarize')) {
    const s = summarize(JSON.parse(fs.readFileSync(opt('--summarize'), 'utf8')));
    for (const r of s.rows) console.log(`${r.task.padEnd(16)} with ${r.with ? `${Math.round(r.with.units)} u (${Math.round(r.with.min)}–${Math.round(r.with.max)}) $${r.with.usd.toFixed(3)} done ${Math.round(r.with.done * 100)} %` : '—'} · without ${r.without ? `${Math.round(r.without.units)} u (${Math.round(r.without.min)}–${Math.round(r.without.max)}) $${r.without.usd.toFixed(3)} done ${Math.round(r.without.done * 100)} %` : '—'}`);
    console.log(`invalid runs: ${s.invalid}\nverdict: ${s.verdict}\nREADME: ${readmeLine(s)}`);
  } else {
    const repeats = Number(opt('--repeats', 3)), model = opt('--model', 'sonnet'), steps = plan(TASKS, repeats);
    console.log(`A/B: ${TASKS.length} tasks × ${repeats} repetitions × 2 arms = ${steps.length} headless runs on ${model}, plus one probe. Each spends your quota.`);
    if (!argv.includes('--run')) { console.log('Nothing ran. Add --run to start it.'); process.exit(0); }
    const out = path.resolve(opt('--out', path.join(os.tmpdir(), `waymark-ab-${Date.now()}`)));
    fs.mkdirSync(out, { recursive: true });
    const agent = path.join(ROOT, 'tests', 'external', 'run-agent.mjs'), block = path.join(ROOT, 'skills', 'waymark', 'templates', 'instructions.md');
    const runOne = (dir, prompt, arm, at, extra = []) => { spawnSync(process.execPath, [agent, dir, '--prompt', prompt, '--out', at, '--model', model, '--arm', arm, ...extra], { stdio: 'inherit' }); return JSON.parse(read(path.join(at, 'summary.json')) || '{}'); };
    // the probe: does the arm with Waymark already load the user's CLAUDE.md (and its instructions block)? Then it is not appended twice.
    // It asks for the block's own heading: the hooks' reminders also say "Rule 0", never this phrase.
    const probeDir = seed(TASKS[0]);
    const probe = runOne(probeDir, `Without using any tool, answer only "yes" or "no": does your context contain the exact phrase "${PROBE_PHRASE}"?`, 'with', path.join(out, 'probe'));
    fs.rmSync(probeDir, { recursive: true, force: true });
    const append = !/^\s*yes/i.test(String(probe.result || ''));
    const results = { schema: SCHEMA, model, at: new Date().toISOString(), repeats, instructionsAppended: append, runs: [] };
    for (const s of steps) {
      const task = TASKS.find((t) => t.id === s.task), dir = seed(task), at = path.join(out, `${s.task}-${s.repeat}-${s.arm}`);
      const sum = runOne(dir, task.prompt, s.arm, at, s.arm === 'with' && append ? ['--instructions', block] : []);
      const done = await isDone(task, dir);
      results.runs.push({ ...s, usage: sum.usage, costUsd: sum.costUsd, turns: sum.turns, subtype: sum.subtype, done, ...(leaked(sum, read(path.join(at, 'stream.jsonl'))) ? { invalid: 'the arm without Waymark showed Waymark' } : {}) });
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
      fs.rmSync(dir, { recursive: true, force: true });
    }
    console.log(`results: ${path.join(out, 'results.json')}\nverdict: ${summarize(results).verdict}`);
  }
}
