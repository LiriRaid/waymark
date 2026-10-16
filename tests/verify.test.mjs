// Waymark 2.0.16 · point 6: `waymark.mjs verify` (chain, install manifest, git signature). Run: node --test tests/*.test.mjs
// Every test uses a temporary WAYMARK_HOME, temporary repos and a throwaway ssh key generated here; nothing touches the
// real ~/.waymark, ~/.ssh or git config.
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'waymark', 'scripts');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'waymark-verify-'));
process.env.WAYMARK_ENGRAM = '';
process.env.WAYMARK_HOME = home;
process.env.WAYMARK_AGENTS_HOME = home;
process.env.WAYMARK_NO_GH = '1';
const temps = [home];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const P = await import(`file://${SCRIPTS}/provenance.mjs`);
const V = await import(`file://${SCRIPTS}/verify.mjs`);
const M = await import(`file://${SCRIPTS}/manifest.mjs`);

const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-verify-${name}-`)); temps.push(d); return d; };
const run = (cwd, cmd, args) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const gitT = (repo, ...a) => run(repo, 'git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
const day = new Date().toLocaleDateString('sv');
const rec = (n) => ({ id: `${day} · T${n}`, agent: 'claude', at: new Date().toISOString(), session: 's1', files: [], commits: [], prompt: `pedido ${n}`, cierre: `## Cierre · ${day} · T${n}\nResultado: hecho\nEvidencia: observada x\nAprendido: y ← z` });
const project = (name) => {
  const d = tmp(name);
  gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(d, '.waymark'), { recursive: true });
  fs.writeFileSync(path.join(d, '.waymark', 'memory.md'), '# P\n\n## Work in progress\n\n## Identity\n- Stack: test\n');
  fs.appendFileSync(path.join(d, '.git', 'info', 'exclude'), '.waymark/\n');
  fs.writeFileSync(path.join(d, 'a.txt'), 'x'); gitT(d, 'add', 'a.txt'); gitT(d, 'commit', '-q', '-m', 'init');
  return d;
};
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('verify chain: intact says so; the exit code is 0', () => {
  const d = project('ok');
  P.appendRecord(d, rec(1)); P.appendRecord(d, rec(2));
  const r = V.verify(d, []);
  assert.equal(r.code, 0);
  assert.match(r.lines[0], /^chain: intact · 2 records/);
});

test('verify chain: an edited line names its task and says it was edited', () => {
  const d = project('edit');
  P.appendRecord(d, rec(1)); P.appendRecord(d, rec(2)); P.appendRecord(d, rec(3));
  const file = P.projectHome(d).log, lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  lines[1] = lines[1].replace('pedido 2', 'pedido cambiado');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  const r = V.verify(d, []);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], new RegExp(`BROKEN at ${day} · T2 · .*edited`));
});

test('verify chain: a deleted line breaks the link of the next one', () => {
  const d = project('del');
  P.appendRecord(d, rec(1)); P.appendRecord(d, rec(2)); P.appendRecord(d, rec(3));
  const file = P.projectHome(d).log, lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(file, [lines[0], lines[2]].join('\n') + '\n');
  const r = V.verify(d, []);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], new RegExp(`BROKEN at ${day} · T3 · .*deleted`));
});

test('verify chain: a log rewritten and chained again is caught by the anchor in git', () => {
  const d = project('rewrite');
  P.appendRecord(d, rec(1)); P.appendRecord(d, rec(2)); P.appendRecord(d, rec(3));
  const file = P.projectHome(d).log;
  const keep = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.id !== `${day} · T2`);
  let prev = null;
  for (const r of keep) { delete r.hash; r.prev = prev; r.hash = sha(JSON.stringify(r)); prev = r.hash; }
  fs.writeFileSync(file, keep.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = V.verify(d, []);
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /BROKEN .*rewritten and chained again/);
});

test('verify <task ID>: a recorded task is confirmed, an unknown one fails', () => {
  const d = project('id');
  P.appendRecord(d, rec(1));
  assert.match(V.verify(d, [`${day} · T1`]).lines.join('\n'), new RegExp(`task ${day} · T1: recorded`));
  const unknown = V.verify(d, [`${day} · T9`]);
  assert.equal(unknown.code, 1);
  assert.match(unknown.lines.join('\n'), /no record in this log/);
});

test('manifest: MANIFEST.json is current (the release checklist runs manifest.mjs --write) and never lists itself', () => {
  const r = M.checkManifest();
  assert.deepEqual([r.changed, r.missing, r.extra], [[], [], []], 'run: node skills/waymark/scripts/manifest.mjs --write');
  assert.ok(!('waymark/MANIFEST.json' in JSON.parse(fs.readFileSync(M.MANIFEST_FILE, 'utf8')).files));
});

test('manifest: a changed, a deleted and an added file are each named; CRLF is not a change', () => {
  const dir = tmp('manifest');
  fs.mkdirSync(path.join(dir, 'waymark'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'waymark', 'a.md'), 'one\ntwo\n');
  fs.writeFileSync(path.join(dir, 'waymark', 'b.md'), 'b');
  fs.writeFileSync(path.join(dir, 'waymark', 'VERSION'), '9.9.9');
  const m = M.buildManifest(dir);
  assert.equal(m.version, '9.9.9');
  fs.writeFileSync(path.join(dir, 'waymark', 'a.md'), 'one\r\ntwo\r\n');
  assert.equal(M.checkManifest(dir, m).ok, true, 'a checkout with CRLF matches');
  fs.writeFileSync(path.join(dir, 'waymark', 'a.md'), 'one\ntampered\n');
  fs.rmSync(path.join(dir, 'waymark', 'b.md'));
  fs.writeFileSync(path.join(dir, 'waymark', 'c.md'), 'new');
  const r = M.checkManifest(dir, m);
  assert.deepEqual([r.ok, r.changed, r.missing, r.extra], [false, ['waymark/a.md'], ['waymark/b.md'], ['waymark/c.md']]);
});

// A throwaway ssh key, a repo with a signed tag, and a skills folder inside it (releaseSignature reads VERSION and ALLOWED_SIGNERS).
const keygen = (name) => {
  const dir = tmp(name), key = path.join(dir, 'k');
  const r = run(dir, 'ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'throwaway', '-f', key]);
  if (r.status !== 0) return null;
  return { key, pub: fs.readFileSync(`${key}.pub`, 'utf8').trim() };
};
const K1 = keygen('key1'), K2 = keygen('key2');
const releaseRepo = (name, { signer = K1, allowed = K1, sign = true } = {}) => {
  const d = tmp(name), skills = path.join(d, 'skills');
  gitT(d, 'init', '-q');
  fs.mkdirSync(path.join(skills, 'waymark'), { recursive: true });
  fs.writeFileSync(path.join(skills, 'waymark', 'VERSION'), '1.2.3\n');
  fs.writeFileSync(path.join(skills, 'waymark', 'ALLOWED_SIGNERS'), allowed ? `maint@example.com ${allowed.pub}\n` : '# none\n');
  fs.writeFileSync(path.join(skills, 'waymark', 'x.md'), 'x');
  fs.writeFileSync(path.join(skills, 'waymark', 'MANIFEST.json'), JSON.stringify(M.buildManifest(skills)));
  const cfg = ['-c', 'gpg.format=ssh', '-c', `user.signingkey=${signer.key}.pub`];
  gitT(d, 'add', '-A');
  gitT(d, ...cfg, 'commit', '-q', ...(sign ? ['-S'] : []), '-m', 'release');
  gitT(d, ...cfg, 'tag', ...(sign ? ['-s'] : ['-a']), '-m', 'v1.2.3', 'v1.2.3');
  return { d, skills };
};
const skip = !K1 || !K2 ? 'ssh-keygen is not available' : false;

test('signature: a tag signed by a key in ALLOWED_SIGNERS is "signed by"', { skip }, () => {
  const { skills } = releaseRepo('signed');
  const s = V.releaseSignature(skills);
  assert.equal(s.state, 'signed');
  assert.equal(s.ref, 'v1.2.3');
  assert.match(V.sayState(s), /^signed by maint@example\.com/);
});

test('signature: a valid signature from a key not in ALLOWED_SIGNERS is untrusted, not signed', { skip }, () => {
  const { skills } = releaseRepo('wrongkey', { signer: K2, allowed: K1 });
  const s = V.releaseSignature(skills);
  assert.equal(s.state, 'untrusted');
  assert.equal(V.sayState(s), 'signed, key not in ALLOWED_SIGNERS');
});

test('signature: an unsigned tag is "unsigned"', { skip }, () => {
  const { skills } = releaseRepo('unsigned', { sign: false });
  assert.equal(V.releaseSignature(skills).state, 'unsigned');
});

test('signature: a folder that is no git clone has nothing to verify', () => {
  assert.equal(V.releaseSignature(tmp('noclone')), null);
});

test('signature: each commit of a record is read as signed, untrusted or unsigned', { skip }, () => {
  const signed = releaseRepo('csigned'), plain = releaseRepo('cplain', { sign: false });
  const head = (d) => gitT(d, 'rev-parse', 'HEAD').stdout.trim();
  assert.deepEqual(V.commitSignatures(plain.d, [head(plain.d)]), { [head(plain.d).slice(0, 12)]: 'unsigned' });
  const allowed = path.join(signed.skills, 'waymark', 'ALLOWED_SIGNERS');
  assert.equal(V.signatureState(signed.d, head(signed.d), { allowed }).state, 'signed');
});

test('verify --require-signature: an unsigned install fails it, without the flag only warns, a signed one passes', { skip }, () => {
  // each case checks its own temporary install, so the result does not depend on whether this repository's tag is signed
  const unsigned = releaseRepo('rq-unsigned', { sign: false }), signed = releaseRepo('rq-signed');
  const hard = V.verify(project('sighard'), ['--require-signature'], { skillsDir: unsigned.skills });
  assert.equal(hard.code, 1, 'required means exit 1');
  const warn = V.verify(project('sigwarn'), ['--install'], { skillsDir: unsigned.skills });
  assert.equal(warn.code, 0, 'an unsigned release is a warning when the flag is not given');
  assert.match(warn.lines.join('\n'), /install: \d+ files match the manifest[\s\S]*warning: not signed/);
  const ok = V.verify(project('sigok'), ['--install', '--require-signature'], { skillsDir: signed.skills });
  assert.equal(ok.code, 0);
  assert.match(ok.lines.join('\n'), /signature \(v1\.2\.3\): signed by maint@example\.com/);
});

const A = await import(`file://${SCRIPTS}/attest.mjs`);
test('attest: a task becomes an in-toto statement with its commit, decision, gates and chain hash; verify --attestation accepts it', () => {
  const d = project('attest');
  const head = gitT(d, 'rev-parse', 'HEAD').stdout.trim();
  P.appendRecord(d, { ...rec(1), commits: [head], level: 2, decisions: [{ question: '¿Cómo?', chosen: 'A (Recomendado)', discarded: ['B'], position: 'before' }], observed: { gate: { cmd: 'node --test', ok: true }, review: true, build: { none: 'x' }, secrets: [], evidence: { unbacked: [] } }, commands: ['node --test'] });
  const s = A.attest(d, `${day} · T1`);
  assert.equal(s._type, A.STATEMENT);
  assert.equal(s.predicateType, A.PREDICATE);
  assert.deepEqual(s.subject.map((x) => x.digest.gitCommit), [head]);
  assert.deepEqual(s.predicate.decisions.map((x) => [x.chosen, x.discarded, x.position]), [['A (Recomendado)', ['B'], 'before']]);
  assert.equal(s.predicate.evidence.stated, 'observada x');
  assert.equal(s.predicate.gates.gate.cmd, 'node --test');
  assert.equal(s.predicate.chain.hash, P.readRecords(P.projectHome(d).log).pop().hash);
  assert.ok(s.predicate.chain.anchor, 'the anchor of that line');
  const file = path.join(tmp('att-file'), 'a.json');
  fs.writeFileSync(file, JSON.stringify(s));
  const ok = V.verify(d, ['--attestation', file]);
  assert.equal(ok.code, 0);
  assert.match(ok.lines.join('\n'), /attestation: valid[\s\S]*record · .* holds the same hash/);
});

test('attest: an edited predicate, a task this log does not hold and an unknown ID are each refused', () => {
  const d = project('attest2');
  P.appendRecord(d, rec(1));
  const s = A.attest(d, `${day} · T1`);
  const dir = tmp('att-files');
  const edited = JSON.parse(JSON.stringify(s)); edited.predicate.request = 'otro pedido';
  fs.writeFileSync(path.join(dir, 'edited.json'), JSON.stringify(edited));
  const r1 = V.verify(d, ['--attestation', path.join(dir, 'edited.json')]);
  assert.equal(r1.code, 1);
  assert.match(r1.lines.join('\n'), /✘ predicate digest/);
  const other = project('attest3');
  fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify(s));
  const r2 = V.verify(other, ['--attestation', path.join(dir, 'ok.json')]);
  assert.equal(r2.code, 1);
  assert.match(r2.lines.join('\n'), /✘ record · no such task in this log/);
  assert.match(A.attest(d, `${day} · T9`).error, /no record for/);
  assert.equal(A.checkAttestation(d, path.join(dir, 'missing.json')).ok, false);
});

test('pinned inputs: the department, procedures, routine, profiles read and the manifest are pinned by the manifest\'s own hashes', () => {
  const root = tmp('pin');
  const reads = [path.join(M.SKILLS, 'waymark', 'stacks', 'angular.md'), path.join(M.SKILLS, 'waymark', 'architectures', 'hexagonal.md'), 'src/a.ts'];
  const p = P.pinnedRules({ dept: 'dept-qa', root, reads });
  const files = JSON.parse(fs.readFileSync(M.MANIFEST_FILE, 'utf8')).files;
  assert.equal(p.routine, files['waymark/routine.json']);
  assert.equal(p.department.sha, files['dept-qa/SKILL.md']);
  assert.equal(p.procedures.sha, files['dept-qa/procedures.md']);
  assert.deepEqual(p.profiles.map((x) => [x.kind, x.name, x.sha]), [['stack', 'angular', files['waymark/stacks/angular.md']], ['architecture', 'hexagonal', files['waymark/architectures/hexagonal.md']]]);
  assert.equal(p.risk, undefined, 'no project override, nothing pinned');
  fs.mkdirSync(path.join(root, '.waymark'));
  fs.writeFileSync(path.join(root, '.waymark', 'risk.json'), '{"review":{"maxLines":50}}');
  assert.equal(typeof P.pinnedRules({ dept: 'dept-qa', root }).risk, 'string', 'a project override is pinned');
  assert.equal(P.pinnedRules({ dept: '../etc', root }).department, undefined, 'a department name is never a path');
});

test('verify <task ID>: the pinned rules are compared with the release manifest; a task without them says so', () => {
  const d = project('pinned');
  P.appendRecord(d, { ...rec(1), pinned: P.pinnedRules({ dept: 'dept-qa', root: d, reads: [] }) });
  P.appendRecord(d, rec(2));
  const ok = V.verify(d, [`${day} · T1`]).lines.join('\n');
  assert.match(ok, /rules: 3 pinned · 3 match this release's manifest/);
  const old = V.verify(d, [`${day} · T2`]).lines.join('\n');
  assert.match(old, /rules: not pinned in this record/);
  const r = V.pinnedReport({ pinned: { routine: 'f'.repeat(64) } });
  assert.deepEqual([r.pinned, r.match, r.differ], [1, 0, ['waymark/routine.json']]);
});
