// Waymark 2.0.19 · point 13 (ADR 0049): the scorecard reads real use. Three checks see what the 2.0.18 one missed (35 of 98 real tasks parcial scored 100 %,
// no task outside one agent scored 98 %), and `scorecard --projects` aggregates the projects the user names. Synthetic projects with a known share; a logic
// variant and a style-only variant; the counter-examples. Run: node --test tests/projects.test.mjs
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-proj-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_ENGRAM = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const SC = await import(`file://${SCRIPTS}/scorecard.mjs`);

let n = 0;
// a project with one record per entry of `tasks`: [result, agent, tokens, files]
const project = (name, tasks) => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-pr-')), name); temps.push(path.dirname(d));
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); spawnSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  tasks.forEach(([result, agent, tokens, files], i) => P.appendRecord(d, {
    schema: 'waymark.record/v1', id: `2026-10-${String(10 + (i % 15)).padStart(2, '0')} · T${i + 1}`, agent, at: new Date(Date.UTC(2026, 9, 10, 12, i)).toISOString(), session: `s${++n}`, level: 2,
    files: files || ['src/a.ts'], outcome: { result }, evaluation: { tokens, score: '8/9' }, cierre: `## Cierre\nResultado: ${result}\nEvidencia: x\nAprendido: y`,
  }));
  return d;
};
const mix = (parcial, hecho, agent = 'claude', files) => [...Array(parcial).fill(['parcial', agent, 3_000_000, files]), ...Array(hecho).fill(['hecho', agent, 1_000_000, files])];

test('13: logic — the share of parcial, the agents and the median tokens of a project are read from its records', async () => {
  const p = project('shop', [...mix(3, 7), ['hecho', 'codex', 5_000_000]]);
  assert.equal(await SC.measure('records.parcialShare', p), 3 / 11);
  assert.equal(await SC.measure('records.agentSpread', p), 2, 'claude and codex');
  assert.equal(await SC.measure('records.medianTokens', p), 1_000_000);
});

test('13: counter-example — records written before the log carried an outcome do not dilute the share', async () => {
  const p = project('old', mix(2, 2));
  for (let i = 0; i < 6; i++) P.appendRecord(p, { schema: 'waymark.record/v1', id: `2026-09-0${i + 1} · T1`, agent: 'claude', at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString(), session: `o${i}`, level: 2, files: ['a.ts'] });
  assert.equal(await SC.measure('records.parcialShare', p), 0.5);
});

// a parcial the quota or the provider caused, and a close with testigos left unresolved
const extra = (p, i, rec) => P.appendRecord(p, { schema: 'waymark.record/v1', id: `2026-10-2${i} · T${40 + i}`, agent: 'claude', at: new Date(Date.UTC(2026, 9, 20 + i)).toISOString(), session: `x${++n}`, level: 2, evaluation: { tokens: 1, score: '1/2' }, ...rec });
for (const [kind, files] of [['logic', ['src/orders.service.ts']], ['CSS/HTML', ['src/app/button.component.scss', 'src/app/button.component.html']]]) {
  test(`13: ${kind} — a parcial for an external cause is out of the share on both sides, and the unresolved share is reported beside it`, async () => {
    const p = project(`ext-${kind.length}`, mix(2, 2, 'claude', files));
    for (let i = 0; i < 3; i++) extra(p, i, { files, outcome: { result: 'parcial', cause: 'external', why: 'usage limit' }, unresolved: ['Verificar'] });
    extra(p, 5, { files, outcome: { result: 'hecho' }, unresolved: ['Revisar'] });
    assert.equal(await SC.measure('records.parcialShare', p), 2 / 5, 'the three cut turns count for nothing');
    const r = await SC.projectsReport([p]);
    assert.equal(r.total.unresolvedShare, 1 / 5, 'a hecho that left a testigo unresolved; the cut turns are not judged');
    assert.match(SC.renderProjects(r), /parcial 40 % · unresolved 20 %/);
  });
}
test('13: counter-example — a parcial with no cause, or a cause of the work, still counts as parcial', async () => {
  const p = project('own', mix(1, 3));
  extra(p, 1, { files: ['src/a.ts'], outcome: { result: 'parcial', cause: 'work' } });
  assert.equal(await SC.measure('records.parcialShare', p), 2 / 5);
});

test('13: CSS/HTML — the same for a project whose tasks only touched styles and templates', async () => {
  const p = project('site', mix(2, 8, 'claude', ['src/app/button.component.css', 'src/app/button.component.html']));
  assert.equal(await SC.measure('records.parcialShare', p), 0.2);
  assert.equal(await SC.measure('records.agentSpread', p), 1);
});

test('13: counter-example — a record with no agent is no second agent', async () => {
  const p = project('anon', [...mix(0, 5), ['hecho', null, 1_000_000]]);
  assert.equal(await SC.measure('records.agentSpread', p), 1);
  const r = await SC.projectsReport([p]);
  assert.equal(r.total.oneAgent, true);
  assert.deepEqual(r.total.agents, { claude: 5 });
});

test('13: counter-example — a project with no task is not measured, never 0 % parcial or 100 % anything', async () => {
  const p = project('empty', []);
  assert.equal(await SC.measure('records.parcialShare', p), null);
  assert.equal(await SC.measure('records.agentSpread', p), null);
  assert.equal(await SC.measure('records.medianTokens', p), null);
});

test('13: the projects aggregate: tasks pooled, a known share, one agent said as such, a missing path named', async () => {
  const a = project('a', mix(4, 6)), b = project('b', mix(0, 10));
  const r = await SC.projectsReport([a, b, path.join(os.tmpdir(), 'wm-no-such-project')]);
  assert.equal(r.total.tasks, 20);
  assert.equal(r.total.parcialShare, 0.2);
  assert.equal(r.projects.find((x) => x.name === 'a').parcialShare, 0.4);
  assert.deepEqual(r.total.agents, { claude: 20 });
  assert.equal(r.total.oneAgent, true, 'one agent: the score must not read as 100 %');
  assert.ok(r.projects.some((x) => x.missing), 'the path that does not exist is named, not a crash');
  assert.equal(r.checks.find((c) => c.id === '13.6').score, 1, '20 % against a threshold of 20 %');
  const worse = await SC.projectsReport([project('c', mix(6, 4))]);
  assert.equal(worse.checks.find((c) => c.id === '13.6').score, 0.2 / 0.6, 'counter-example: 60 % parcial scores a third');
  const two = await SC.projectsReport([project('d', [...mix(1, 4), ...mix(0, 5, 'codex')])]);
  assert.equal(two.total.oneAgent, false);
  assert.equal(two.checks.find((c) => c.id === '9.9').score, 1);
});

test('13: with no paths the projects are the Path column of ~/.waymark/projects.md', async () => {
  const a = project('listed', mix(1, 3));
  fs.writeFileSync(path.join(home, 'projects.md'), `# Projects\n\n| Project | Path | Stack |\n|---|---|---|\n| listed | ${a.replace(/\\/g, '/')} | node |\n<!-- | <slug> | <absolute path> | x | -->\n`);
  assert.deepEqual(SC.namedProjects().map((p) => path.resolve(p)), [path.resolve(a)]);
  assert.equal((await SC.projectsReport()).total.tasks, 4);
  fs.writeFileSync(path.join(home, 'projects.md'), '# Projects\n');
  assert.deepEqual(SC.namedProjects(), [], 'counter-example: an empty index names nothing');
});

test('13: the card has the three checks, 8.9 frozen in 2.0.19 from its baseline, and its lock names ADR 0049', async () => {
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'scorecard.json'), 'utf8'));
  const check = (id) => card.criteria.flatMap((c) => c.checks).find((c) => c.id === id);
  assert.deepEqual([check('13.6').measure, check('13.6').op, check('13.6').threshold], ['records.parcialShare', 'le', 0.2]);
  assert.deepEqual([check('9.9').measure, check('9.9').op, check('9.9').threshold], ['records.agentSpread', 'ge', 2]);
  assert.deepEqual([check('8.9').op, check('8.9').threshold, check('8.9').frozenIn], ['le', 15_000_000, 13], 'the median tokens: 15 M, the 2.0.19 baseline (14.3 M) and a margin, frozen in this release (the user, 2026-10-27)');
  assert.deepEqual([check('10.3').threshold], [0.85], 'counter-example: 10.3 keeps its frozen threshold (the user, 2026-10-27)');
  assert.equal(card.adr, '0049');
  assert.equal(SC.adrLock(ROOT, card), SC.lockOf(card));
  assert.equal(card.criteria.reduce((a, k) => a + k.weight, 0), 100, 'the weights did not move');
});

test('13: the command prints each project and says "one agent"', async () => {
  const a = project('only', mix(1, 9));
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'scorecard.mjs'), '--projects', a], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /only/);
  assert.match(r.stdout, /one agent/i);
  assert.match(r.stdout, /10 tasks/);
});

// ---- the checks of what the hooks write read the records the measured version wrote ----
test('1.2: logic — a record another version wrote is not this version\'s to answer for; one with no version is the version of its date; none of this version is unmeasured', async () => {
  const VERSION = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim();
  const p = project('versions', mix(0, 4));
  for (let i = 0; i < 3; i++) P.appendRecord(p, { schema: 'waymark.record/v1', id: `2026-10-2${i} · T${20 + i}`, agent: 'claude', at: new Date(Date.UTC(2026, 9, 20 + i)).toISOString(), session: `old${i}`, level: 2, files: ['src/a.ts'], inputs: { waymark: '0.0.1' }, outcome: { result: 'parcial' } });
  assert.equal(await SC.measure('records.parcialShare', p), null, 'the three parcial of 0.0.1 are not counted, nor the four with no version before them (0.0.1 is the first named)');
  P.appendRecord(p, { schema: 'waymark.record/v1', id: '2026-10-25 · T30', agent: 'claude', at: new Date(Date.UTC(2026, 9, 25)).toISOString(), session: 'cur', level: 2, files: ['src/app.css'], inputs: { waymark: VERSION }, outcome: { result: 'parcial' }, cierre: '## Cierre\nResultado: parcial\nEvidencia: x\nAprendido: y' });
  assert.equal(await SC.measure('records.parcialShare', p), 1, 'CSS/HTML: a parcial this version wrote counts');
  const only = project('only-old', []);
  P.appendRecord(only, { schema: 'waymark.record/v1', id: '2026-10-20 · T1', agent: 'claude', at: new Date(Date.UTC(2026, 9, 20)).toISOString(), session: 'o', level: 2, files: ['a.ts'], inputs: { waymark: '0.0.1' }, outcome: { result: 'hecho' } });
  assert.equal(await SC.measure('records.parcialShare', only), null, 'counter-example: no record of this version: unmeasured, never passed');
});

test('1.2: a pre-release writes for the release it leads to: 2.0.19-dev counts for 2.0.19, 2.0.18-dev does not', async () => {
  const release = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim().replace(/-.*$/, '');
  const p = project('dev', mix(0, 1));
  P.appendRecord(p, { schema: 'waymark.record/v1', id: '2026-10-26 · T40', agent: 'claude', at: new Date(Date.UTC(2026, 9, 26)).toISOString(), session: 'dev1', level: 2, files: ['src/a.ts'], inputs: { waymark: `${release}-dev` }, outcome: { result: 'parcial' } });
  P.appendRecord(p, { schema: 'waymark.record/v1', id: '2026-10-26 · T41', agent: 'claude', at: new Date(Date.UTC(2026, 9, 26, 1)).toISOString(), session: 'dev2', level: 2, files: ['src/app.html'], inputs: { waymark: '0.0.1-dev' }, outcome: { result: 'parcial' } });
  assert.equal(await SC.measure('records.parcialShare', p), 1 / 2, 'the -dev of this release counts; another release\'s -dev does not');
});

// A record with no version (one only a commit's Waymark-Task trailer holds) is the version that ran at its date.
test('1.2: a record with no version takes the version that ran at its date: a commit of another release does not count for this one', async () => {
  const VERSION = fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'VERSION'), 'utf8').trim();
  const rec = (id, day, result, files, waymark) => P.appendRecord(p, { schema: 'waymark.record/v1', id, agent: 'claude', at: new Date(Date.UTC(2026, 9, day)).toISOString(), session: `v${day}`, level: 2, files, ...(waymark ? { inputs: { waymark } } : {}), outcome: { result } });
  const p = project('dated', []);
  rec('2026-10-20 · T1', 20, 'hecho', ['src/a.ts'], '0.0.1');
  rec('2026-10-21 · T2', 21, 'parcial', ['src/a.ts']); // logic: written while 0.0.1 ran
  rec('2026-10-22 · T3', 22, 'parcial', ['src/app.css', 'src/app.html']); // CSS/HTML: the same
  assert.equal(await SC.measure('records.parcialShare', p), null, 'the records with no version from 0.0.1\'s days are not this version\'s: unmeasured');
  rec('2026-10-25 · T4', 25, 'hecho', ['src/a.ts'], VERSION);
  rec('2026-10-26 · T5', 26, 'parcial', ['src/app.css']);
  assert.equal(await SC.measure('records.parcialShare', p), 1 / 2, 'counter-example: a record with no version from this version\'s days still counts');
});

test('15: the real-use report shows, per project, the tasks that used ego and how many of them kept up with their steps (no "revisited" finding)', async () => {
  const p = project('shop2', mix(0, 4));
  const rows = P.readRecords(P.projectHome(p).log).filter((r) => r.id);
  assert.equal(rows.length, 4);
  for (const [i, r] of rows.entries()) P.appendRecord(p, { ...r, id: `2026-10-2${i} · T1`, session: `e${i}`, observed: { eyes: { calls: 3, returns: i } }, findings: i < 2 ? [`ego was revisited ${i} time for 3 steps done (recorded, not blocked)`] : [] });
  const rep = await SC.projectsReport([p]);
  assert.deepEqual(rep.projects[0].egoReturns, { tasks: 4, keptUp: 2 }, 'two of the four tasks that used ego went back at every step');
  assert.match(SC.renderProjects(rep), /ego returns 2 of 4/);
  const none = await SC.projectsReport([project('plain', mix(0, 2))]);
  assert.equal(none.projects[0].egoReturns, null, 'counter-example: no task used ego, nothing to say');
});
