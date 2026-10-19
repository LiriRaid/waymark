// Waymark 2.0.18 · point 8: inputs and dependencies pinned (docs/adr/0036).
// The engram release the learned layer was tested with, skills.lock for the vendored third-party skills, and Waymark's own scripts with no dependencies.
// Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'skills', 'waymark', 'scripts');
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-pin-${name}-`)); temps.push(d); return d; };
const E = await import(`file://${SCRIPTS}/engram.mjs`);
const M = await import(`file://${SCRIPTS}/manifest.mjs`);
const V = await import(`file://${SCRIPTS}/verify.mjs`);

const PIN = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'waymark', 'engram.pin.json'), 'utf8'));
const hex = /^[0-9a-f]{64}$/;

// ---- engram ----

test('engram pin: the version and, for each OS and architecture, the sha256 of the release archive and of the binary inside it', () => {
  assert.equal(PIN.schema, 'waymark.engram-pin/v1');
  assert.match(PIN.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(PIN.platforms).sort(), ['darwin_amd64', 'darwin_arm64', 'linux_amd64', 'linux_arm64', 'windows_amd64', 'windows_arm64']);
  for (const [platform, e] of Object.entries(PIN.platforms)) {
    assert.equal(e.archive.startsWith(`engram_${PIN.version}_${platform}.`), true, `${platform}: the archive is of the pinned version and platform`);
    assert.match(e.archiveSha256, hex, `${platform}: archive sha256`);
    assert.match(e.binarySha256, hex, `${platform}: binary sha256`);
    assert.equal(e.binary, platform.startsWith('windows') ? 'engram.exe' : 'engram');
  }
});

test('engram pin: the platform key is named as the release names its archives', () => {
  assert.equal(E.platformKey('win32', 'x64'), 'windows_amd64');
  assert.equal(E.platformKey('darwin', 'arm64'), 'darwin_arm64');
  assert.equal(E.platformKey('linux', 'x64'), 'linux_amd64');
  assert.equal(E.platformKey('linux', 'arm64'), 'linux_arm64');
  assert.ok(PIN.platforms[E.platformKey()] || !['win32', 'darwin', 'linux'].includes(process.platform), "this machine's platform has an entry");
});

test('engram pin: the binary is judged against the pin, one state for each way it can differ', () => {
  const dir = tmp('bin'), file = path.join(dir, 'engram'), bytes = Buffer.from('not really engram');
  fs.writeFileSync(file, bytes);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const pin = { version: '9.9.9', platforms: { here: { archive: 'a', archiveSha256: 'b', binary: 'engram', binarySha256: sha256 } } };
  assert.equal(E.judgeEngram({ version: '9.9.9', file }, pin, 'here').state, 'ok');
  assert.equal(E.judgeEngram({ version: '9.9.9', file }, { ...pin, platforms: { here: { ...pin.platforms.here, binarySha256: '0'.repeat(64) } } }, 'here').state, 'binary', 'the version matches, the bytes do not');
  assert.equal(E.judgeEngram({ version: '9.9.8', file }, pin, 'here').state, 'version');
  assert.equal(E.judgeEngram({ version: '9.9.9', file: null }, pin, 'here').state, 'unchecked', 'no file to hash');
  assert.equal(E.judgeEngram({ version: '9.9.9', file }, pin, 'elsewhere').state, 'platform');
  assert.equal(E.judgeEngram({ version: '9.9.9', file }, null, 'here').state, 'unpinned');
});

test('engram pin: a stand-in script and a missing engram are told apart, and the record keeps only the version', () => {
  const dir = tmp('standin'), bin = path.join(dir, 'engram.mjs');
  fs.writeFileSync(bin, "console.log('engram 3.1.0');\n");
  const before = process.env.WAYMARK_ENGRAM;
  try {
    process.env.WAYMARK_ENGRAM = bin;
    assert.equal(E.engramVersion(), '3.1.0');
    assert.deepEqual(E.engramInput({ version: '3.1.0' }), { version: '3.1.0', pinned: true });
    assert.deepEqual(E.engramInput({ version: '3.2.0' }), { version: '3.1.0', pinned: false });
    assert.deepEqual(E.engramInput(null), { version: '3.1.0', pinned: null }, 'no pin file: nothing to compare');
    assert.equal(E.engramStatus({ version: '3.1.0', platforms: PIN.platforms }).state, 'unchecked', 'a stand-in has no binary to hash');
    process.env.WAYMARK_ENGRAM = '';
    assert.deepEqual(E.engramStatus(), { state: 'missing', platform: E.platformKey() });
    assert.equal(E.engramInput(), null, 'a record without engram keeps its old shape');
  } finally {
    if (before === undefined) delete process.env.WAYMARK_ENGRAM; else process.env.WAYMARK_ENGRAM = before;
  }
});

// ---- skills.lock ----

// A copy of the install in a temp folder with one vendored third-party skill beside it: <dir>/waymark and <dir>/third.
function install(files = { 'SKILL.md': '---\nname: third\ndescription: a third-party skill\n---\n\nbody\n' }) {
  const dir = tmp('install');
  fs.cpSync(path.join(ROOT, 'skills', 'waymark'), path.join(dir, 'waymark'), { recursive: true });
  fs.rmSync(path.join(dir, 'waymark', 'skills.lock'), { force: true });
  for (const [f, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, 'third', f)), { recursive: true }); fs.writeFileSync(path.join(dir, 'third', f), text); }
  return dir;
}
const entry = { source: 'someone/skills', ref: 'v1.2.0', upstreamHash: 'abc123', vendoredAt: '2026-10-17', license: 'MIT' };

test('skills.lock: the release carries one, and it is valid (today it vendors no third-party skill)', () => {
  const r = M.checkSkillsLock();
  assert.equal(r.present, true);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

test('skills.lock: a vendored skill is pinned with its source, ref and the sha256 of its folder, and a change is named', () => {
  const dir = install({ 'SKILL.md': '---\nname: third\ndescription: x\n---\n\nbody\n', 'references/a.md': 'a\n' });
  assert.equal(M.checkSkillsLock(dir).present, false, 'no lock yet');
  const pin = M.lockSkill('third', entry, dir);
  assert.match(pin.sha256, hex);
  assert.deepEqual({ ...pin, sha256: undefined }, { ...entry, sha256: undefined });
  assert.deepEqual(M.checkSkillsLock(dir), { ok: true, present: true, checked: 1, changed: [], missing: [], unpinned: [], problems: [] });
  fs.appendFileSync(path.join(dir, 'third', 'references', 'a.md'), 'edited\n');
  assert.deepEqual(M.checkSkillsLock(dir).changed, ['third'], 'an edited file moves the folder hash');
  fs.writeFileSync(path.join(dir, 'third', 'references', 'a.md'), 'a\n');
  assert.equal(M.checkSkillsLock(dir).ok, true);
  fs.writeFileSync(path.join(dir, 'third', 'references', 'b.md'), 'new\n');
  assert.deepEqual(M.checkSkillsLock(dir).changed, ['third'], 'an added file does too');
  fs.rmSync(path.join(dir, 'third'), { recursive: true });
  assert.deepEqual(M.checkSkillsLock(dir).missing, ['third'], 'a pinned skill that is gone');
});

test('skills.lock: what the learning step writes does not count, and a CRLF checkout matches', () => {
  const head = '---\nname: third\ndescription: x\n---\n\nbody\n\n## Learned notes\n\n';
  const dir = install({ 'SKILL.md': `${head}_none yet_\n` });
  M.lockSkill('third', entry, dir);
  fs.writeFileSync(path.join(dir, 'third', 'SKILL.md'), `${head}- [2026-10-17] a lesson\n`);
  assert.equal(M.checkSkillsLock(dir).ok, true, 'the body of the Learned notes section grows with use');
  fs.writeFileSync(path.join(dir, 'third', 'SKILL.md'), `${head}_none yet_\n`.replace(/\n/g, '\r\n'));
  assert.equal(M.checkSkillsLock(dir).ok, true);
});

test('skills.lock: a pin with no ref and no upstream hash is a warning, a pin with no source is a problem', () => {
  const dir = install();
  M.lockSkill('third', { source: 'someone/skills' }, dir);
  const r = M.checkSkillsLock(dir);
  assert.deepEqual(r.unpinned, ['third']);
  assert.equal(r.ok, true, 'a warning, not a failure');
  M.lockSkill('third', { ref: 'v1' }, dir);
  assert.match(M.checkSkillsLock(dir).problems[0], /third: no source/);
});

test('skills.lock: verify --install fails on a skill that moved since it was pinned and says which', () => {
  const dir = install();
  M.lockSkill('third', entry, dir);
  fs.writeFileSync(path.join(dir, 'waymark', 'MANIFEST.json'), JSON.stringify(M.buildManifest(dir)));
  const cwd = tmp('cwd');
  let r = V.verify(cwd, ['--install'], { skillsDir: dir });
  assert.match(r.lines.join('\n'), /skills\.lock: 1 vendored skill matches the pins/);
  fs.appendFileSync(path.join(dir, 'third', 'SKILL.md'), 'tampered\n');
  fs.writeFileSync(path.join(dir, 'waymark', 'MANIFEST.json'), JSON.stringify(M.buildManifest(dir))); // the manifest alone would now agree: the lock is what remembers
  r = V.verify(cwd, ['--install'], { skillsDir: dir });
  assert.match(r.lines.join('\n'), /skills\.lock: DIFFERS · third changed since it was pinned/);
  assert.equal(r.code, 1);
});

test('skills.lock: sync --vendor pins the skill it vendors, with the ref it was given', () => {
  const dir = install(), home = tmp('home');
  const env = { ...process.env, HOME: home, USERPROFILE: home, WAYMARK_HOME: path.join(home, '.waymark'), WAYMARK_AGENTS_HOME: home };
  const r = spawnSync(process.execPath, [path.join(dir, 'waymark', 'scripts', 'sync.mjs'), '--vendor', 'third', '--ref', 'v1.2.0', '--quiet'], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'waymark', 'skills.lock'), 'utf8'));
  assert.equal(lock.skills.third.ref, 'v1.2.0');
  assert.match(lock.skills.third.sha256, hex);
  assert.equal(M.checkSkillsLock(dir).ok, true, 'the lock was written after the precondition and the NOTICE, so it matches the folder as vendored');
});

// ---- no dependencies ----

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

test("no dependencies: Waymark's own scripts import only Node built-ins and their own files, and no package.json exists", () => {
  const builtin = new Set(builtinModules);
  assert.equal(fs.existsSync(path.join(ROOT, 'package.json')), false, 'no package.json at the root');
  const files = walk(SCRIPTS).filter((f) => /\.(mjs|js|cjs)$/.test(f));
  assert.ok(files.length > 20, 'the scripts were found');
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const specs = [...text.matchAll(/^\s*(?:import|export)\b[^\n;]*?\bfrom\s+['"]([^'"]+)['"]/gm), ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm), ...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g), ...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const s of specs) {
      const ok = s.startsWith('node:') ? builtin.has(s.slice(5)) : builtin.has(s) || (/^\.{1,2}\//.test(s) && fs.existsSync(path.resolve(path.dirname(f), s)));
      if (!ok) bad.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}: ${s}`);
    }
  }
  assert.deepEqual(bad, [], 'an import of a package, or of a file that does not exist');
  assert.equal(walk(path.join(ROOT, 'skills')).some((f) => ['package.json', 'package-lock.json'].includes(path.basename(f))), false, 'no manifest of dependencies under skills/');
});
