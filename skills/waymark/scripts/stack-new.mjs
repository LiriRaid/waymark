#!/usr/bin/env node
// Waymark · `waymark.mjs stack-new <path>` (docs/adr/0039): drafts a stack profile for a repository that has none, from what the repository
// itself says: its manifests, its scripts (package.json, composer.json, a Makefile) and its CI files. The draft follows templates/stack.template.md;
// every command it proposes is marked "to verify once" (the profile's own rule: run each once, then record it in project memory). It never runs a
// command and never writes into the skills: the draft goes to ~/.waymark/drafts/stacks/<slug>.md (or --out), and the user's yes moves it in.
//   node stack-new.mjs <path> [--out <file>] [--slug <slug>] [--print]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stackOf, isAndroid } from './stack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..');
const GATES = ['typecheck', 'lint', 'test', 'build', 'format'];

const exists = (root, rel) => fs.existsSync(path.join(root, rel));
const text = (root, rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } };
const json = (root, rel) => { try { return JSON.parse(text(root, rel)); } catch { return null; } };
// Files in the root and one folder down whose name matches (a manifest in a module, a *.tf in modules/).
const find = (root, re, depth = 1) => {
  const out = [];
  const walk = (d, n) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (/^(\.git|node_modules|vendor|target|build|dist|\.terraform)$/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (n < depth) walk(p, n + 1); } else if (re.test(e.name)) out.push(path.relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root, 0);
  return out;
};
const composerDeps = (c) => ({ ...(c?.require || {}), ...(c?.['require-dev'] || {}) });
const pyText = (root) => `${text(root, 'pyproject.toml')}\n${text(root, 'setup.cfg')}\n${text(root, 'requirements.txt')}\n${text(root, 'requirements-dev.txt')}`;
const make = (root) => { const t = text(root, 'Makefile'); return (name) => new RegExp(`^${name}\\s*:`, 'm').test(t); };

// An ecosystem: how to recognise it (`match`), the signals the profile's Detect names (`signals`: the files that exist here) and the gates
// the repository's own files make worth proposing. A gate is [command, note] or null (not a gate here, said in the note of `none`).
const ECOSYSTEMS = [
  { id: 'rust', name: 'Rust (Cargo)', match: (r) => exists(r, 'Cargo.toml'), signals: (r) => ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml'].filter((f) => exists(r, f)),
    detect: (r) => `\`Cargo.toml\` at the root${/^\[workspace\]/m.test(text(r, 'Cargo.toml')) ? ' (a `[workspace]` table means a multi-crate workspace; run commands per crate with `-p <crate>` or for all with `--workspace`)' : ''}, \`Cargo.lock\`, \`rust-toolchain.toml\``,
    gates: () => ({ typecheck: ['cargo check --all-targets', 'Compiles without producing binaries; the fast gate'], lint: ['cargo clippy --all-targets -- -D warnings', 'Needs the `clippy` component; warnings fail the gate'],
      test: ['cargo test', 'Non-watch; `--workspace` for every crate; doc tests run too'], build: ['cargo build', '`--release` only when the task is about performance or packaging'], format: ['cargo fmt --check', 'A gate in CI, `cargo fmt` fixes it'] }) },
  { id: 'php', name: 'PHP (Composer)', match: (r) => exists(r, 'composer.json'), signals: (r) => ['composer.json', 'composer.lock', 'artisan', 'phpunit.xml', 'phpstan.neon', 'pint.json'].filter((f) => exists(r, f)),
    detect: (r) => `\`composer.json\` at the root (\`require.php\`, \`require-dev\`), \`composer.lock\`${exists(r, 'artisan') ? '; Laravel adds `artisan`, `bootstrap/app.php` and `laravel/framework` in `require`' : ''}`,
    gates: (r) => {
      const deps = composerDeps(json(r, 'composer.json')), pkg = json(r, 'package.json');
      const phpstan = exists(r, 'phpstan.neon') || exists(r, 'phpstan.neon.dist') || deps['phpstan/phpstan'] || deps['larastan/larastan'] || deps['nunomaduro/larastan'];
      const pint = deps['laravel/pint'] || exists(r, 'pint.json');
      const tests = exists(r, 'artisan') ? 'php artisan test' : exists(r, 'pest.php') || deps['pestphp/pest'] ? './vendor/bin/pest' : exists(r, 'phpunit.xml') || exists(r, 'phpunit.xml.dist') || deps['phpunit/phpunit'] ? './vendor/bin/phpunit' : null;
      return { typecheck: phpstan ? ['./vendor/bin/phpstan analyse', 'Configured here (phpstan or larastan)'] : ['composer validate --strict', 'The manifest check: no static analyser is configured'],
        lint: pint ? ['./vendor/bin/pint --test', 'Laravel Pint, check mode; `./vendor/bin/pint {files}` fixes'] : exists(r, 'phpcs.xml') || deps['squizlabs/php_codesniffer'] ? ['./vendor/bin/phpcs', 'PHP_CodeSniffer'] : null,
        test: tests ? [tests, 'Non-watch'] : null, build: pkg?.scripts?.build ? ['npm run build', 'Front-end assets; PHP itself is not compiled'] : ['none', 'PHP is not compiled'], format: pint ? ['./vendor/bin/pint {files}', 'Not a gate'] : null };
    } },
  { id: 'terraform', name: 'Terraform (OpenTofu)', match: (r) => find(r, /\.tf$/, 2).length > 0, signals: (r) => [...(find(r, /\.tf$/, 0).length ? ['*.tf'] : []), ...['.terraform.lock.hcl', 'versions.tf', '.tflint.hcl'].filter((f) => exists(r, f)), ...(find(r, /\.tfvars$/, 0).length ? ['*.tfvars'] : [])],
    detect: () => '`*.tf` files at the root or under `modules/`, `.terraform.lock.hcl`, `versions.tf` (`required_version`, `required_providers`), `terraform.tfvars` or `*.tfvars`',
    gates: (r) => ({ typecheck: ['terraform validate', 'Needs `terraform init -backend=false` first; no cloud credentials'], lint: ['terraform fmt -check -recursive', `\`terraform fmt -recursive\` fixes${exists(r, '.tflint.hcl') ? '; `tflint` is configured here' : ''}`],
      test: find(r, /\.tftest\.hcl$/, 2).length ? ['terraform test', 'Terraform 1.6+; the `.tftest.hcl` files of this repository'] : ['none', 'No `.tftest.hcl` here'], build: ['none', '`terraform plan` needs credentials and state: never a gate, run only when the user asks'], format: ['terraform fmt', 'Not a gate'] }) },
  { id: 'go', name: 'Go', match: (r) => exists(r, 'go.mod'), signals: (r) => ['go.mod', 'go.sum', '.golangci.yml', '.golangci.yaml'].filter((f) => exists(r, f)), detect: () => '`go.mod` at the root, `go.sum`',
    gates: (r) => ({ typecheck: ['go vet ./...', 'Static checks; compiles the packages'], lint: exists(r, '.golangci.yml') || exists(r, '.golangci.yaml') ? ['golangci-lint run', 'Configured here'] : ['gofmt -l .', 'Lists files that need formatting; empty output passes'],
      test: ['go test ./...', 'Non-watch'], build: ['go build ./...', 'Compiles every package'], format: ['gofmt -w .', 'Not a gate'] }) },
  { id: 'python', name: 'Python', match: (r) => exists(r, 'pyproject.toml') || exists(r, 'requirements.txt') || exists(r, 'setup.py'), signals: (r) => ['pyproject.toml', 'requirements.txt', 'setup.py', 'tox.ini', 'pytest.ini'].filter((f) => exists(r, f)), detect: () => '`pyproject.toml` or `requirements.txt` at the root',
    gates: (r) => { const t = pyText(r); return { typecheck: /\bmypy\b/.test(t) || exists(r, 'mypy.ini') ? ['mypy .', 'Configured here'] : /\bpyright\b/.test(t) ? ['pyright', 'Configured here'] : null, lint: /\bruff\b/.test(t) || exists(r, 'ruff.toml') ? ['ruff check .', 'Configured here'] : /\bflake8\b/.test(t) ? ['flake8', 'Configured here'] : null,
      test: /\bpytest\b/.test(t) || exists(r, 'pytest.ini') ? ['pytest', 'Non-watch'] : ['python -m unittest', 'The standard library runner'], build: ['none', 'Python is not compiled; `python -m build` only when packaging'], format: /\bruff\b/.test(t) ? ['ruff format .', 'Not a gate'] : null }; } },
  { id: 'dotnet', name: '.NET', match: (r) => find(r, /\.(sln|csproj|fsproj)$/, 1).length > 0, signals: (r) => find(r, /\.(sln|csproj|fsproj)$/, 1).slice(0, 3), detect: () => 'a `*.sln` or `*.csproj` at the root',
    gates: () => ({ typecheck: null, lint: ['dotnet format --verify-no-changes', 'Verifies formatting and analyzer style rules without modifying files'], test: ['dotnet test --nologo', 'Non-watch'], build: ['dotnet build --nologo', 'Restores and compiles the solution'], format: ['dotnet format', 'Applies fixes; not a gate'] }) },
  { id: 'android', name: 'Android (Gradle)', match: (r) => isAndroid(r), signals: (r) => ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'gradlew'].filter((f) => exists(r, f)), detect: () => 'a Gradle build (`settings.gradle(.kts)`, `build.gradle(.kts)`) whose module holds an `AndroidManifest.xml`',
    gates: () => ({ typecheck: ['./gradlew compileDebugKotlin', 'Compiles the debug sources of every module; the fast gate'], lint: ['./gradlew lint', 'Android Lint'], test: ['./gradlew testDebugUnitTest', 'JVM unit tests; instrumented tests need a device and are not a gate'], build: ['./gradlew assembleDebug', 'Produces the debug APK'], format: null }) },
  { id: 'java', name: 'Java (Maven or Gradle)', match: (r) => exists(r, 'pom.xml') || exists(r, 'build.gradle') || exists(r, 'build.gradle.kts'), signals: (r) => ['pom.xml', 'build.gradle', 'build.gradle.kts', 'gradlew'].filter((f) => exists(r, f)), detect: () => '`pom.xml` or `build.gradle(.kts)` at the root',
    gates: (r) => (exists(r, 'pom.xml') ? { typecheck: null, lint: null, test: ['mvn -q test', 'Non-watch'], build: ['mvn -q -DskipTests package', 'Produces the jar'], format: null }
      : { typecheck: null, lint: ['./gradlew check -x test', 'Static analysis wired into `check`, without the tests'], test: ['./gradlew test', 'Non-watch'], build: ['./gradlew build -x test', 'Produces the jar'], format: null }) },
  { id: 'ruby', name: 'Ruby (Bundler)', match: (r) => exists(r, 'Gemfile'), signals: (r) => ['Gemfile', 'Gemfile.lock', '.rubocop.yml'].filter((f) => exists(r, f)), detect: () => '`Gemfile` at the root, `Gemfile.lock`',
    gates: (r) => ({ typecheck: null, lint: exists(r, '.rubocop.yml') ? ['bundle exec rubocop', 'Configured here'] : null, test: exists(r, 'spec') ? ['bundle exec rspec', 'Non-watch'] : ['bundle exec rake test', 'Non-watch'], build: ['none', 'Ruby is not compiled'], format: null }) },
  { id: 'dart', name: 'Dart (Flutter)', match: (r) => exists(r, 'pubspec.yaml'), signals: (r) => ['pubspec.yaml', 'pubspec.lock', 'analysis_options.yaml'].filter((f) => exists(r, f)), detect: () => '`pubspec.yaml` at the root, `pubspec.lock`',
    gates: (r) => { const flutter = /^\s*flutter:\s*$/m.test(text(r, 'pubspec.yaml')) && /sdk:\s*flutter/.test(text(r, 'pubspec.yaml')); return { typecheck: [flutter ? 'flutter analyze' : 'dart analyze', 'Static analysis'], lint: exists(r, 'analysis_options.yaml') ? [flutter ? 'flutter analyze' : 'dart analyze', 'The lints of analysis_options.yaml'] : null,
      test: [flutter ? 'flutter test' : 'dart test', 'Non-watch'], build: ['none', 'A build needs a target platform: run only when the user asks'], format: ['dart format --output=none --set-exit-if-changed .', 'Check mode'] }; } },
  { id: 'elixir', name: 'Elixir (Mix)', match: (r) => exists(r, 'mix.exs'), signals: (r) => ['mix.exs', 'mix.lock'].filter((f) => exists(r, f)), detect: () => '`mix.exs` at the root, `mix.lock`',
    gates: () => ({ typecheck: ['mix compile --warnings-as-errors', 'Compiles; warnings fail'], lint: ['mix format --check-formatted', 'Check mode'], test: ['mix test', 'Non-watch'], build: ['mix compile', ''], format: ['mix format', 'Not a gate'] }) },
  { id: 'swift', name: 'Swift (SwiftPM)', match: (r) => exists(r, 'Package.swift'), signals: (r) => ['Package.swift', 'Package.resolved'].filter((f) => exists(r, f)), detect: () => '`Package.swift` at the root',
    gates: () => ({ typecheck: ['swift build', 'Compiles the package'], lint: null, test: ['swift test', 'Non-watch'], build: ['swift build', ''], format: null }) },
  { id: 'c', name: 'C (CMake or Make)', match: (r) => exists(r, 'CMakeLists.txt') || (exists(r, 'Makefile') && find(r, /\.(c|h)$/, 1).length > 0), signals: (r) => ['CMakeLists.txt', 'Makefile'].filter((f) => exists(r, f)), detect: () => '`CMakeLists.txt` or a `Makefile` beside C sources',
    gates: (r) => (exists(r, 'CMakeLists.txt') ? { typecheck: ['cmake --build build', 'Configure once with `cmake -S . -B build`'], lint: null, test: ['ctest --test-dir build', 'Non-watch'], build: ['cmake --build build', ''], format: null }
      : { typecheck: null, lint: null, test: make(r)('test') ? ['make test', 'Non-watch'] : null, build: ['make', ''], format: null }) },
  { id: 'node', name: 'Node.js (package.json)', match: (r) => exists(r, 'package.json'), signals: (r) => ['package.json', 'tsconfig.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'bun.lockb'].filter((f) => exists(r, f)), detect: () => '`package.json` at the root, a lockfile, `tsconfig.json`',
    gates: (r) => {
      const pkg = json(r, 'package.json') || {}, s = pkg.scripts || {}, st = stackOf(r), run = st?.run || 'npm run';
      const script = (...names) => names.find((n) => s[n]);
      const t = script('typecheck', 'type-check', 'tsc', 'check-types'), l = script('lint'), te = script('test'), b = script('build');
      return { typecheck: t ? [`${run} ${t}`, 'The package script'] : exists(r, 'tsconfig.json') ? [`${st?.exec || 'npx'} tsc --noEmit`, 'TypeScript, no emit'] : null, lint: l ? [`${run} ${l}`, 'The package script'] : null, test: te ? [`${run} ${te}`, 'The package script; non-watch'] : null, build: b ? [`${run} ${b}`, 'The package script'] : null, format: script('format') ? [`${run} ${script('format')}`, 'Not a gate'] : null };
    } },
];

// The CI commands that look like a gate: the `run:` lines of .github/workflows and the `script:` lines of .gitlab-ci.yml, by the gate they match.
const CI_GATE = { typecheck: /\b(tsc|mypy|pyright|cargo check|go vet|phpstan|validate|compile)\b/, lint: /\b(lint|clippy|eslint|ruff|rubocop|pint|fmt -check|format --check|analyze)\b/, test: /\b(test|pytest|rspec|phpunit|ctest|vitest|jest)\b/, build: /\b(build|assemble|package)\b/ };
export function ciCommands(root) {
  const files = [...find(path.join(root, '.github', 'workflows'), /\.ya?ml$/, 0).map((f) => `.github/workflows/${f}`), ...(exists(root, '.gitlab-ci.yml') ? ['.gitlab-ci.yml'] : [])];
  const lines = files.flatMap((f) => text(root, f).split('\n').map((l) => l.match(/^\s*(?:-\s*)?(?:run:\s*)?-?\s*(.+)$/)?.[1]?.trim()).filter(Boolean));
  const out = {};
  for (const [gate, re] of Object.entries(CI_GATE)) out[gate] = [...new Set(lines.filter((l) => re.test(l) && !/^(name|uses|with|env|if|on|jobs|steps|runs-on|stage|image)\b/.test(l) && l.length < 160).map((l) => l.replace(/^run:\s*/, '')))].slice(0, 2);
  return out;
}

// → the ecosystems this folder is, in the order of ECOSYSTEMS.
export const detectEcosystems = (root) => ECOSYSTEMS.filter((e) => { try { return e.match(root); } catch { return false; } });

// → { slug, name, ecosystem, signals, gates: { typecheck: [command, note] | null, … }, ci, text }: the draft of a profile for `root`, or null when no manifest says what it is.
export function draftProfile(root, { slug = null } = {}) {
  const eco = detectEcosystems(root)[0];
  if (!eco) return null;
  const gates = eco.gates(root), ci = ciCommands(root), signals = eco.signals(root);
  const note = (g) => (ci[g]?.length ? ` · CI runs \`${ci[g][0].replace(/\|/g, '/')}\`` : '');
  const rows = GATES.map((g) => `| ${g} | ${gates[g] ? (gates[g][0] === 'none' ? 'none' : `\`${gates[g][0]}\``) : '—'} | ${gates[g] ? `${gates[g][1]}${note(g)}` : `no ${g} tool is configured here${note(g)}`} (to verify once) |`);
  const mem = (g, label) => `| ${label} | ${gates[g] && gates[g][0] !== 'none' ? `\`${gates[g][0]}\`` : `none (${gates[g]?.[1] || `no ${g} tool is configured`})`} | <date> (to verify once) |`;
  const tpl = text(SKILL, 'templates/stack.template.md');
  const rest = tpl.slice(tpl.indexOf('## Conventions by department')).replace(/^- …$/gm, '- (not drafted: fill it from the repository\'s own rules)');
  const body = [
    `# Stack: ${eco.name}`, '',
    `Draft generated by \`waymark.mjs stack-new\` from this repository's manifests, scripts and CI files (docs/adr/0039); nothing was run. Verify each command once and record it in project memory before relying on it.`, '',
    '## Detect', `Signals the agent checks (waymark \`references/project-detection.md\`): ${eco.detect(root)}. Found here: ${signals.map((s) => `\`${s}\``).join(', ') || 'the manifest'}.`, '',
    '## Commands', 'Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory.', '',
    '| Gate | Command | Notes |', '|---|---|---|', ...rows, '',
    'Project memory example (Quality gates, verified commands):', '',
    '| Gate | Command | Verified |', '|---|---|---|', mem('typecheck', 'typecheck'), mem('lint', 'lint (changed files)'), mem('test', 'test (full)'), mem('build', 'build'), '',
    rest,
  ].join('\n');
  return { slug: slug || eco.id, name: eco.name, ecosystem: eco.id, signals, gates, ci, text: body };
}

// A profile's Detect signals (the backticked names of its Detect section) and its gates ({ typecheck: 'cargo check --all-targets', … }): what two profiles are compared by.
export function parseProfile(md) {
  const section = md.match(/## Detect\n([\s\S]*?)\n## /)?.[1] || '', named = section.split(' Found here:')[0]; // the signals the profile names, not the files this repository happens to hold
  const ticks = (t) => t.match(/`([^`]+)`/g)?.map((x) => x.slice(1, -1)) || [], detect = ticks(named), found = ticks(section.slice(named.length));
  const gates = {};
  for (const m of (md.match(/## Commands\n([\s\S]*?)\nProject memory example/)?.[1] || '').matchAll(/^\| (typecheck|lint|test|build|format) \| (?:`([^`]+)`|(none)[^|]*|—) \|/gm)) gates[m[1]] = m[2] || m[3] || null;
  return { detect, found, gates };
}

const RUN = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (RUN) {
  const args = process.argv.slice(2), opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const target = args.find((a) => !a.startsWith('--') && a !== opt('--out') && a !== opt('--slug'));
  if (!target || !fs.existsSync(target)) { console.log('stack-new: usage: waymark.mjs stack-new <path to a repository> [--out <file>] [--slug <slug>] [--print]'); process.exit(1); }
  const root = path.resolve(target), d = draftProfile(root, { slug: opt('--slug') });
  if (!d) { console.log(`stack-new: no manifest in ${root} says what it is (looked for ${ECOSYSTEMS.map((e) => e.id).join(', ')}): the generic profile applies, and a profile is better written by hand from its documentation.`); process.exit(1); }
  const out = opt('--out') || path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'drafts', 'stacks', `${d.slug}.md`);
  if (args.includes('--print')) console.log(d.text);
  else { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, d.text + '\n'); }
  const proposed = GATES.filter((g) => d.gates[g]).map((g) => `${g}: ${d.gates[g][0]}`);
  console.log(`stack-new: ${d.name} (${d.ecosystem}) · signals: ${d.signals.join(', ') || 'the manifest'}\n  gates proposed, each to verify once: ${proposed.join(' · ') || 'none'}${args.includes('--print') ? '' : `\n  draft: ${out}\n  Not installed: a yes moves it to skills/waymark/stacks/${d.slug}.md (then sync and the manifest).`}`);
}
