// Waymark 2.0.18 · point 11: `waymark.mjs stack-new <path>` drafts a stack profile from a repository's manifests, scripts and CI files (docs/adr/0039).
// The rust, php and terraform profiles are deleted from a copy of the skills and drafted again from their fixtures; the draft must agree with the
// shipped profile on what it detects and on every command it proposes. Run: node --test tests/*.test.mjs
import './helpers/isolate.mjs'; // first: no test touches the real home or inherits the session's environment
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = path.join(ROOT, 'skills');
const FIXTURES = path.join(ROOT, 'tests', 'external', 'fixtures');
const temps = [];
after(() => { for (const d of temps) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `wm-sn-${name}-`)); temps.push(d); return d; };
const S = await import(`file://${SKILLS}/waymark/scripts/stack-new.mjs`);
const shipped = (slug) => fs.readFileSync(path.join(SKILLS, 'waymark', 'stacks', `${slug}.md`), 'utf8');
const tree = (files) => { const d = tmp('tree'); for (const [f, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), body); } return d; };
const cli = (home, ...args) => spawnSync(process.execPath, [path.join(SKILLS, 'waymark', 'scripts', 'stack-new.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });

for (const [slug, fixture] of [['rust', 'rust-cli'], ['php', 'php-laravel'], ['terraform', 'terraform'], ['android', 'android-app']]) {
  test(`stack-new: the ${slug} profile, deleted and drafted again from its fixture, agrees with the shipped one`, () => {
    // a copy of the skills without the profile: the draft cannot have read it
    const copy = tmp(`copy-${slug}`);
    fs.cpSync(SKILLS, copy, { recursive: true });
    fs.rmSync(path.join(copy, 'waymark', 'stacks', `${slug}.md`));
    const home = tmp('home'), out = path.join(copy, 'waymark', 'stacks', `${slug}.md`);
    const r = spawnSync(process.execPath, [path.join(copy, 'waymark', 'scripts', 'stack-new.mjs'), path.join(FIXTURES, fixture), '--out', out], { encoding: 'utf8', env: { ...process.env, WAYMARK_HOME: home } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`gates proposed, each to verify once`));
    const mine = S.parseProfile(fs.readFileSync(out, 'utf8')), theirs = S.parseProfile(shipped(slug)), theirsText = shipped(slug);
    // detection: what it names is what the shipped profile names, and its first signal is there
    assert.ok(mine.detect.length >= 2, JSON.stringify(mine.detect));
    for (const sig of mine.detect) assert.ok(theirs.detect.some((t) => t === sig || t.includes(sig) || sig.includes(t)), `${slug}: detects \`${sig}\`, which the shipped profile does not name (${theirs.detect.join(', ')})`);
    assert.ok(mine.detect.some((s) => theirs.detect[0].includes(s) || s.includes(theirs.detect[0])), `${slug}: the shipped profile's first signal ${theirs.detect[0]}`);
    // gates: the same four, and every command it proposes is a command the shipped profile gives
    for (const g of ['typecheck', 'lint', 'test', 'build']) assert.ok(g in mine.gates, `${slug}: the ${g} gate is proposed (as a command or as none)`);
    for (const [g, cmd] of Object.entries(mine.gates)) if (cmd && cmd !== 'none') assert.ok(theirsText.includes(cmd), `${slug}: ${g} = ${cmd}, which the shipped profile does not give`);
    // and the profile applies: the stack module finds it under its slug
    return import(`file://${copy}/waymark/scripts/stack.mjs`).then((M) => assert.deepEqual(M.profileOf(path.join(FIXTURES, fixture)), { slug, exists: true }));
  });
}

test('stack-new: without the profile, the stack module falls back to generic; every proposed command says "to verify once"', async () => {
  const copy = tmp('generic');
  fs.cpSync(SKILLS, copy, { recursive: true });
  for (const s of ['rust', 'php', 'terraform']) fs.rmSync(path.join(copy, 'waymark', 'stacks', `${s}.md`));
  const M = await import(`file://${copy}/waymark/scripts/stack.mjs?${Date.now()}`);
  for (const f of ['rust-cli', 'php-laravel', 'terraform']) assert.equal(M.profileOf(path.join(FIXTURES, f)).exists, false, `${f}: nothing to apply before the draft`);
  const d = S.draftProfile(path.join(FIXTURES, 'rust-cli'));
  assert.ok(d.text.split('\n').filter((l) => /^\| (typecheck|lint|test|build|format) \| /.test(l)).every((l) => /\(to verify once\)/.test(l)), 'every gate row of the Commands table');
  assert.match(d.text, /nothing was run/);
});

test('stack-new: the draft goes to the drafts folder, never into the skills, and nothing is run', () => {
  const home = tmp('drafts'), before = fs.readdirSync(path.join(SKILLS, 'waymark', 'stacks')).sort();
  const r = cli(home, path.join(FIXTURES, 'rust-cli'));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(home, 'drafts', 'stacks', 'rust.md')));
  assert.deepEqual(fs.readdirSync(path.join(SKILLS, 'waymark', 'stacks')).sort(), before, 'the skills are untouched');
  assert.match(r.stdout, /Not installed/);
});

test('stack-new: a repository no manifest describes gets no draft and says why', () => {
  const home = tmp('none');
  const r = cli(home, path.join(FIXTURES, 'docs-only'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no manifest in .* says what it is/);
  assert.equal(S.draftProfile(path.join(FIXTURES, 'docs-only')), null);
  assert.equal(cli(home).status, 1, 'no path: the usage');
});

test('stack-new: ecosystems the profiles do not cover are drafted from their manifests and scripts', () => {
  const dart = S.draftProfile(tree({ 'pubspec.yaml': 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n', 'analysis_options.yaml': 'include: package:flutter_lints/flutter.yaml\n' }));
  assert.deepEqual([dart.slug, dart.gates.typecheck[0], dart.gates.test[0]], ['dart', 'flutter analyze', 'flutter test']);
  const node = S.draftProfile(tree({ 'package.json': JSON.stringify({ scripts: { lint: 'eslint .', test: 'vitest run', build: 'vite build' } }), 'pnpm-lock.yaml': '' }));
  assert.deepEqual([node.slug, node.gates.lint[0], node.gates.test[0], node.gates.build[0]], ['node', 'pnpm run lint', 'pnpm run test', 'pnpm run build']);
  const go = S.draftProfile(tree({ 'go.mod': 'module x\n', '.golangci.yml': 'run: {}\n' }));
  assert.deepEqual([go.gates.typecheck[0], go.gates.lint[0], go.gates.test[0]], ['go vet ./...', 'golangci-lint run', 'go test ./...']);
  const py = S.draftProfile(tree({ 'pyproject.toml': '[tool.ruff]\n[tool.pytest.ini_options]\n', 'mypy.ini': '' }));
  assert.deepEqual([py.gates.typecheck[0], py.gates.lint[0], py.gates.test[0]], ['mypy .', 'ruff check .', 'pytest']);
  const none = S.draftProfile(tree({ 'package.json': JSON.stringify({ name: 'x' }) }));
  assert.equal(none.gates.test, null, 'no test script: no test gate is invented');
});

test('stack-new: the CI files say which commands the project already runs, kept in the notes and never replacing the proposal', () => {
  const d = S.draftProfile(tree({ 'Cargo.toml': '[package]\nname = "x"\n', '.github/workflows/ci.yml': 'jobs:\n  t:\n    steps:\n      - run: cargo clippy --all-targets -- -D warnings\n      - run: cargo test --workspace\n' }));
  assert.deepEqual(d.ci.lint, ['cargo clippy --all-targets -- -D warnings']);
  assert.match(d.text, /\| lint \| `cargo clippy --all-targets -- -D warnings` \|[^\n]*CI runs `cargo clippy --all-targets -- -D warnings`/);
  assert.equal(d.gates.test[0], 'cargo test', 'the proposal is the profile\'s, CI is said beside it');
  assert.match(d.text, /\| test \| `cargo test` \|[^\n]*CI runs `cargo test --workspace`/);
});
