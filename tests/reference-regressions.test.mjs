// Waymark 2.0.18 · point 11: what the reference bench found on real repositories, each as a fixture and a regression case (docs/adr/0039).
// The fixtures are minimal trees of what failed (tests/reference/fixtures/): no file names the repository they came from.
// Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(ROOT, 'tests', 'reference', 'fixtures');
const SKILLS = path.join(ROOT, 'skills');
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-rr-${name}-`)); temps.push(d); return d; };
const B = await import(`file://${ROOT}/bench/reference.mjs`);
const R = await import(`file://${SKILLS}/waymark/scripts/runs.mjs`);
const S = await import(`file://${SKILLS}/waymark/scripts/stack.mjs`);
const N = await import(`file://${SKILLS}/waymark/scripts/stack-new.mjs`);
const home = tmp('home');
const kind = (c) => { const k = R.shellRuns(c)[0] || {}; return k.test ? 'test' : k.build ? 'build' : k.gate ? 'gate' : null; };
const tree = (files) => { const d = tmp('tree'); for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); } return d; };

test('bench finding: a build tool run with a flag first (mvn -q test) is the test it runs, not nothing', async () => {
  // a Maven project: the profile's own commands were taken for no gate, no test and no build
  const m = await B.measureRepo(path.join(FX, 'maven-project'), { home });
  assert.deepEqual([m.stack, m.profile.slug, m.ecosystems], ['java (maven)', 'java', ['java']]);
  assert.deepEqual([m.gates.test.command, m.gates.test.as, m.gates.build.command, m.gates.build.as], ['mvn -q test', 'test', 'mvn -q -DskipTests package', 'build']);
  assert.deepEqual(B.failuresOf(m), []);
  for (const [c, k] of [['mvn -q test', 'test'], ['mvn -q -DskipTests package', 'build'], ['./mvnw -B -ntp verify', 'build'], ['./gradlew check -x test', 'gate'], ['cargo +nightly test', 'test'], ['cargo +stable clippy -- -D warnings', 'gate'],
    ['dotnet --nologo build', 'build'], ['dotnet --nologo test', 'test'], ['make -j8 test', 'test'], ['make -C build test', 'test'], ['make -j4', 'build'], ['terraform -chdir=infra validate', 'gate']]) assert.equal(kind(c), k, c);
  // what the verb is not: a flag's value, a package, a message
  assert.equal(kind('mvn -q dependency:tree'), null);
  assert.equal(kind('git commit -m "mvn -q test"'), null, 'a word in a message is no run');
});

test('bench finding: Dart and Flutter, Elixir, Swift, .NET format and gofmt are gates, tests and builds to the hooks', () => {
  for (const [c, k] of [['flutter analyze', 'gate'], ['dart analyze', 'gate'], ['flutter test', 'test'], ['dart test', 'test'], ['flutter build apk', 'build'], ['mix test', 'test'], ['mix compile --warnings-as-errors', 'gate'],
    ['mix format --check-formatted', 'gate'], ['swift build', 'build'], ['swift test', 'test'], ['dotnet format --verify-no-changes', 'gate'], ['gofmt -l .', 'gate']]) assert.equal(kind(c), k, c);
  assert.equal(kind('dotnet format'), null, 'plain format rewrites files: no gate');
  assert.equal(kind('mix format'), null);
  assert.equal(kind('flutter pub get'), null);
  assert.equal(kind('dart pub get'), null);
});

test('bench finding: an ecosystem with no profile is told apart, and a profile drafted for it applies where it is put', async () => {
  const dart = path.join(FX, 'dart-flutter');
  const m = await B.measureRepo(dart, { home });
  assert.deepEqual([m.stack, m.profile.slug], ['dart (pub)', 'generic'], 'the card names the stack now; no profile of its own');
  assert.deepEqual(B.failuresOf(m).map((f) => f.kind), ['no-profile'], 'and nothing else fails there');
  assert.deepEqual([m.gates.typecheck.as, m.gates.test.as], ['gate', 'test']);
  // the draft, put in the stacks folder of a copy of the skills, is the profile of that ecosystem
  const copy = tmp('skills');
  fs.cpSync(SKILLS, copy, { recursive: true });
  fs.writeFileSync(path.join(copy, 'waymark', 'stacks', 'dart.md'), N.draftProfile(dart).text);
  const M = await import(`file://${copy}/waymark/scripts/stack.mjs?${Date.now()}`);
  assert.deepEqual(M.profileOf(dart), { slug: 'dart', exists: true });
  assert.deepEqual(B.failuresOf({ ...m, profile: M.profileOf(dart) }), []);
  assert.deepEqual(S.profileOf(dart), { slug: 'generic', exists: true }, 'this install has no dart profile of its own');
});

test('bench finding: the stack module names the ecosystems read from a build file, and their profile still applies', () => {
  const label = (files) => S.stackOf(tree(files))?.other ?? null;
  assert.equal(label({ 'pom.xml': '<project/>' }), 'java (maven)');
  assert.equal(label({ 'build.gradle.kts': '' }), 'java (gradle)');
  assert.equal(label({ 'App.csproj': '<Project/>' }), '.net (dotnet)');
  assert.equal(label({ 'pubspec.yaml': 'name: x\n' }), 'dart (pub)');
  assert.equal(label({ 'mix.exs': '' }), 'elixir (mix)');
  assert.equal(label({ 'Package.swift': '' }), 'swift (swiftpm)');
  assert.equal(label({ 'settings.gradle.kts': '', 'app/src/main/AndroidManifest.xml': '<manifest/>' }), 'android (gradle)');
  assert.equal(S.profileOf(tree({ 'pom.xml': '<project/>' })).slug, 'java');
  assert.equal(S.profileOf(tree({ 'App.csproj': '<Project/>' })).slug, 'dotnet');
  assert.equal(S.profileOf(tree({ 'settings.gradle.kts': '', 'app/src/main/AndroidManifest.xml': '<manifest/>' })).slug, 'android');
  assert.equal(S.stackLine(tree({ 'pom.xml': '<project/>' })), 'java (maven)', 'one short line in the card');
});

test('bench finding: a clone that works where a path is long (a repository with a long file name failed to check out on Windows)', () => {
  const a = B.cloneArgs('https://example.invalid/r.git', '/tmp/r');
  assert.deepEqual(a.slice(0, 2), ['-c', 'core.longpaths=true']);
  assert.ok(a.includes('--depth') && a.includes('1') && a.includes('--no-tags'), 'shallow: read-only and small');
  assert.equal(a.at(-2), 'https://example.invalid/r.git');
  assert.equal(a.at(-1), '/tmp/r');
});
