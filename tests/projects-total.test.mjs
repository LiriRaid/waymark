// Waymark 2.0.21 · failure 19 of docs/plans/2.0.21.md (ADR 0059): the five checks of real use read the projects the user lists in ~/.waymark/projects.md, not only
// the repository the scorecard runs in. Synthetic projects with known shares. Run: node --test tests/projects-total.test.mjs
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-total-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_ENGRAM = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const SC = await import(`file://${SCRIPTS}/scorecard.mjs`);

let n = 0;
const link = (responses, input, cacheWrite, cacheRead, output) => ({ responses, input, cacheWrite, cacheRead, output });
// a task whose routine share is routine / (routine + work) of its units
const heavy = { routine: link(5, 0, 0, 5000, 0), work: link(5, 0, 0, 5000, 0), reply: link(0, 0, 0, 0, 0) };
const lean = { routine: link(1, 0, 0, 1000, 0), work: link(19, 0, 0, 19000, 0), reply: link(0, 0, 0, 0, 0) };
const evalOf = (l, tokens) => ({ score: '8/9', tokens, links: { v: 1, ...l } });
// a project; each task { agent, level, day (offset, orders the tasks across projects), result, tokens, links }
const project = (name, tasks) => {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wm-tot-')), name); temps.push(path.dirname(d));
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); spawnSync('git', ['init', '-q'], { cwd: d });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  tasks.forEach((t, i) => P.appendRecord(d, {
    schema: 'waymark.record/v1', id: `2026-10-${String(10 + (i % 15)).padStart(2, '0')} · T${i + 1}`, agent: t.agent || 'claude', at: new Date(Date.UTC(2026, 9, 10, 12, 0, t.day ?? i)).toISOString(), session: `s${++n}`, level: t.level ?? 2,
    files: ['src/a.ts'], outcome: { result: t.result || 'hecho' }, evaluation: evalOf(t.links || lean, t.tokens ?? 1_000_000), cierre: t.cierre ?? '## Cierre\nResultado: hecho\nEvidencia: x\nAprendido: y',
  }));
  return d;
};
// ~/.waymark/projects.md as the user keeps it: the Path column
const list = (...roots) => fs.writeFileSync(path.join(home, 'projects.md'), ['# Projects', '', '| Project | Path | Stack |', '|---|---|---|', ...roots.map((r, i) => `| p${i} | ${r.replace(/\\/g, '/')} | x |`), ''].join('\n'));

test('19: 9.9 — two agents over the tasks of the release, whatever projects they were closed in: the root alone has one', async () => {
  const web = project('web', Array.from({ length: 40 }, (_, i) => ({ agent: 'claude', day: 100 + i })));
  const api = project('api', [{ agent: 'codex', day: 1 }, { agent: 'codex', day: 2 }]);
  list();
  assert.equal(await SC.measure('records.agentSpread', web), 1, 'no project listed: this repository only');
  list(web, api);
  assert.equal(await SC.measure('records.agentSpread', web), 2, 'the codex tasks are 40 tasks back, outside any window of 30, and still count for the release');
  list(api, web, '/nowhere/not-a-project');
  assert.equal(await SC.measure('records.agentSpread', web), 2, 'the root listed itself or a path that is not there changes nothing');
});

test('19: 13.6 and 8.9 — the parcial share and the median tokens are those of the last 30 tasks of all the projects together', async () => {
  const web = project('web', [...Array.from({ length: 10 }, (_, i) => ({ day: 10 + i, result: 'hecho', tokens: 1_000_000 })), ...Array.from({ length: 10 }, (_, i) => ({ day: 40 + i, result: 'parcial', tokens: 3_000_000 }))]);
  const api = project('api', Array.from({ length: 20 }, (_, i) => ({ day: 20 + i, result: 'hecho', tokens: 1_000_000, agent: 'codex' })));
  list(web, api);
  assert.equal(await SC.measure('records.parcialShare', web), 10 / 30, 'the last 30 by date: 10 parcial of web and 20 hecho of api');
  assert.equal(await SC.measure('records.medianTokens', web), 1_000_000);
  list();
  assert.equal(await SC.measure('records.parcialShare', web), 10 / 20, 'this repository alone');
});

test('19: 8.6 and 8.7 — the routine share of the last 10 L2 and the last 5 L1 tasks, ordered by date across the projects', async () => {
  const web = project('web', Array.from({ length: 5 }, (_, i) => ({ level: 2, day: 10 + i, links: heavy })));
  const api = project('api', Array.from({ length: 10 }, (_, i) => ({ level: 2, day: 50 + i, links: lean })));
  list(web, api);
  assert.equal(Math.round((await SC.measure('cost.routineShareL2', web)) * 1000) / 1000, 0.05, 'the last 10 L2 by date are all the lean ones of api');
  list();
  assert.equal(Math.round((await SC.measure('cost.routineShareL2', web)) * 1000) / 1000, 0.5, 'this repository alone: its heavy ones');
  const l1 = project('l1', [{ level: 1, day: 1, links: heavy }, { level: 1, day: 2, links: lean }]);
  list(l1);
  assert.equal(Math.round((await SC.measure('cost.routineShareL1', web)) * 1000) / 1000, Math.round((await SC.measure('cost.routineShareL1', l1)) * 1000) / 1000, 'an L1 window with tasks only in another project reads that project');
});

test('19: counter-example — the checks of the quality of the records and the chain still read this repository only', async () => {
  const web = project('web', Array.from({ length: 4 }, (_, i) => ({ day: i })));
  const api = project('api', Array.from({ length: 4 }, (_, i) => ({ day: 10 + i, cierre: 'sin cierre' })));
  list(web, api);
  assert.equal(await SC.measure('records.cierreShare', web), await (async () => { list(); return SC.measure('records.cierreShare', web); })(), 'the Cierre share of another project does not enter');
});

// ---- review of failure 19 (2026-11-18) ----
test('19 (review): scorecard --projects reads 9.9 over the release too, so the report and the card say the same', async () => {
  const web = project('web', Array.from({ length: 40 }, (_, i) => ({ agent: 'claude', day: 100 + i })));
  const api = project('api', [{ agent: 'codex', day: 1 }, { agent: 'codex', day: 2 }, ...Array.from({ length: 33 }, (_, i) => ({ agent: 'claude', day: 10 + i }))]);
  list();
  const r = await SC.projectsReport([web, api]);
  assert.equal(r.checks.find((c) => c.id === '9.9').value, 2, 'the codex tasks are outside the last 30 of api and still count for the release');
});

test('19 (review): on Windows a project listed with another letter case is the same project, read once (nothing to compare on a case-sensitive system)', async () => {
  if (process.platform !== 'win32') return; // no letter-case alias of a path exists there
  const web = project('web', [...Array.from({ length: 5 }, (_, i) => ({ level: 2, day: 10 + i, links: heavy })), ...Array.from({ length: 5 }, (_, i) => ({ level: 2, day: 20 + i, links: lean }))]);
  list(web.toUpperCase());
  assert.equal(Math.round((await SC.measure('cost.routineShareL2', web)) * 1000) / 1000, 0.2, 'its 10 L2 tasks once: 30,000 routine units of 150,000, not the lean ones twice (0.05)');
});
