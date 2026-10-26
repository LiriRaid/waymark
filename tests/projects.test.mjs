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

test('13: the card has the three checks, one pending, and its lock names ADR 0049', async () => {
  const card = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'scorecard.json'), 'utf8'));
  const check = (id) => card.criteria.flatMap((c) => c.checks).find((c) => c.id === id);
  assert.deepEqual([check('13.6').measure, check('13.6').op, check('13.6').threshold], ['records.parcialShare', 'le', 0.2]);
  assert.deepEqual([check('9.9').measure, check('9.9').op, check('9.9').threshold], ['records.agentSpread', 'ge', 2]);
  assert.equal(check('8.9').threshold, null, 'the median tokens are pending: frozen from this release\'s baseline');
  assert.ok(Number.isInteger(check('8.9').frozenIn));
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
