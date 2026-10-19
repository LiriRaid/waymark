// Waymark 2.0.18 · point 6: the anchor signed at the close, `attest` signed, a key lifecycle (docs/adr/0034).
// Run: node --test tests/*.test.mjs. Every key here is a throwaway generated in a temp folder; nothing touches ~/.ssh or git config.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-sign-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
delete process.env.WAYMARK_SIGNING_KEY;
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const V = await import(`file://${SCRIPTS}/verify.mjs`);
const S = await import(`file://${SCRIPTS}/sign.mjs`);
const A = await import(`file://${SCRIPTS}/attest.mjs`);

const day = new Date().toLocaleDateString('sv');
const keys = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-keys-'));
temps.push(keys);
const makeKey = (name, pass = '') => { const f = path.join(keys, name); spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', pass, '-C', name, '-f', f]); return f; };
const pub = (f) => fs.readFileSync(`${f}.pub`, 'utf8').trim().split(' ').slice(0, 2).join(' ');
const mine = makeKey('me'), other = makeKey('other'), locked = makeKey('locked', 'secret'), revoked = makeKey('revoked');
const allow = (lines) => fs.writeFileSync(path.join(home, 'ALLOWED_SIGNERS'), lines.join('\n') + '\n');
const revoke = (files) => fs.writeFileSync(path.join(home, 'REVOKED_SIGNERS'), files.map((f) => pub(f)).join('\n') + '\n');
const reset = () => { for (const f of ['ALLOWED_SIGNERS', 'REVOKED_SIGNERS']) fs.rmSync(path.join(home, f), { force: true }); };

const rec = (n) => ({ id: `${day} · T${n}`, agent: 'claude', at: new Date().toISOString(), session: 's1', files: [], commits: [], prompt: `pedido ${n}`, cierre: `## Cierre · ${day} · T${n}\nResultado: hecho\nEvidencia: observada x\nAprendido: y ← z` });
function project() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-sign-proj-'));
  temps.push(d);
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: d, encoding: 'utf8' });
  git('init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'x'); git('add', 'a.txt'); git('commit', '-q', '-m', 'init');
  return d;
}
const anchorsLine = (d) => V.verify(d, []).lines.find((l) => l.startsWith('anchors:'));

test('signed: with a key the hook signs each task\'s anchor at the close; verify says by whom, and the exit is 0', () => {
  reset(); allow([`me@test ${pub(mine)}`]);
  process.env.WAYMARK_SIGNING_KEY = mine;
  const d = project();
  P.appendRecord(d, rec(1)); P.appendRecord(d, rec(2));
  const r = V.verify(d, ['--require-signed']);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.match(anchorsLine(d), /^anchors: 2 signed by me@test/);
  const rows = S.anchorStates(d, P.logId(P.logFile(d)));
  assert.deepEqual(rows.map((x) => [x.n, x.state, x.by]), [[1, 'signed', 'me@test'], [2, 'signed', 'me@test']]);
  assert.equal(P.anchorsFor(d).length, 2, 'the signature lines are not anchors: the chain reads the same anchors as before');
});

test('no key: nothing is signed and nothing is written; verify says so as a warning and the chain still verifies', () => {
  reset(); allow([`me@test ${pub(mine)}`]);
  process.env.WAYMARK_SIGNING_KEY = '';
  const d = project();
  P.appendRecord(d, rec(1));
  assert.equal(V.verify(d, []).code, 0);
  assert.match(anchorsLine(d), /^anchors: 1 unsigned \(no signing key/);
  assert.equal(S.anchorStates(d, P.logId(P.logFile(d)))[0].state, 'unsigned');
  assert.equal(V.verify(d, ['--require-signed']).code, 0, 'history from before signing began is not a gap');
});

test('tampered: an anchor edited after it was signed fails its signature, and verify names the task', () => {
  reset(); allow([`me@test ${pub(mine)}`]);
  process.env.WAYMARK_SIGNING_KEY = mine;
  const d = project();
  P.appendRecord(d, rec(1)); P.appendRecord(d, rec(2));
  // rewrite the anchor note of the first task: same log, another count
  const a = P.anchorsFor(d)[0];
  const note = spawnSync('git', ['notes', '--ref=refs/notes/waymark-anchor', 'show', a.commit], { cwd: d, encoding: 'utf8' }).stdout;
  const edited = note.split('\n').map((l) => { try { const o = JSON.parse(l); return o.kind !== 'sig' && o.n === 1 ? JSON.stringify({ ...o, at: o.at + 1 }) : l; } catch { return l; } }).join('\n');
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'notes', '--ref=refs/notes/waymark-anchor', 'add', '-f', '-F', '-', a.commit], { cwd: d, input: edited, encoding: 'utf8' });
  const r = V.verify(d, []);
  assert.equal(r.code, 1);
  assert.match(r.lines.join('\n'), /✘ .*T1: BAD signature|unsigned/, 'the edited anchor no longer matches its signature');
});

test('unknown key: a valid signature by a key nobody trusts is not trusted, and --require-signed fails on it', () => {
  reset(); allow([`me@test ${pub(mine)}`]);
  process.env.WAYMARK_SIGNING_KEY = other;
  const d = project();
  P.appendRecord(d, rec(1));
  assert.match(anchorsLine(d), /signed, key not trusted/);
  assert.equal(V.verify(d, []).code, 0, 'a warning');
  assert.equal(V.verify(d, ['--require-signed']).code, 1);
});

test('revoked: a key in REVOKED_SIGNERS is reported as revoked, however valid its signature', () => {
  reset(); allow([`me@test ${pub(revoked)}`, `me@test ${pub(mine)}`]);
  process.env.WAYMARK_SIGNING_KEY = revoked;
  const d = project();
  P.appendRecord(d, rec(1));
  assert.match(anchorsLine(d), /^anchors: 1 signed by me@test/, 'before the revocation it is trusted');
  revoke([revoked]);
  assert.match(anchorsLine(d), /signed, key revoked/);
  assert.equal(V.verify(d, ['--require-signed']).code, 1);
});

test('validity: a key is valid between its valid-after and valid-before, as of the time it signed; another of the user\'s keys can be added', () => {
  reset();
  process.env.WAYMARK_SIGNING_KEY = mine;
  const d = project();
  P.appendRecord(d, rec(1));
  const year = new Date().getUTCFullYear();
  allow([`old@test valid-after="${year - 2}0101",valid-before="${year - 1}0101" ${pub(mine)}`]);
  assert.match(anchorsLine(d), /signed outside its validity/);
  allow([`old@test valid-after="${year - 2}0101",valid-before="${year - 1}0101" ${pub(mine)}`, `new@test valid-after="${year - 1}0101" ${pub(mine)}`]);
  assert.match(anchorsLine(d), /signed by new@test/, 'two keys of the user, each with its period');
});

test('locked: a key with a passphrase is recorded as locked, never asked; sign --pending then signs those and says they came later', () => {
  reset(); allow([`me@test ${pub(mine)}`, `lock@test ${pub(locked)}`]);
  process.env.WAYMARK_SIGNING_KEY = locked;
  const d = project();
  const t0 = Date.now();
  P.appendRecord(d, rec(1));
  assert.ok(Date.now() - t0 < 8000, 'the hook did not wait for a passphrase');
  assert.match(anchorsLine(d), /^anchors: 1 unsigned \(key locked\)|no signing key|unsigned/);
  const m = P.logId(P.logFile(d));
  assert.equal(S.anchorStates(d, m)[0].state, 'locked');
  // the user, at their terminal with the key unlocked (here: another key of theirs that needs no passphrase)
  const r = S.signPending(d, m, { keyFile: mine, interactive: false });
  assert.deepEqual([r.todo, r.signed], [1, 1]);
  const row = S.anchorStates(d, m)[0];
  assert.deepEqual([row.state, row.by, row.late], ['signed', 'me@test', true]);
  assert.match(S.say(row), /signed by me@test \(signed later\)/);
  assert.equal(S.signPending(d, m, { keyFile: mine, interactive: false }).todo, 0, 'nothing pending any more');
});

test('signingKey: the variable, then the Signing key line of the preferences, then git; none is none', () => {
  assert.equal(S.signingKey(process.cwd(), { WAYMARK_SIGNING_KEY: '/k/a' }), '/k/a');
  assert.equal(S.signingKey(process.cwd(), { WAYMARK_SIGNING_KEY: '' }), null, 'set and empty: signing off');
  fs.writeFileSync(path.join(home, 'preferences.md'), '## Learned preferences\n- Signing key: ~/keys/mine.pub\n');
  assert.equal(S.signingKey(process.cwd(), {}), '~/keys/mine.pub');
  fs.rmSync(path.join(home, 'preferences.md'));
});

test('attestation: attest --out writes a .sig next to the statement; verify --attestation says by whom, and an edited statement is a bad signature', () => {
  reset(); allow([`me@test ${pub(mine)}`]);
  process.env.WAYMARK_SIGNING_KEY = mine;
  const d = project();
  P.appendRecord(d, rec(1));
  const out = path.join(d, 'att.json');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'attest', `${day} · T1`, '--out', out], { cwd: d, encoding: 'utf8', env: process.env });
  assert.match(r.stdout, /signed \(.*att\.json\.sig\)/, r.stdout + r.stderr);
  const ok = V.verify(d, ['--attestation', out, '--require-signed']);
  assert.equal(ok.code, 0, ok.lines.join('\n'));
  assert.match(ok.lines.join('\n'), /✔ signature · signed by me@test/);
  fs.writeFileSync(out, fs.readFileSync(out, 'utf8').replace('pedido 1', 'pedido cambiado'));
  const bad = V.verify(d, ['--attestation', out]);
  assert.equal(bad.code, 1);
  assert.match(bad.lines.join('\n'), /✘ signature · BAD signature/);
  process.env.WAYMARK_SIGNING_KEY = '';
  const none = spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'attest', `${day} · T1`, '--out', path.join(d, 'att2.json')], { cwd: d, encoding: 'utf8', env: process.env });
  assert.match(none.stdout, /not signed: no signing key/);
  assert.match(V.verify(d, ['--attestation', path.join(d, 'att2.json')]).lines.join('\n'), /⚠ signature · unsigned/);
});

test('the sign command: says whether the key would sign without asking', () => {
  const run = (key) => spawnSync(process.execPath, [path.join(SCRIPTS, 'waymark.mjs'), 'sign'], { encoding: 'utf8', env: { ...process.env, WAYMARK_SIGNING_KEY: key } }).stdout;
  assert.match(run(''), /no signing key/);
  assert.match(run(mine), /ready: .* signs without asking/);
  assert.match(run(locked), /the key is locked/);
  assert.match(run(path.join(keys, 'missing')), /cannot sign \(no key at/);
});
