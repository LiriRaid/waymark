// Waymark 2.0.19 · point 13 (ADR 0049, decision 17 of the plan): the data a later learning step could read is prepared clean. `waymark.mjs report` writes an
// anonymous summary of the user's own usage patterns for them to read before sharing: counts and shapes, never a prompt, a path, a file name, code, a project name
// or an address. The verdict of a task is derived when read, from what happened after it, and left out when nothing did. Run: node --test tests/report.test.mjs
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-report-'));
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_ENGRAM = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const R = await import(`file://${SCRIPTS}/report.mjs`);

const git = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
// canary strings: any of them in the report is a leak
const CANARY = { prompt: 'CANARY-PROMPT-7f3a', file: 'canary-file-9b1c', project: 'canary-project-4d2e', mail: 'canary.person@example.invalid', code: 'canaryFunction8c5d', cierre: 'CANARY-CIERRE-2a6b' };
const project = (files) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-rep-')); temps.push(base);
  const d = path.join(base, CANARY.project);
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true }); git(d, 'init', '-q');
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '17.0.0' } }));
  const rows = [
    ['hecho', 'claude', 'claude-sonnet-5-5', 2, 'frontend', 4_000_000, 12, []],
    ['parcial', 'codex', 'gpt-5', 2, 'backend', 9_000_000, 70, [{ id: 'build', label: 'Build', applies: true, pass: false }, { id: 'spec', label: 'Tests', applies: true, pass: true }]],
    ['hecho', 'claude', 'claude-opus-5-5', 1, 'frontend', 300_000, 2, []],
  ];
  rows.forEach(([result, agent, model, level, dept, tokens, minutes, steps], i) => P.appendRecord(d, {
    schema: 'waymark.record/v1', id: `2026-10-2${i} · T${i + 1}`, agent, at: new Date(Date.UTC(2026, 9, 20 + i, 12)).toISOString(), session: `s${i}`, cwd: d, level,
    department: { declared: `dept-${dept}`, invoked: [`dept-${dept}`] }, prompt: `${CANARY.prompt} ${CANARY.mail}`, files: files.map((f) => `${d}/${f}`), commands: [`node ${CANARY.code}.mjs`],
    inputs: { model, waymark: '2.0.19' }, outcome: { result }, cierre: `## Cierre\nResultado: ${result}\nEvidencia: ${CANARY.cierre}\nAprendido: ${CANARY.code}`,
    evaluation: { tokens, steps, score: '8/9' }, observed: { time: { minutes } }, projectKind: { stack: 'angular', size: 's' },
  }));
  return d;
};
const leaks = (report) => Object.values(CANARY).filter((c) => JSON.stringify(report).includes(c));

test('13: logic — the report holds counts and shapes of the usage, and none of the canary strings', async () => {
  const d = project([`src/${CANARY.file}.service.ts`, `src/${CANARY.file}.service.spec.ts`]);
  const r = await R.buildReport([d]);
  assert.deepEqual(leaks(r), [], 'no prompt, path, file name, code, project name or address');
  assert.equal(r.schema, 'waymark.report/v1');
  assert.equal(r.tasks, 3);
  assert.deepEqual(r.counts.outcome, { hecho: 2, parcial: 1 });
  assert.deepEqual(r.counts.level, { 1: 1, 2: 2 });
  assert.deepEqual(r.counts.agent, { claude: 2, codex: 1 });
  assert.deepEqual(r.counts.modelFamily, { sonnet: 1, other: 1, opus: 1 }, 'a family, never a model id of a provider the list does not know');
  assert.deepEqual(r.counts.failedTestigo, { build: 1 }, 'the kind of testigo that failed');
  assert.deepEqual(r.counts.department, { frontend: 2, backend: 1 });
  assert.deepEqual(r.counts.stack, { angular: 3 });
  assert.deepEqual(r.counts.durationBucket, { 'under 5 min': 1, 'over 1 h': 1, '5-30 min': 1 }, 'buckets, not minutes');
  assert.ok(Object.keys(r.counts.durationBucket).every((k) => /min|h/.test(k)));
  assert.ok(Object.keys(r.counts.tokenBucket).every((k) => /k|M/.test(k)));
});

test('13: CSS/HTML — the same for style-only tasks: file names and templates never appear', async () => {
  const d = project([`src/${CANARY.file}.component.css`, `src/${CANARY.file}.component.html`]);
  const r = await R.buildReport([d]);
  assert.deepEqual(leaks(r), []);
  assert.ok(!JSON.stringify(r).includes('.css') && !JSON.stringify(r).includes('.html'));
});

test('13: counter-example — a report that carries a canary string is caught by the check the test uses', () => {
  assert.deepEqual(leaks({ counts: { x: CANARY.prompt }, note: `see ${CANARY.project}` }), [CANARY.prompt, CANARY.project]);
});

test('13: counter-example — values off the lists become "other"; nothing free-form passes through', async () => {
  const d = project(['src/a.ts']);
  P.appendRecord(d, { schema: 'waymark.record/v1', id: '2026-10-29 · T9', agent: 'my-secret-agent-name', at: new Date().toISOString(), session: 'x', level: 2, department: { declared: 'dept-canary-dept' }, inputs: { model: 'canary-model-123' }, outcome: { result: 'hecho' }, evaluation: { tokens: 10, steps: [{ id: 'canary-testigo', pass: false }] }, projectKind: { stack: 'canary-stack', size: 'enormous' } });
  const r = await R.buildReport([d]);
  assert.deepEqual(leaks(r), []);
  assert.ok(!JSON.stringify(r).match(/my-secret-agent-name|canary-dept|canary-model|canary-testigo|canary-stack|enormous/));
  assert.equal(r.counts.agent.other, 1);
  assert.ok(Object.keys(r.counts.level).every((k) => ['0', '1', '2', '3', 'Q', 'unknown', 'other'].includes(k)), 'the level passes a list too');
  assert.equal(r.counts.department.other, 1);
  assert.equal(r.counts.failedTestigo.other, 1);
});

test('13: the verdict is derived from what happened after: a revert, a rework, a follow-up; with no signal there is none', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-verdict-')); temps.push(d); git(d, 'init', '-q');
  fs.writeFileSync(path.join(d, 'a.txt'), '1\n'); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(d, 'a.txt'), '2\n'); git(d, 'commit', '-qam', 'the task');
  const sha = git(d, 'rev-parse', 'HEAD').stdout.trim();
  git(d, 'revert', '--no-edit', 'HEAD');
  const reverted = R.revertedCommits(d);
  assert.ok(reverted.has(sha), 'git revert names the commit it reverts');
  const rec = (id, extra = {}) => ({ id, ...extra });
  assert.equal(R.verdictOf(rec('2026-10-20 · T1', { commits: [sha] }), [], reverted), 'reverted');
  assert.equal(R.verdictOf(rec('2026-10-20 · T2'), [rec('2026-10-21 · T3', { reworks: ['2026-10-20 · T2'] })], new Set()), 'reworked');
  assert.equal(R.verdictOf(rec('2026-10-20 · T4'), [rec('2026-10-20 · T4b')], new Set()), 'continued');
  assert.equal(R.verdictOf(rec('2026-10-20 · T5', { commits: ['0000000'] }), [rec('2026-10-21 · T6')], reverted), null, 'counter-example: no signal, no verdict — never invented');
  assert.equal(R.verdictOf(rec('2026-10-20 · T7', { commits: [sha] }), [rec('2026-10-20 · T7b')], reverted), 'reverted', 'the strongest signal wins');
});

test('13: counter-example — a commit id shorter than git\'s shortest abbreviation never matches a reverted sha by prefix, whatever the sha is', () => {
  const reverted = new Set(['abcdef0123456789abcdef0123456789abcdef01']);
  assert.equal(R.verdictOf({ id: '2026-10-20 · T5', commits: ['abc'] }, [], reverted), null, 'three characters name nothing');
  assert.equal(R.verdictOf({ id: '2026-10-20 · T5', commits: ['abcdef0'] }, [], reverted), 'reverted', 'seven characters are a real abbreviation');
  assert.equal(R.verdictOf({ id: '2026-10-20 · T5', commits: ['abcdef0123456789abcdef0123456789abcdef01'] }, [], reverted), 'reverted');
});

test('13: the project kind is a label: the stack family and a size bucket; nothing else', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-kind-')); temps.push(d); git(d, 'init', '-q');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '17.0.0' } })); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'x');
  assert.deepEqual(R.projectKind(d), { stack: 'angular', size: 'xs' });
  const g = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-kind-')); temps.push(g);
  assert.deepEqual(R.projectKind(g), { stack: 'generic', size: 'xs' }, 'counter-example: no signal, the generic profile, never a guess');
});

test('13: the command prints the summary for the user to read, says it sends nothing, and writes a file on --out', () => {
  const d = project(['src/a.ts']);
  const out = path.join(home, 'my-report.json');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'report', d, '--out', out], { encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /never sends|sends nothing|nothing is sent/i);
  const file = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(file.tasks, 3);
  assert.deepEqual(leaks(file), []);
  assert.deepEqual(leaks(r.stdout), []);
});

test('13: new records carry the project kind through the end-of-turn hook', async () => {
  const { spawn } = await import('node:child_process');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-kindrec-')); temps.push(d); git(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark')); fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ dependencies: { '@angular/core': '17.0.0' } })); fs.writeFileSync(path.join(d, 'a.css'), 'a{}\n');
  git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base'); fs.writeFileSync(path.join(d, 'a.css'), 'a{color:red}\n');
  const at = () => new Date().toISOString(), tool = { type: 'tool_use', id: 'u1', name: 'Edit', input: { file_path: path.join(d, 'a.css') } };
  const lines = [{ type: 'user', uuid: 'p', timestamp: at(), message: { role: 'user', content: 'ajusta' } }, { type: 'assistant', timestamp: at(), message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-frontend' }, tool] } }, { type: 'user', timestamp: at(), message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'ok' }] } }];
  const transcript = path.join(d, 't.jsonl'); fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const id = P.taskIds(d).next;
  await new Promise((resolve) => {
    const c = spawn(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { env: { ...process.env, WAYMARK_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
    c.on('close', resolve);
    c.stdin.end(JSON.stringify({ transcript_path: transcript, cwd: d, session_id: 's-kind', stop_hook_active: true, last_assistant_message: `## Cierre · ${id}\nResultado: parcial (falta el hover)\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y` }));
  });
  assert.deepEqual(P.readRecords(P.projectHome(d).log).find((r) => r.id).projectKind, { stack: 'angular', size: 'xs' });
});
