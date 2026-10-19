// Waymark 2.0.16 · point 13: validation outside the author's projects. The manifest of the external corpus, the gaps its first
// measurement found (kept as regression cases), and a measurement of committed fixtures (no clone, no network). Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.join(HERE, '..', 'skills', 'waymark', 'scripts');
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'external', 'corpus.json'), 'utf8'));
const S = await import(`file://${SCRIPTS}/stack.mjs`);
const R = await import(`file://${SCRIPTS}/runs.mjs`);
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const dir = (files) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-ext-'));
  temps.push(d);
  for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); }
  return d;
};

test('external corpus: every repository is pinned to a commit and says what a correct Waymark reports', () => {
  assert.equal(manifest.schema, 'waymark.external-corpus/v2');
  assert.equal(manifest.repos.length, 8);
  for (const r of manifest.repos) if (r.sample) assert.ok(r.task?.prompt && r.task.file, `${r.id}: the real task`);
  for (const r of manifest.repos) {
    assert.match(r.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/, r.id);
    assert.match(r.commit, /^[0-9a-f]{40}$/, r.id);
    assert.ok(r.field && r.language && 'stack' in r.expect && r.expect.profile, r.id);
  }
  assert.equal(new Set(manifest.repos.map((r) => r.language)).size, manifest.repos.length, 'eight different ecosystems');
});

test('external corpus: the recorded measurement after the fixes has no miss; the one before is kept as the evidence of the gaps', () => {
  const after = JSON.parse(fs.readFileSync(path.join(HERE, 'external', 'results-after.json'), 'utf8')), before = JSON.parse(fs.readFileSync(path.join(HERE, 'external', 'results-before.json'), 'utf8'));
  const misses = (res) => res.results.flatMap((x) => [!x.detected.ok && `${x.id}: stack`, !x.profile.ok && `${x.id}: profile`, ...Object.entries(x.gates).filter(([, g]) => !g.recognised).map(([k]) => `${x.id}: gate ${k}`)].filter(Boolean));
  assert.deepEqual(misses(after), []);
  assert.ok(misses(before).length >= 6, 'the first run found the gaps this release closed');
  for (const x of after.results) assert.deepEqual(x.hookErrors, [], `${x.id}: the hooks ran clean`);
});

test('external runs: the recorded real runs are two passes over the eight repositories, and the second fails fewer steps than the first', () => {
  const r = JSON.parse(fs.readFileSync(path.join(HERE, 'external', 'results-2026-10-16.json'), 'utf8'));
  assert.equal(r.schema, 'waymark.external-results/v1');
  assert.deepEqual(r.passes.map((x) => [x.name, x.repos.length, x.totals.runsSucceeded]), [['before', 8, 8], ['after', 8, 8]]);
  const failed = (x) => Object.values(x.totals.stepsFailed).reduce((a, b) => a + b, 0);
  assert.ok(failed(r.passes[1]) < failed(r.passes[0]), 'fewer failed steps after the fixes');
  assert.ok(r.notMeasured.length >= 5 && r.notMeasured.some((t) => /toolchain/i.test(t)), 'what was not measured is written');
  assert.doesNotMatch(JSON.stringify(r), /Users[\\/]+[A-Za-z]/, 'no path of a person in the dataset');
});

test('stack detection: C with CMake or Make, and Android (a Gradle build with a manifest in a module); a plain Gradle build is Java', () => {
  assert.equal(S.stackOf(dir({ 'CMakeLists.txt': '', 'list.c': '' })).other, 'c (cmake)');
  assert.equal(S.stackOf(dir({ Makefile: '', 'main.c': '' })).other, 'c (make)');
  assert.equal(S.stackOf(dir({ 'CMakeLists.txt': '' })), null, 'a CMake file with no C source is no C project');
  assert.equal(S.profileOf(dir({ 'CMakeLists.txt': '', 'a.c': '' })).slug, 'c');
  const android = dir({ 'settings.gradle.kts': '', 'app/src/main/AndroidManifest.xml': '<manifest/>' });
  assert.deepEqual([S.profileOf(android).slug, S.profileOf(android).exists], ['android', true]);
  assert.equal(S.profileOf(dir({ 'build.gradle.kts': '', 'src/main/java/A.java': '' })).slug, 'java');
});

test('stack detection: Rust, PHP (a package.json with no framework is its assets), Terraform; a JS framework next to composer.json stays Node', () => {
  assert.equal(S.stackOf(dir({ 'Cargo.toml': '[package]\nname="x"' })).other, 'rust (cargo)');
  assert.equal(S.stackOf(dir({ 'composer.json': '{}', 'package.json': '{"devDependencies":{"vite":"^5","tailwindcss":"^3"}}' })).other, 'php (composer)');
  assert.equal(S.stackOf(dir({ 'main.tf': 'resource "x" "y" {}' })).other, 'terraform');
  const mixed = S.stackOf(dir({ 'composer.json': '{}', 'package.json': '{"dependencies":{"react":"^18"}}', 'package-lock.json': '{}' }));
  assert.equal(mixed.pm, 'npm', 'a project with a JS framework keeps the Node stack');
  assert.equal(S.stackOf(dir({ 'README.md': 'docs only' })), null);
});

test('stack profile: each ecosystem maps to a written profile; an unknown one is generic', () => {
  const slug = (files) => S.profileOf(dir(files));
  for (const [files, want] of [[{ 'Cargo.toml': '' }, 'rust'], [{ 'composer.json': '{}' }, 'php'], [{ 'a.tf': '' }, 'terraform'], [{ 'go.mod': 'module x' }, 'go'], [{ 'pyproject.toml': '' }, 'python'], [{ 'pom.xml': '' }, 'java'], [{ 'x.csproj': '' }, 'dotnet'], [{ 'package.json': '{"dependencies":{"@angular/core":"21"}}' }, 'angular'], [{ 'README.md': '' }, 'generic']]) {
    const p = slug(files);
    assert.deepEqual([p.slug, p.exists], [want, true], Object.keys(files)[0]);
  }
});

test('gate recognition: the commands of the ecosystems the corpus covers are gates, tests or builds; fmt without -check is none', () => {
  const kind = (cmd) => { const k = R.shellRuns(cmd)[0] || {}; return k.test ? 'test' : k.build ? 'build' : k.gate ? 'gate' : null; };
  for (const [cmd, want] of [['cargo test', 'test'], ['cargo clippy --all-targets -- -D warnings', 'gate'], ['cargo build', 'build'], ['php artisan test', 'test'], ['./vendor/bin/pint --test', 'gate'], ['./vendor/bin/phpstan analyse', 'gate'], ['./vendor/bin/pest', 'test'], ['composer validate --strict', 'gate'],
    ['terraform validate', 'gate'], ['terraform fmt -check -recursive', 'gate'], ['terraform test', 'test'], ['tofu validate', 'gate'], ['tflint', 'gate'], ['pytest', 'test'], ['ruff check .', 'gate'], ['mypy .', 'gate'],
    ['terraform fmt -recursive', null], ['terraform plan', null], ['terraform apply', null], ['composer install', null]]) {
    assert.equal(kind(cmd), want, cmd);
  }
});

test('fixtures: each repository of the corpus has a committed fixture at its pinned commit, and the fixture holds exactly what was recorded', () => {
  const index = JSON.parse(fs.readFileSync(path.join(HERE, 'external', 'fixtures', 'fixtures.json'), 'utf8'));
  assert.equal(index.schema, 'waymark.external-fixtures/v1');
  assert.deepEqual(Object.keys(index.repos).sort(), manifest.repos.map((r) => r.id).sort());
  const walk = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), path.posix.join(rel, e.name)) : [path.posix.join(rel, e.name)]));
  for (const r of manifest.repos) {
    const fx = index.repos[r.id], root = path.join(HERE, 'external', 'fixtures', r.id);
    assert.equal(fx.commit, r.commit, `${r.id}: the fixture is of the commit the corpus pins`);
    assert.deepEqual(walk(root).sort(), fx.files, `${r.id}: the committed files are the recorded ones`);
    for (const p of fx.files) assert.equal(fs.statSync(path.join(root, p)).size > 0, fx.withContent.includes(p), `${r.id}/${p}: only the manifests carry text`);
    if (r.sample) assert.ok(fx.files.includes(r.sample), `${r.id}: the task's sample file is there`);
  }
});

test('fixtures: measured with no clone and no network, every repository is detected, profiled, has its gates recognised and runs the hooks clean', async () => {
  const { measure } = await import(`file://${SCRIPTS}/external-corpus.mjs`);
  for (const e of manifest.repos) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-fx-'));
    temps.push(root);
    fs.cpSync(path.join(HERE, 'external', 'fixtures', e.id), root, { recursive: true }); // a copy outside this repository, so no project memory is shared
    for (const args of [['init', '-q'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fixture']]) spawnSync('git', args, { cwd: root }); // a repository, as the clone was
    const r = await measure(root, e);
    assert.ok(r.detected.ok, `${e.id}: stack ${r.detected.stack}, expected ${r.detected.expected}`);
    assert.ok(r.profile.ok, `${e.id}: profile ${r.profile.slug}`);
    for (const [name, g] of Object.entries(r.gates)) assert.ok(g.recognised, `${e.id}: gate ${name} (${g.command}) is not recognised`);
    assert.deepEqual(r.hookErrors, [], e.id);
    for (const t of ['doc', 'code']) if (r.tasks[t]) assert.deepEqual(r.tasks[t].blocked, [], `${e.id}: the scripted ${t} task is blocked for nothing`);
  }
});
