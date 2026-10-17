// Waymark 2.0.18 · point 7: the notes reach a remote without a manual step, and `verify --remote` checks the copy (docs/adr/0035).
// Run: node --test tests/*.test.mjs. The remote is a bare repository in a temp folder: intact, local rewrite, remote rewrite, no remote.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-remote-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
process.env.WAYMARK_SIGNING_KEY = '';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const V = await import(`file://${SCRIPTS}/verify.mjs`);
const N = await import(`file://${SCRIPTS}/notes.mjs`);
const R = await import(`file://${SCRIPTS}/notes-remote.mjs`);
const { sha } = await import(`file://${SCRIPTS}/lib/hash.mjs`);

const day = new Date().toLocaleDateString('sv');
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-rem-${name}-`)); temps.push(d); return d; };
const gitIn = (cwd, ...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd, encoding: 'utf8' });
const rec = (n) => ({ id: `${day} · T${n}`, agent: 'claude', at: new Date().toISOString(), session: 's1', files: [], commits: [], prompt: `pedido ${n}`, cierre: `## Cierre · ${day} · T${n}\nResultado: hecho\nEvidencia: observada x\nAprendido: y ← z` });
const bare = () => { const d = tmp('bare'); gitIn(d, 'init', '-q', '--bare'); return d; };
function project(remote = null) {
  const d = tmp('proj');
  gitIn(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'x'); gitIn(d, 'add', 'a.txt'); gitIn(d, 'commit', '-q', '-m', 'init');
  if (remote) gitIn(d, 'remote', 'add', 'origin', remote);
  return d;
}
const lineOf = (r, re) => r.lines.find((l) => re.test(l));

test('intact: what was pushed matches, and the exit is 0', () => {
  const d = project(bare());
  for (const n of [1, 2, 3]) P.appendRecord(d, rec(n));
  assert.equal(N.pushNotes(d).ok, true);
  const r = V.verify(d, ['--remote']);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.match(lineOf(r, /^remote origin/), /^remote origin: 3 anchors of this log match the local records$/);
});

test('local rewrite: a record rewritten and chained again, with the local anchors rewritten too, passes locally and is caught by the remote', () => {
  const d = project(bare());
  for (const n of [1, 2, 3]) P.appendRecord(d, rec(n));
  N.pushNotes(d);
  // the attacker's rewrite: task 2 says something else, the chain is rebuilt from it, and the local anchors are rewritten to match
  const file = P.projectHome(d).log, lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let prev = null;
  const chain = lines.map((l, i) => { const { hash, ...body } = l; if (i === 1) body.prompt = 'otro pedido'; body.prev = prev; const h = sha(JSON.stringify(body)); prev = h; return { ...body, hash: h }; });
  fs.writeFileSync(file, chain.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const m = P.logId(file), anchors = N.readAnchors(d).filter((a) => a.m === m);
  const head = gitIn(d, 'rev-parse', 'HEAD').stdout.trim();
  const forged = anchors.map(({ commit, ...a }) => JSON.stringify({ ...a, hash: chain[a.n - 1].hash })).join('\n\n');
  gitIn(d, 'notes', `--ref=${N.ANCHOR_REF}`, 'add', '-f', '-F', '-', head); // replaces the note with the forged lines (same input via stdin)
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'notes', `--ref=${N.ANCHOR_REF}`, 'add', '-f', '-F', '-', head], { cwd: d, input: forged, encoding: 'utf8' });
  assert.equal(V.verify(d, []).code, 0, 'the local copy agrees with itself: the rewrite is invisible offline');
  const r = V.verify(d, ['--remote']);
  assert.equal(r.code, 1, r.lines.join('\n'));
  assert.match(lineOf(r, /remote origin/), new RegExp(`✘ remote origin: DIFFERS at ${day} · T2`), 'the first task that differs is named');
});

test('remote rewrite: an anchor changed on the remote no longer matches the local records, and verify names the task', () => {
  const remote = bare(), d = project(remote);
  for (const n of [1, 2, 3]) P.appendRecord(d, rec(n));
  N.pushNotes(d);
  const head = gitIn(d, 'rev-parse', 'HEAD').stdout.trim();
  const note = gitIn(remote, 'notes', `--ref=${N.ANCHOR_REF}`, 'show', head).stdout;
  const edited = note.split('\n').map((l) => { try { const a = JSON.parse(l); return a.n === 2 ? JSON.stringify({ ...a, hash: 'f'.repeat(64) }) : l; } catch { return l; } }).join('\n');
  spawnSync('git', ['notes', `--ref=${N.ANCHOR_REF}`, 'add', '-f', '-F', '-', head], { cwd: remote, input: edited, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const r = V.verify(d, ['--remote']);
  assert.equal(r.code, 1, r.lines.join('\n'));
  assert.match(lineOf(r, /remote origin/), new RegExp(`✘ remote origin: DIFFERS at ${day} · T2`));
});

test('no remote: it is said, as a warning, with --remote and without it; the chain still verifies', () => {
  const d = project();
  P.appendRecord(d, rec(1));
  for (const args of [[], ['--remote']]) {
    const r = V.verify(d, args);
    assert.equal(r.code, 0);
    assert.match(lineOf(r, /remote/), /^⚠ remote: no remote copy of the records/, args.join(' ') || 'plain verify');
  }
});

test('not checked: a remote that cannot be reached is a warning that says so, never silence and never a pass', () => {
  const d = project(path.join(tmp('gone'), 'missing.git'));
  P.appendRecord(d, rec(1));
  const r = V.verify(d, ['--remote']);
  assert.equal(r.code, 0);
  assert.match(lineOf(r, /remote origin/), /^⚠ remote origin: not checked \(could not reach it/);
});

test('nothing pushed yet, and anchors not pushed yet: both are said, neither fails', () => {
  const d = project(bare());
  P.appendRecord(d, rec(1));
  const none = V.verify(d, ['--remote']);
  assert.equal(none.code, 0);
  assert.match(lineOf(none, /remote origin/), /holds no anchors of this log yet/);
  N.pushNotes(d);
  P.appendRecord(d, rec(2));
  const late = V.verify(d, ['--remote']);
  assert.equal(late.code, 0);
  assert.match(lineOf(late, /remote origin/), /^remote origin: 1 anchors of this log match the local records · 1 local anchor not pushed yet/);
});

test('a clone with no local records rebuilds them from the remote, and verify on it passes', () => {
  const remote = bare(), d = project(remote);
  for (const n of [1, 2]) P.appendRecord(d, rec(n));
  gitIn(d, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
  N.pushNotes(d);
  const clone = tmp('clone');
  fs.rmSync(clone, { recursive: true, force: true });
  spawnSync('git', ['clone', '-q', remote, clone], { encoding: 'utf8' });
  assert.equal(N.notesSetup(clone).ok, true);
  const h = P.projectHome(clone);
  assert.equal(fs.existsSync(h.dir), false, 'a clone has no .waymark/');
  assert.equal(P.rebuildFromGit(h), 2, 'its records come back from git');
  const r = V.verify(clone, ['--remote']);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.match(r.lines.join('\n'), /chain: intact/);
});

test('the preference: per project, saved once, read back; "never" wins and the offer stops', () => {
  const file = path.join(home, 'preferences.md');
  fs.rmSync(file, { force: true });
  assert.equal(R.pushPref('waymark'), null);
  R.savePushPref('waymark');
  R.savePushPref('other');
  R.savePushPref('waymark');
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text.match(/Notes push:/g).length, 1, 'one line, a list');
  assert.deepEqual([R.pushPref('waymark'), R.pushPref('other'), R.pushPref('third')], ['yes', 'yes', null]);
  R.savePushPref('third', 'never');
  assert.equal(R.pushPref('third'), 'never');
  fs.writeFileSync(file, '- Notes push: all\n');
  assert.equal(R.pushPref('anything'), 'yes', 'all');
  fs.rmSync(file);
});

test('the push at the close: with the project\'s yes the hook pushes at every close, with a remote only, without prompting; without it nothing leaves', () => {
  const remote = bare(), d = project(remote), slug = P.projectHome(d).slug;
  P.appendRecord(d, rec(1));
  assert.equal(R.autoPushNotes(d, slug).state, 'off', 'no yes, no push');
  assert.equal(gitIn(remote, 'for-each-ref', 'refs/notes').stdout.trim(), '');
  R.savePushPref(slug);
  assert.equal(R.autoPushNotes(d, slug).state, 'pushed');
  assert.match(gitIn(remote, 'for-each-ref', 'refs/notes').stdout, /refs\/notes\/waymark-anchor/);
  assert.equal(R.autoPushNotes(d, slug).state, 'nothing', 'nothing to push twice');
  P.appendRecord(d, rec(2));
  assert.equal(R.autoPushNotes(d, slug).state, 'pushed');
  assert.equal(R.autoPushNotes(project(), slug).state, 'off', 'a project with no remote');
  fs.rmSync(path.join(home, 'preferences.md'), { force: true });
});

test('the stop hook: a closed task\'s notes reach the remote with no manual step once the project said yes', () => {
  const remote = bare(), d = project(remote);
  R.savePushPref(P.projectHome(d).slug);
  const lines = [{ type: 'user', uuid: 'p1', timestamp: '2026-10-17T10:00:00Z', message: { role: 'user', content: 'dime algo' } }, { type: 'assistant', message: { content: [{ type: 'text', text: 'Waymark → L1 · dept-devex · skills: ninguna' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c1', name: 'Read', input: { file_path: '/p/a.txt' } }] } }, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] } }];
  const transcript = path.join(home, 'remote-close.jsonl');
  fs.writeFileSync(transcript, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const id = P.taskIds(d).next;
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'stop-hook.mjs')], { input: JSON.stringify({ transcript_path: transcript, cwd: d, session_id: 's-remote', stop_hook_active: true, last_assistant_message: `## Cierre · ${id}\nResultado: hecho\nEvidencia: inferida de la lectura (check: ver el archivo)\nAprendido: x ← y` }), env: process.env, encoding: 'utf8' });
  assert.match(gitIn(remote, 'for-each-ref', 'refs/notes').stdout, /refs\/notes\/waymark-anchor/, r.stdout + r.stderr);
  assert.equal(V.verify(d, ['--remote']).code, 0);
  fs.rmSync(path.join(home, 'preferences.md'), { force: true });
});

test('check and the notes command: the offer carries the privacy warning and the three answers; --always saves the yes, --never the no', () => {
  const remote = bare(), d = project(remote), slug = P.projectHome(d).slug;
  N.notesSetup(d);
  P.appendRecord(d, rec(1));
  const check = () => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'check'], { cwd: d, encoding: 'utf8', env: process.env }).stdout;
  assert.match(check(), /(?:were never pushed|not pushed) to origin\. They hold the user's requests and Cierres, and a public remote publishes them\. Offer, with the choice window: push once and keep pushing .* notes push --always\), push once \(notes push\), or never for this project \(notes push --never\)/);
  const run = (...a) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'notes', 'push', ...a], { cwd: d, encoding: 'utf8', env: process.env });
  assert.match(run('--always').stdout, /the hook will push .* notes to origin at each close/);
  assert.equal(R.pushPref(slug), 'yes');
  assert.doesNotMatch(check(), /not pushed to origin/, 'once the yes is saved, check does not list them');
  fs.rmSync(path.join(home, 'preferences.md'), { force: true });
  P.appendRecord(d, rec(2));
  run('--never');
  assert.equal(R.pushPref(slug), 'never');
  assert.doesNotMatch(check(), /not pushed to origin/, 'never: not offered again');
  fs.rmSync(path.join(home, 'preferences.md'), { force: true });
});
