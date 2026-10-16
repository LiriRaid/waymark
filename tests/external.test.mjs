// Waymark 2.0.16 · point 13: validation outside the author's projects. The manifest of the external corpus, the gaps its first
// measurement found (kept as regression cases), and an optional live run. Run: node --test tests/*.test.mjs
//   WAYMARK_EXTERNAL_CORPUS=<dir with a clone per id> node --test tests/external.test.mjs    measures the clones (network not needed here)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  assert.equal(manifest.schema, 'waymark.external-corpus/v1');
  assert.ok(manifest.repos.length >= 5);
  for (const r of manifest.repos) {
    assert.match(r.url, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/, r.id);
    assert.match(r.commit, /^[0-9a-f]{40}$/, r.id);
    assert.ok(r.field && r.language && 'stack' in r.expect && r.expect.profile, r.id);
  }
  assert.equal(new Set(manifest.repos.map((r) => r.language)).size, manifest.repos.length, 'five different ecosystems');
});

test('external corpus: the recorded measurement after the fixes has no miss; the one before is kept as the evidence of the gaps', () => {
  const after = JSON.parse(fs.readFileSync(path.join(HERE, 'external', 'results-after.json'), 'utf8')), before = JSON.parse(fs.readFileSync(path.join(HERE, 'external', 'results-before.json'), 'utf8'));
  const misses = (res) => res.results.flatMap((x) => [!x.detected.ok && `${x.id}: stack`, !x.profile.ok && `${x.id}: profile`, ...Object.entries(x.gates).filter(([, g]) => !g.recognised).map(([k]) => `${x.id}: gate ${k}`)].filter(Boolean));
  assert.deepEqual(misses(after), []);
  assert.ok(misses(before).length >= 6, 'the first run found the gaps this release closed');
  for (const x of after.results) assert.deepEqual(x.hookErrors, [], `${x.id}: the hooks ran clean`);
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

test('live: with WAYMARK_EXTERNAL_CORPUS the clones are measured and nothing misses', { skip: !process.env.WAYMARK_EXTERNAL_CORPUS && 'set WAYMARK_EXTERNAL_CORPUS=<dir with a clone per id>' }, async () => {
  const { measure } = await import(`file://${SCRIPTS}/external-corpus.mjs`);
  for (const e of manifest.repos) {
    const root = path.join(process.env.WAYMARK_EXTERNAL_CORPUS, e.id);
    if (!fs.existsSync(root)) continue;
    const r = await measure(root, e);
    assert.ok(r.detected.ok && r.profile.ok, `${e.id}: ${r.detected.stack} / ${r.profile.slug}`);
    assert.deepEqual(r.hookErrors, [], e.id);
  }
});
