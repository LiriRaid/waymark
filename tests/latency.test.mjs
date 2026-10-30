// Waymark 2.0.19 · hook latency: each hook reads the git notes once per run, not once per caller, and spawns at most a budget of
// git processes per event (deterministic, unlike milliseconds); hook-run.cjs writes each run's milliseconds and `check` warns when an
// event's p95 passes its cap. Run: node --test tests/latency.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });

// every git process this test process starts, by its arguments
const spawned = [];
const orig = cp.spawnSync;
cp.spawnSync = function (cmd, args, ...rest) { if (cmd === 'git') spawned.push((args || []).join(' ')); return orig.call(this, cmd, args, ...rest); };
syncBuiltinESMExports();
const N = await import(`file://${SCRIPTS}/notes.mjs`);

const gitT = (cwd, ...a) => orig('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
const repoWithNotes = (name) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-lat-${name}-`)); temps.push(d);
  gitT(d, 'init', '-q');
  fs.writeFileSync(path.join(d, 'app.css'), '.a{}\n'); fs.writeFileSync(path.join(d, 'a.ts'), 'export const a = 1;\n');
  gitT(d, 'add', '.'); gitT(d, 'commit', '-q', '-m', 'one');
  gitT(d, 'notes', `--ref=${N.NOTES_REF}`, 'add', '-m', '{"id":"2026-10-26 · T1"}', 'HEAD');
  return d;
};

test('latency: logic — three reads of the same notes ref read its notes once', () => {
  const d = repoWithNotes('logic');
  spawned.length = 0;
  for (let i = 0; i < 3; i++) assert.equal(N.readNotes(d).size, 1);
  assert.equal(spawned.filter((a) => /^cat-file/.test(a)).length, 1, `one cat-file for three reads: ${spawned.join(' | ')}`);
  assert.equal(spawned.filter((a) => /^notes .*list$/.test(a)).length, 1, 'one notes list for three reads');
  spawned.length = 0;
  assert.equal(N.readNotes(d, null, N.ANCHOR_REF).size, 0);
  assert.equal(spawned.filter((a) => /^(notes|cat-file)/.test(a)).length, 0, 'a ref with no notes reads nothing: its tip is known');
});

test('latency: CSS/HTML — the note of a styles commit is read once as well, and only the commits asked for come back', () => {
  const d = repoWithNotes('css');
  const head = gitT(d, 'rev-parse', 'HEAD').stdout.trim();
  spawned.length = 0;
  assert.equal(N.readNotes(d).size, 1);
  assert.deepEqual([...N.readNotes(d, [head]).keys()], [head]);
  assert.equal(N.readNotes(d, ['0'.repeat(40)]).size, 0, 'a commit with no note is not returned');
  assert.equal(spawned.filter((a) => /^cat-file/.test(a)).length, 1);
});

test('latency: counter-example — a note written by anyone is read on the next read, never the stale cache', () => {
  const d = repoWithNotes('write');
  assert.equal(N.readNotes(d).size, 1);
  fs.appendFileSync(path.join(d, 'app.css'), '.b{}\n'); gitT(d, 'commit', '-q', '-am', 'two');
  assert.ok(N.addNote(d, gitT(d, 'rev-parse', 'HEAD').stdout.trim(), '{"id":"2026-10-26 · T2"}'));
  assert.equal(N.readNotes(d).size, 2, 'a note Waymark writes moves the tip and is read');
  gitT(d, 'notes', `--ref=${N.NOTES_REF}`, 'add', '-f', '-m', '{"cierre":"editada"}', 'HEAD'); // another process edits a note
  assert.equal(N.readNotes(d).get(gitT(d, 'rev-parse', 'HEAD').stdout.trim()), '{"cierre":"editada"}', 'an edited note is read as it is now');
  spawned.length = 0; N.readNotes(d);
  assert.deepEqual(spawned, [], 'with nothing written, the tip is read from .git and nothing is asked');
});

// ---- the tips and HEAD from .git's own files, and the notes of a tip kept on disk for the next process ----
const G = await import(`file://${SCRIPTS}/lib/git.mjs`);
const asGit = (d, ref) => gitT(d, 'rev-parse', '-q', '--verify', ref).stdout.trim() || null;
test('latency: logic — the tips and HEAD read from the files are git\'s own, loose, packed and in a worktree', () => {
  const d = repoWithNotes('files');
  const tips = () => [...N.noteTips(d)].sort(), viaGit = () => gitT(d, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/notes/').stdout.trim().split('\n').map((l) => l.split(' ')).sort();
  assert.deepEqual(tips(), viaGit(), 'loose refs');
  assert.equal(N.headSha(d), asGit(d, 'HEAD'));
  gitT(d, 'pack-refs', '--all');
  assert.deepEqual(tips(), viaGit(), 'packed refs');
  assert.equal(N.headSha(d), asGit(d, 'HEAD'), 'HEAD through a packed branch');
  const wt = path.join(path.dirname(d), `${path.basename(d)}-wt`); temps.push(wt);
  gitT(d, 'worktree', 'add', '-q', '--detach', wt, 'HEAD');
  assert.equal(N.headSha(wt), asGit(d, 'HEAD'), 'a worktree: its own HEAD, the common refs');
  assert.deepEqual([...N.noteTips(wt)].sort(), viaGit());
  const empty = path.join(path.dirname(d), `${path.basename(d)}-empty`); temps.push(empty); fs.mkdirSync(empty); gitT(empty, 'init', '-q');
  assert.equal(N.headSha(empty), null, 'counter-example: a repo with no commit has no HEAD');
});
test('latency: logic — a new process reads the notes of an unchanged tip from disk, with no git call; a moved tip is read again', () => {
  const d = repoWithNotes('disk');
  const run = () => orig(process.execPath, ['--input-type=module', '-e', `import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module'; const o = cp.spawnSync; let n = 0; cp.spawnSync = function (c, a, ...r) { if (c === 'git') n++; return o.call(this, c, a, ...r); }; syncBuiltinESMExports(); const N = await import(${JSON.stringify(`file://${SCRIPTS}/notes.mjs`)}); const size = N.readNotes(${JSON.stringify(d)}).size; console.log(JSON.stringify({ n, size }));`], { encoding: 'utf8', env: { ...process.env } });
  const first = JSON.parse(run().stdout), second = JSON.parse(run().stdout);
  assert.deepEqual([first.size, first.n > 0], [1, true], 'the first process lists the notes');
  assert.deepEqual(second, { n: 0, size: 1 }, 'the next one reads them from disk');
  gitT(d, 'notes', `--ref=${N.NOTES_REF}`, 'add', '-f', '-m', '{"cierre":"otra"}', 'HEAD');
  const moved = JSON.parse(run().stdout);
  assert.ok(moved.n > 0, 'counter-example: a moved tip is listed again, never the stale file');
});
test('latency: counter-example — where the files cannot say (GIT_DIR, no repo, a reftable), git is asked as before', () => {
  const d = repoWithNotes('fallback');
  assert.equal(G.gitDirs(path.join(os.tmpdir(), 'no-such-repo-anywhere')), null);
  process.env.GIT_DIR = path.join(d, '.git');
  try { assert.equal(G.gitDirs(d), null); assert.equal(N.headSha(d), asGit(d, 'HEAD'), 'still right, through git'); } finally { delete process.env.GIT_DIR; }
  fs.mkdirSync(path.join(d, '.git', 'reftable'));
  assert.equal(G.gitDirs(d), null, 'a reftable repo is left to git');
});

// ---- each hook as the agent starts it (node hook-run.cjs <hook>): the git processes it spawns, counted by a preload ----
const counter = (dir) => {
  const f = path.join(dir, 'count.mjs');
  fs.writeFileSync(f, `import cp from 'node:child_process'; import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const o = cp.spawnSync; let n = 0; cp.spawnSync = function (c, a, ...r) { if (c === 'git') n++; return o.call(this, c, a, ...r); }; syncBuiltinESMExports();
process.on('exit', () => fs.appendFileSync(process.env.WM_COUNT, n + '\\n'));\n`);
  return f;
};
const project = (name) => {
  const d = repoWithNotes(name), home = path.join(d, '..', `${path.basename(d)}-home`); temps.push(home);
  fs.mkdirSync(path.join(d, '.waymark')); fs.mkdirSync(home);
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n- ▶ [2026-10-26 · T1] waiting\n\n## Quality gates\n| Gate | Command |\n|---|---|\n| test | node --test |\n');
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  for (const ref of [N.ANCHOR_REF, N.LOG_REF]) gitT(d, 'notes', `--ref=${ref}`, 'add', '-m', '{"m":"x"}', 'HEAD');
  return { d, home };
};
const lines = (file) => [{ type: 'user', uuid: 'p1', message: { role: 'user', content: 'cambia el color del botón' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-frontend' }] } }, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } }];
// The most git processes each event may start on this small project; a new caller that reads the same refs again shows here first.
const BUDGET = { SessionStart: 21, UserPromptSubmit: 21, PreToolUse: 1, Stop: 19 };
function spawnsOf(event, hook, input, { d, home }) {
  const count = path.join(home, `${event}.count`), t = path.join(home, 't.jsonl');
  fs.writeFileSync(t, lines(path.join(d, 'app.css')).map((l) => JSON.stringify(l)).join('\n') + '\n');
  const r = orig(process.execPath, ['--import', `file://${counter(home)}`, path.join(SCRIPTS, 'hook-run.cjs'), path.join(SCRIPTS, hook)], { input: JSON.stringify({ session_id: 'lat', transcript_path: t, cwd: d, hook_event_name: event, ...input }), cwd: d, encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home, WM_COUNT: count } });
  assert.ok(fs.existsSync(count), `${hook} ran: ${r.stderr}`);
  return Number(fs.readFileSync(count, 'utf8').trim().split('\n').pop());
}

test('latency: logic — each event starts at most its budget of git processes', () => {
  const p = project('budget');
  const got = {
    SessionStart: spawnsOf('SessionStart', 'session-hook.mjs', { source: 'startup' }, p),
    UserPromptSubmit: spawnsOf('UserPromptSubmit', 'rule0-hook.mjs', { prompt: 'arregla el cálculo del total' }, p),
    PreToolUse: spawnsOf('PreToolUse', 'tool-hook.mjs', { tool_name: 'Bash', tool_input: { command: 'node --test' } }, p),
    Stop: spawnsOf('Stop', 'stop-hook.mjs', { stop_hook_active: false }, p),
  };
  for (const [event, n] of Object.entries(got)) assert.ok(n <= BUDGET[event], `${event} started ${n} git processes, budget ${BUDGET[event]} (${JSON.stringify(got)})`);
});

test('latency: CSS/HTML — an Edit of a stylesheet starts no more git processes than its budget', () => {
  const p = project('css-edit');
  assert.ok(spawnsOf('PreToolUse', 'tool-hook.mjs', { tool_name: 'Edit', tool_input: { file_path: path.join(p.d, 'app.css'), old_string: '.a', new_string: '.b' } }, p) <= BUDGET.PreToolUse);
});

// The folders a command names are asked to git only when there are some (tests/false-fails.test.mjs holds the cases that name one).
test('latency: logic + CSS/HTML — a shell command that writes a file of the project and names no other folder starts no git process', () => {
  const p = project('shell-write');
  const bash = (command) => spawnsOf('PreToolUse', 'tool-hook.mjs', { tool_name: 'Bash', tool_input: { command } }, p);
  assert.equal(bash('node build.mjs > out.txt'), 0, 'logic: a redirect inside the project');
  assert.equal(bash('sed -i s/a/b/ app.css'), 0, 'CSS/HTML: an edit of a stylesheet');
});

test('latency: the memory an edit carries loads from pack.mjs, not from the whole CLI, and the CLI command is the same function', async () => {
  const hook = fs.readFileSync(path.join(SCRIPTS, 'tool-hook.mjs'), 'utf8');
  assert.doesNotMatch(hook, /import\(\s*['"]\.\/waymark\.mjs['"]\s*\)/, 'the tool hook loads no CLI');
  const [cli, light] = await Promise.all([import(`file://${SCRIPTS}/waymark.mjs`), import(`file://${SCRIPTS}/pack.mjs`)]);
  assert.equal(cli.pack, light.pack, 'one function, two doors');
  const d = repoWithNotes('pack-file');
  assert.match(light.pack(d, ['app.css']), /^app\.css:/, 'a file with a commit and no task record is listed');
});

// ---- point 17(a): each run is tied to its project, its session and the size of its transcript, so a slow Stop can be read against a long session ----
test('latency: every hook tags its run with project, session and the transcript\'s size in KB; a row with no tag is still read', () => {
  const p = project('tag');
  const runs = [['PreToolUse', 'tool-hook.mjs', { tool_name: 'Read', tool_input: { file_path: path.join(p.d, 'a.ts') } }], ['UserPromptSubmit', 'rule0-hook.mjs', { prompt: 'arregla el cálculo' }], ['Stop', 'stop-hook.mjs', { stop_hook_active: false }], ['SessionStart', 'session-hook.mjs', { source: 'startup' }]];
  for (const [event, hook, input] of runs) spawnsOf(event, hook, input, p);
  const log = fs.readFileSync(path.join(p.home, 'latency.log'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
  assert.equal(log.length, 4);
  for (const row of log) assert.match(row[3] || '', new RegExp(`^${path.basename(p.d)}:lat:[1-9]\\d*$`), `${row[1]}: ${row[3]}`);
});

// ---- the milliseconds of real use: hook-run.cjs writes each run, `check` names an event over its cap ----
test('latency: hook-run.cjs writes the hook and its milliseconds; check warns only for an event whose p95 passes its cap', async () => {
  const p = project('log');
  spawnsOf('PreToolUse', 'tool-hook.mjs', { tool_name: 'Read', tool_input: { file_path: path.join(p.d, 'a.ts') } }, p);
  const log = fs.readFileSync(path.join(p.home, 'latency.log'), 'utf8').trim().split('\n').map((l) => l.split('\t'));
  assert.equal(log.length, 1);
  assert.equal(log[0][1], 'tool-hook');
  assert.ok(Number(log[0][2]) > 0, 'milliseconds');
  const W = await import(`file://${SCRIPTS}/waymark.mjs`);
  const now = Date.now(), at = new Date(now - 60000).toISOString();
  const write = (rows) => fs.writeFileSync(path.join(p.home, 'latency.log'), rows.map(([h, ms]) => `${at}\t${h}\t${ms}\n`).join(''));
  process.env.WAYMARK_HOME = p.home;
  try {
    write([...Array(20).fill(['rule0-hook', 900]), ...Array(20).fill(['tool-hook', 120])]);
    assert.equal(W.latencyLine(now), '', 'counter-example: within the caps nothing is said');
    write([...Array(19).fill(['rule0-hook', 900]), ['rule0-hook', 4000], ...Array(20).fill(['stop-hook', 3000])]);
    const line = W.latencyLine(now);
    assert.match(line, /Stop p95 3\.0 s > 2\.3 s/);
    assert.doesNotMatch(line, /UserPromptSubmit/, 'one slow run in twenty is not the p95');
  } finally { delete process.env.WAYMARK_HOME; }
});
