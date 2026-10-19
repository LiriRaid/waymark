// Waymark 2.0.3 · point 5: it learns for real. The hook writes what it observes (Quality gates verified, the Project
// map's areas, the count of repeated procedures); the rest is proposed (a project skill, a Learned rule of the owner
// department, a preference) once in the session card and in check, and written only after the user's yes.
// Run: node --test tests/*.test.mjs. Every test uses a temporary WAYMARK_HOME and project; nothing real is touched.
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-learn-t-'));
const agentsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-learn-h-'));
const temps = [home, agentsHome];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
Object.assign(process.env, {
  WAYMARK_ENGRAM: '', WAYMARK_HOME: home, WAYMARK_AGENTS_HOME: agentsHome, WAYMARK_BACKUPS: path.join(home, 'backups'),
  WAYMARK_REPO: 'invalid/none', WAYMARK_NO_GH: '1', WAYMARK_CLAUDE_JSON: path.join(home, 'none.json'), WAYMARK_CLAUDE_PROJECTS: path.join(home, 'none'),
  WAYMARK_CLAUDE_SETTINGS: path.join(home, 'claude-settings.json'),
});
const L = await import(`file://${SCRIPTS}/learn.mjs`);
const P = await import(`file://${SCRIPTS}/provenance.mjs`);

const gitT = (repo, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, encoding: 'utf8' });
const repoAt = (name) => { const d = fs.mkdtempSync(path.join(os.homedir(), `.wm-learn-${name}-`)); temps.push(d); gitT(d, 'init', '-q'); return d; };
const MEMORY = `# P

## Work in progress

## Identity
- Stack: test

## Project map
- Source root and layout: src/

## Quality gates (verified commands)
| Gate | Command | Verified |
|---|---|---|
| typecheck | none (plain JavaScript) | not verified |
| lint (changed files) | \`node --check <file>\` | not verified |
| test (related) | | |
| test (full) | | |
| build | \`pnpm build:prod\` | 2026-01-01 |

## Repeated procedures
| Procedure | Times | Project skill |
|---|---|---|

## Project skills
`;
const withMemory = (repo) => {
  fs.mkdirSync(path.join(repo, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.waymark', 'memory.md'), MEMORY);
  fs.appendFileSync(path.join(repo, '.git', 'info', 'exclude'), '.waymark/\n');
  return repo;
};
const row = (text, gate) => text.split('\n').find((l) => l.startsWith(`| ${gate} |`));
const rec = (id, extra = {}) => ({ id, agent: 'claude', at: '2026-10-12T10:00:00.000Z', cierre: `## Cierre · ${id}\nResultado: hecho\nAprendido: lo de ${id} ← evidencia`, files: [], commands: [], ...extra });
const passed = (cmd) => ({ observed: { gate: { by: 'agent', cmd, ok: true }, gates: [{ cmd, s: 3, error: false }] }, evaluation: { steps: { Verificar: true } } });

test('quality gates: a gate that passed after the last change dates its row and fills an empty one; a written command is never replaced', () => {
  const ok = passed('node --check src/a.mjs && node --test tests/*.test.mjs && pnpm build');
  const next = L.learnGates(MEMORY, rec('2026-10-12 · T1', ok), '2026-10-12');
  assert.match(row(next, 'lint (changed files)'), /`node --check <file>` \| 2026-10-12 \|$/, 'a <placeholder> in the row matches the file');
  assert.equal(row(next, 'test (full)'), '| test (full) | `node --test tests/*.test.mjs` | 2026-10-12 |', 'an empty row takes the part that was the gate');
  assert.equal(row(next, 'test (related)'), '| test (related) | | |', 'a part naming a file is not a general command');
  assert.equal(row(next, 'typecheck'), row(MEMORY, 'typecheck'), 'none (…) stays');
  assert.equal(row(next, 'build'), row(MEMORY, 'build'), 'another command for the same gate does not replace yours');
  assert.equal(L.learnGates(next, rec('2026-10-12 · T1', ok), '2026-10-12'), next, 'idempotent');
  const red = { ...ok, evaluation: { steps: { Verificar: false } } };
  assert.equal(L.learnGates(MEMORY, rec('2026-10-12 · T2', red), '2026-10-12'), MEMORY, 'Verificar ✘: nothing is written');
  const loop = passed('for f in $(git ls-files); do node --check "$f"; done; node --test $T');
  assert.equal(L.learnGates(MEMORY, rec('2026-10-12 · T3', loop), '2026-10-12'), MEMORY, 'no loops or $variables in the table');
});

test('project map: one line per folder touched, with its last task and Aprendido; newest first, at most 12, the user\'s lines kept', () => {
  const root = path.join(os.tmpdir(), 'proj');
  const files = ['src/app/a.ts', 'src/app/b.ts', 'tests/x.test.mjs', 'README.md', '../other/z.ts'].map((f) => path.join(root, f));
  const one = L.learnAreas(MEMORY, rec('2026-10-12 · T1', { files }), root);
  const map = one.match(/## Project map\n([\s\S]*?)\n## /)[1];
  assert.match(map, /^- Source root and layout: src\/$/m, 'the user\'s line stays');
  assert.match(map, /^- Areas \(hook: last task per folder\):$/m);
  assert.match(map, /^ {2}- src\/app\/ — 2026-10-12 · T1 · lo de 2026-10-12 · T1 ← evidencia$/m);
  assert.match(map, /^ {2}- tests\/ — 2026-10-12 · T1/m);
  assert.match(map, /^ {2}- \(root\) — 2026-10-12 · T1/m);
  assert.doesNotMatch(map, /other/, 'files outside the project are not its map');
  const two = L.learnAreas(one, rec('2026-10-12 · T2', { files: [path.join(root, 'src', 'app', 'c.ts')] }), root);
  const areas = two.match(/- Areas[^\n]*\n((?: {2}- [^\n]*\n?)*)/)[1].replace(/\n+$/, '').split('\n');
  assert.match(areas[0], /^ {2}- src\/app\/ — 2026-10-12 · T2/, 'the newest first, no duplicate');
  assert.equal(areas.filter((l) => l.includes('src/app/')).length, 1);
  let many = MEMORY;
  for (let i = 0; i < 15; i++) many = L.learnAreas(many, rec(`2026-10-12 · T${i + 10}`, { files: [path.join(root, `dir${i}`, 'f.ts')] }), root);
  assert.equal(many.match(/- Areas[^\n]*\n((?: {2}- [^\n]*\n?)*)/)[1].trim().split('\n').length, 12);
});

const deploy1 = rec('2026-10-01 · T1', { commands: ['pnpm build', 'firebase deploy --only hosting', 'git tag v1', 'git push --tags'] });
const deploy2 = rec('2026-10-02 · T1', { commands: ['cat firebase.json', 'pnpm build && firebase deploy --only hosting', 'git tag v2 && git status'] });
const routine = (id) => rec(id, { commands: ['node --test tests/a.test.mjs', 'git add -A', 'git commit -m "x"', 'git push'] });

test('repeated procedures: the same sequence of action commands in 2 tasks is counted; reads and the routine (gates, add, commit, push) alone are not', () => {
  const loop = (id) => rec(id, { commands: ['for f in $(git status --short | awk \'{print $2}\'); do node --check "$f" || echo "FAIL $f"; done; [ -d s ] && cp -r s/x repo/x', 'git add -A', 'git commit -m "y"'] });
  assert.deepEqual(L.procedures([loop('2026-10-05 · T1'), loop('2026-10-06 · T1')]), [], 'loop fragments are no steps; copying and committing are routine');
  const inline = (id) => rec(id, { commands: ["node - <<'EOF'\nconst x = 1;\nlet y = 2;\nEOF", 'node -e "console.log(1)"', "node --input-type=module -e '\nimport fs from \"node:fs\";\nconst s = 1;'", "node -e '\nimport fs from \"node:fs\";\nconst cut = (a recorded command clipped", 'git add -A', 'git commit -m z'] });
  assert.deepEqual(L.procedures([inline('2026-10-05 · T2'), inline('2026-10-06 · T2')]), [], 'a heredoc\'s body and inline code are no steps');
  const pub = (id, pm) => rec(id, { commands: [`${pm} build`, 'firebase deploy', 'git tag v'] });
  assert.equal(L.procedures([pub('2026-10-07 · T1', 'npm'), pub('2026-10-08 · T1', 'npm'), pub('2026-10-09 · T1', 'pnpm'), pub('2026-10-10 · T1', 'pnpm')]).length, 2, 'npm build is no part of pnpm build');
  const procs = L.procedures([deploy1, routine('2026-10-03 · T1'), deploy2, routine('2026-10-04 · T1')]);
  assert.deepEqual(procs.map((p) => [p.steps.join(' → '), p.ids]), [['pnpm build → firebase deploy → git tag', ['2026-10-01 · T1', '2026-10-02 · T1']]]);
  const next = L.learnProcedures(MEMORY, procs);
  assert.match(next, /\| pnpm build → firebase deploy → git tag \| 2 \(2026-10-01 · T1, 2026-10-02 · T1\) \| \|/);
  assert.equal(L.learnProcedures(next, procs), next, 'idempotent');
  const mine = next.replace('2026-10-02 · T1) | |', '2026-10-02 · T1) | `release` |');
  assert.match(L.learnProcedures(mine, procs), /\| `release` \|/, 'the user\'s Project skill cell stays');
});

test('corrections: a user correction repeated in 2 tasks is a preference proposal, unless preferences.md already says it', () => {
  const recs = [rec('2026-10-01 · T1', { prompt: 'no, nunca uses any en los tipos' }), rec('2026-10-02 · T1', { prompt: 'te dije que nunca uses any en los tipos de los servicios' }), rec('2026-10-03 · T1', { prompt: 'agrega un botón de guardar' })];
  const c = L.corrections(recs, '');
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].ids, ['2026-10-01 · T1', '2026-10-02 · T1']);
  assert.match(c[0].text, /nunca uses any/);
  const more = L.corrections([...recs, rec('2026-10-04 · T1', { prompt: 'otra vez: nunca uses any en los tipos, ni en los servicios de pagos' })], '');
  assert.equal(more[0].first, c[0].first, 'a later correction keeps the proposal\'s key (its oldest clause)');
  assert.deepEqual(L.corrections(recs, '# Preferences\n- [2026-10-02] Nunca uses any en los tipos.\n'), [], 'already a preference');
  const long = [rec('2026-10-04 · T1', { prompt: 'sí haz el punto 1 y lo de las notas de waymark, y otra cosa: nunca abras el navegador sin preguntar' }),
    rec('2026-10-05 · T1', { prompt: 'revisa el punto 3 de las notas de waymark, y que nunca se guarden las skills en la carpeta del agente' })];
  assert.deepEqual(L.corrections(long, ''), [], 'two different corrections in prompts that share other words');
});

test('proposals: skill, Learned rule of the owner department, preference; said once in the session card, listed by check', async () => {
  const repo = withMemory(repoAt('prop'));
  const fail = (id) => rec(id, { department: { declared: 'dept-qa' }, evaluation: { steps: { Tests: false } } });
  const recs = [deploy1, deploy2, fail('2026-10-05 · T1'), fail('2026-10-06 · T1'), fail('2026-10-07 · T1'),
    rec('2026-10-08 · T1', { prompt: 'nunca hagas push sin preguntarme' }), rec('2026-10-09 · T1', { prompt: 'te dije: nunca hagas push sin preguntarme antes' })];
  for (const r of recs) P.appendRecord(repo, r);
  const all = L.proposals(P.projectHome(repo), P.readTaskRecords(P.projectHome(repo)));
  assert.deepEqual(all.map((p) => p.kind).sort(), ['preference', 'rule', 'skill']);
  assert.match(all.find((p) => p.kind === 'rule').text, /dept-qa[^\n]*Learned rules/);
  const run = () => JSON.parse(spawnSync(process.execPath, [path.join(SCRIPTS, 'session-hook.mjs')], { input: JSON.stringify({ cwd: repo }), encoding: 'utf8' }).stdout).hookSpecificOutput.additionalContext;
  const first = run();
  assert.match(first, /Proposals \(said once[^\n]*project skill[^\n]*pnpm build → firebase deploy → git tag/, first);
  assert.match(first, /Proposals[^\n]*Learned rule[^\n]*dept-qa/);
  assert.match(first, /Proposals[^\n]*preference[^\n]*nunca hagas push/);
  assert.doesNotMatch(run(), /Proposals \(said once/, 'said once');
  const { check } = await import(`file://${SCRIPTS}/waymark.mjs`);
  const items = await check(repo);
  assert.ok(items.some((t) => /^procedure: .*pnpm build → firebase deploy → git tag.*Generate a project skill/.test(t)), items.join('\n'));
  assert.ok(items.some((t) => /^preference: .*nunca hagas push.*preferences\.md/.test(t)));
  assert.ok(items.some((t) => /^rule: Tests failed 3× .*dept-qa/.test(t)));
});

test('learn(): the end-of-turn writes gates, areas and the procedures table into memory.md, and nothing for a Q', () => {
  const repo = withMemory(repoAt('learn'));
  const home = P.projectHome(repo);
  const r = rec('2026-10-12 · T5', { ...passed('node --test tests/*.test.mjs'), files: [path.join(repo, 'lib', 'x.mjs')] });
  L.learn(home, r, [deploy1, deploy2, r], new Date('2026-10-12T12:00:00'));
  const text = fs.readFileSync(home.memory, 'utf8');
  assert.match(row(text, 'test (full)'), /2026-10-12/);
  assert.match(text, / {2}- lib\/ — 2026-10-12 · T5/);
  assert.match(text, /\| pnpm build → firebase deploy → git tag \| 2/);
  const before = fs.readFileSync(home.memory, 'utf8');
  L.learn(home, { ...r, id: undefined, kind: 'Q' }, [], new Date());
  assert.equal(fs.readFileSync(home.memory, 'utf8'), before);
});
