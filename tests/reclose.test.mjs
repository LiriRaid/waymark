// Waymark 2.0.19 · re-close step 3: the reds that code can move. 11.1 (an L2+ task that changes something, in the repo or
// outside it, answers the window first, and the share counts only tasks that changed something), 13.6 (signatures and the
// tag are the user's steps, and a parcial turns hecho only when every gap is the user's), 8.6 (the L2 routine share reads
// the tasks the measured version wrote). A logic case, a CSS/HTML case where it applies, and the counter-example for each.
// Run: node --test tests/reclose.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-reclose-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_ENGRAM = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const SC = await import(`file://${SCRIPTS}/scorecard.mjs`);
const R = await import(`file://${SCRIPTS}/runs.mjs`);
const { ownedSteps, outcome } = await import(`file://${SCRIPTS}/stop-hook.mjs`);
const VERSION = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim();

const project = (records) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-reclose-')); temps.push(d);
  spawnSync('git', ['init', '-q'], { cwd: d });
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  records.forEach((r, i) => P.appendRecord(d, { schema: 'waymark.record/v2', id: `2026-10-27 · T${i + 1}`, agent: 'claude', at: new Date(Date.UTC(2026, 9, 27, 10, i)).toISOString(), session: `s${i}`, cwd: d, level: 2, prompt: 'p', cierre: '## Cierre\nResultado: hecho', inputs: { waymark: VERSION }, outcome: { result: 'hecho' }, ...r }));
  return d;
};

// ---- 11.1 ----
test('11.1: the share counts the L2+ tasks that changed something; one that only ran checks owes no window', async () => {
  const before = [{ position: 'before', chosen: 'A' }];
  const p = project([
    { files: ['src/orders.service.mjs'], decisions: before, evaluation: { score: '9/9', steps: { Decision: true } } },
    { files: ['src/app.css'], decisions: [], evaluation: { score: '8/9', steps: { Decision: false } } }, // CSS/HTML: changed, no window
    { files: [], decisions: [], evaluation: { score: '4/4', steps: { Cierre: true } } }, // the re-close checks: nothing changed
  ]);
  assert.equal(await SC.measure('records.decisionShare', p), 0.5, 'the run that changed nothing is not counted');
  const outside = project([{ files: [], decisions: [], evaluation: { score: '3/4', steps: { Decision: false } } }]);
  assert.equal(await SC.measure('records.decisionShare', outside), 0, 'counter-example: a change outside the repo (the testigo applied) is counted');
});
test('11.1: a copy inside a shell loop is a change (the reinstall of T1d); a loop that only reads is not', () => {
  assert.ok(R.mutatesFiles('D="$HOME/.agents/skills/waymark"; for f in VERSION scripts/notes.mjs; do cp "skills/waymark/$f" "$D/$f"; done'));
  assert.ok(R.mutatesFiles('if [ -d x ]; then rm -rf x; fi'));
  assert.ok(!R.mutatesFiles('for f in a.mjs b.mjs; do node --check "$f"; done'), 'counter-example: the loop only checks');
});

// ---- 13.6 ----
const CONV = '## Conventions specific to this project\n- Firmas: el usuario (2026-10-27)\n- PRs: el usuario\n- Push: el usuario\n';
test('13.6: logic — signatures and the tag are the user\'s steps: a release left only to them is hecho', () => {
  const owned = ownedSteps(CONV);
  assert.deepEqual([...owned].sort(), ['pr', 'push', 'sign']);
  const r = outcome('Resultado: parcial (faltan tu tag firmado sobre fb50445, el push y tu PR a main)', [], [], 2, owned);
  assert.deepEqual([r.result, r.userOwned.sort()], ['hecho', ['pr', 'push', 'sign']]);
  assert.equal(outcome('Resultado: parcial (falta tu firma del manifiesto)', [], [], 1, owned).result, 'hecho');
});
test('13.6: a parcial turns hecho only when every gap is the user\'s; one gap of the work keeps it parcial', () => {
  const owned = ownedSteps(CONV);
  assert.equal(outcome('Resultado: parcial (faltan el resultado de las tres pasadas de gate-tests, tus firmas del manifiesto y del tag)', [], [], 2, owned).result, 'parcial', 'the gate-tests runs are the work');
  assert.equal(outcome('Resultado: parcial (falta el ajuste del botón en móvil y tu PR)', [], [], 2, owned).result, 'parcial', 'CSS/HTML: the style is the work');
  assert.equal(outcome('Resultado: parcial (falta tu PR del ajuste del botón)', [], [], 2, owned).result, 'hecho', 'counter-example: the only gap is the user\'s');
  assert.deepEqual([...ownedSteps('- Tags: v2.0.19 firmado\n- Firmas de commits: GPG\n')], [], 'counter-example: a Conventions line that does not name the user is no rule');
});
test('13.6 (review): a signature or a tag is the user\'s step only with a release object; a form\'s signature field or HTML tags are the work', () => {
  const owned = ownedSteps(CONV);
  for (const gap of ['falta firmar el tag v2.0.19', 'falta la firma del manifiesto', 'falta tu commit firmado', 'missing: sign the release tag']) assert.equal(outcome(`Resultado: parcial (${gap})`, [], [], 2, owned).result, 'hecho', gap);
  assert.equal(outcome('Resultado: parcial (falta el campo de firma del formulario)', [], [], 2, owned).result, 'parcial', 'logic: a signature field is the work');
  assert.equal(outcome('Resultado: parcial (faltan los tags meta del head)', [], [], 2, owned).result, 'parcial', 'CSS/HTML: HTML tags are the work');
  assert.equal(outcome('Resultado: parcial (faltan las etiquetas del formulario y tu PR)', [], [], 2, owned).result, 'parcial', 'counter-example: one gap of the work keeps it parcial');
});

// ---- 8.6 ----
test('8.6: the L2 routine share reads only the tasks the measured version wrote', async () => {
  const link = (responses, cacheRead) => ({ responses, input: 0, cacheWrite: 0, cacheRead, output: 0 });
  const ev = (routine) => ({ score: '1/1', tokens: 20000, links: { v: 1, routine: link(1, routine), work: link(1, 20000 - routine), reply: link(0, 0) } });
  const heavy = { evaluation: ev(10000), inputs: { waymark: '2.0.18', model: 'm' } }, lean = { evaluation: ev(1000), inputs: { waymark: VERSION, model: 'm' } };
  const p = project([heavy, heavy, heavy, lean]);
  assert.equal(await SC.measure('cost.routineShareL2', p), 0.05, 'the three 2.0.18 tasks are not this version\'s');
  const none = project([heavy]);
  assert.equal(await SC.measure('cost.routineShareL2', none), null, 'counter-example: no task of this version: unmeasured');
});
