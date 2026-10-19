// Waymark · the stack of a project, read from the repo itself every time it is asked (docs/adr/0012): the package
// manager (package.json `packageManager`, else the lockfile) and the installed versions of the main frameworks and
// tools. Project memory is not the source of the stack: a repo that moves to pnpm, or a project on npm, is seen as it is.
// Offline, a few small file reads, 0 model tokens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { read } from './lib/fs.mjs';

const json = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };

const LOCKS = [['pnpm', 'pnpm-lock.yaml'], ['yarn', 'yarn.lock'], ['bun', 'bun.lockb'], ['bun', 'bun.lock'], ['npm', 'package-lock.json']];
// How each manager runs a package binary and a package.json script.
export const RUNNERS = { pnpm: { exec: 'pnpm exec', run: 'pnpm run' }, npm: { exec: 'npx', run: 'npm run' }, yarn: { exec: 'yarn', run: 'yarn run' }, bun: { exec: 'bunx', run: 'bun run' } };
// The packages worth naming, in this order (frameworks first, then build, test and language).
const MAIN = ['@angular/core', 'react', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'astro', '@nestjs/core', 'express', 'fastify', 'prisma', 'primeng',
  'tailwindcss', 'vite', 'vitest', 'jest', '@playwright/test', 'typescript'];

// Manifests that make a project PHP or Rust even when a package.json (assets, tooling) sits beside them.
const PRIMARY = [['composer.json', 'php (composer)'], ['Cargo.toml', 'rust (cargo)']];
const FRAMEWORKS = ['@angular/core', 'react', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'astro', '@nestjs/core', 'express', 'fastify'];
const hasFramework = (pkg) => FRAMEWORKS.some((n) => (pkg.dependencies || {})[n] || (pkg.devDependencies || {})[n]);
const anyExt = (root, re) => { try { return fs.readdirSync(root).some((f) => re.test(f)); } catch { return false; } };
// C sources beside a CMake or Make build (a library's own, not a native addon of a Node project: that one has a package.json)
const cBuild = (root) => anyExt(root, /\.(c|h)$/i) && (fs.existsSync(path.join(root, 'CMakeLists.txt')) ? 'c (cmake)' : fs.existsSync(path.join(root, 'Makefile')) ? 'c (make)' : null);
// An Android project: a Gradle build whose module holds an AndroidManifest.xml (the root, or one folder down such as app/)
export function isAndroid(root) {
  const gradle = ['settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts'].some((f) => fs.existsSync(path.join(root, f)));
  if (!gradle) return false;
  const manifest = (d) => fs.existsSync(path.join(d, 'src', 'main', 'AndroidManifest.xml')) || fs.existsSync(path.join(d, 'AndroidManifest.xml'));
  try { return manifest(root) || fs.readdirSync(root, { withFileTypes: true }).some((e) => e.isDirectory() && !/^(\.|node_modules$|build$)/.test(e.name) && manifest(path.join(root, e.name))); } catch { return false; }
}

// The ecosystems with a profile that are read from a build file rather than a package manager (docs/adr/0039: the reference bench found the
// card saying nothing about them): Android, Maven, Gradle, .NET and the few that stack-new drafts (Dart, Elixir, Swift). → [file, label] or null.
function buildLabel(root) {
  if (isAndroid(root)) return ['AndroidManifest.xml', 'android (gradle)'];
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has('pom.xml')) return ['pom.xml', 'java (maven)'];
  if (has('build.gradle') || has('build.gradle.kts')) return ['build.gradle', 'java (gradle)'];
  if (anyExt(root, /\.(csproj|fsproj|sln)$/i)) return ['*.csproj', '.net (dotnet)'];
  if (has('pubspec.yaml')) return ['pubspec.yaml', 'dart (pub)'];
  if (has('mix.exs')) return ['mix.exs', 'elixir (mix)'];
  if (has('Package.swift')) return ['Package.swift', 'swift (swiftpm)'];
  return null;
}

// → { pm, pmVersion, from, exec, run, deps: [[name, version]] } for a Node project; { pm: null, other } for a Ruby, Python or
// Go project; null when the folder has no manifest.
export function stackOf(root) {
  let pkg = json(path.join(root, 'package.json'));
  // A package.json that names no JS framework is a front-end build next to another stack's manifest (Laravel's Vite assets,
  // a Rails app's tooling): that other manifest decides, so the commands are not translated to npm for a PHP project.
  if (pkg && !hasFramework(pkg) && PRIMARY.some(([f]) => fs.existsSync(path.join(root, f)))) pkg = null;
  if (!pkg) {
    const other = [...PRIMARY, ['Gemfile', 'bundler (bundle exec)'], ['pyproject.toml', 'python (pyproject)'], ['requirements.txt', 'python (pip)'], ['go.mod', 'go']].find(([f]) => fs.existsSync(path.join(root, f)))
      || (anyExt(root, /\.tf$/i) ? ['*.tf', 'terraform'] : null)
      || (cBuild(root) ? ['CMakeLists.txt', cBuild(root)] : null)
      || buildLabel(root);
    if (!other) return null;
    const rails = other[0] === 'Gemfile' ? read(path.join(root, 'Gemfile.lock')).match(/^\s{4}rails \(([\d.]+)\)/m)?.[1] : null;
    return { pm: null, other: other[1], deps: rails ? [['rails', rails]] : [] };
  }
  const declared = String(pkg.packageManager || '').match(/^(pnpm|yarn|bun|npm)@([\d.]+)/);
  const lock = LOCKS.find(([, f]) => fs.existsSync(path.join(root, f)));
  const pm = declared?.[1] || lock?.[0] || 'npm';
  const all = { ...(pkg.devDependencies || {}), ...(pkg.dependencies || {}) };
  // the installed version when node_modules has it, else the declared range
  const version = (name) => json(path.join(root, 'node_modules', ...name.split('/'), 'package.json'))?.version || String(all[name]).replace(/^[~^>=<\s]+/, '');
  const deps = MAIN.filter((n) => all[n]).map((n) => [n, version(n)]);
  return { pm, pmVersion: declared?.[2] || null, from: declared ? 'package.json packageManager' : lock ? lock[1] : 'default', ...RUNNERS[pm], deps };
}

// The install for a clean copy (a git worktree) of a Node repo: from the package manager's store or cache, the lockfile
// as is, no network. A link to the repo's node_modules is no clean copy, and pnpm purges a modules folder it did not
// make (through a junction, the repo's own). → the command, or null outside Node.
const COPY_INSTALL = { pnpm: 'pnpm install --offline --frozen-lockfile', npm: 'npm ci --prefer-offline --no-audit --no-fund', yarn: 'yarn install --frozen-lockfile --prefer-offline', bun: 'bun install --frozen-lockfile' };
export const copyInstall = (stack) => COPY_INSTALL[stack?.pm] || null;

// A Quality gates Command cell as it runs: a closing note in parentheses with no shell characters ("(not verified)",
// "(sin verificar)") is dropped; one after an operator (`cd api && (npm test)`) is a subshell and stays, and so does the
// reason of a `none (<why>)` row, which runs nothing.
export const gateCell = (cmd) => (/^\s*none\b/i.test(String(cmd || '')) ? String(cmd).trim() : String(cmd || '').replace(/(?<![&|;(]\s*)\s+\([\p{L} ]+\)\s*$/u, '').trim());

// Codex's Windows sandbox does not resolve the .CMD launchers in node_modules/.bin, so `pnpm exec` / `npx` fail there
// ("not recognized") while `pnpm run` works: for that agent a package binary runs with node.
export const directBins = (agent, platform = process.platform) => agent === 'codex' && platform === 'win32';

// The JS file a node_modules/.bin launcher runs, as a path from the repo root: the shell launcher names it
// ("$basedir/../.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc" → node_modules/typescript/bin/tsc). null if none.
export function binEntry(root, bin) {
  const target = read(path.join(root, 'node_modules', '.bin', bin)).match(/"\$basedir\/\.\.\/([^"]+)"/)?.[1];
  if (!target) return null;
  const linked = target.replace(/^\.pnpm\/[^/]+\/node_modules\//, ''); // the top-level link, stable across versions
  return `node_modules/${fs.existsSync(path.join(root, 'node_modules', linked)) ? linked : target}`;
}

// One line for the agent's context, e.g. "pnpm 11.5.0 · @angular/core 21.0.3 · vitest 4.0.8 · run with `pnpm exec <bin>` /
// `pnpm run <script>`". With { direct } (directBins), binaries run with node. '' when there is no manifest.
export function stackLine(root, { direct = false } = {}) {
  const s = stackOf(root);
  if (!s) return '';
  const deps = s.deps.slice(0, 6).map(([n, v]) => `${n} ${v}`);
  if (!s.pm) return [s.other, ...deps].join(' · ');
  if (s.from === 'default') return [`package manager unknown (no packageManager, no lockfile): ask the user before installing`, ...deps].join(' · ');
  const tsc = direct && binEntry(root, 'tsc');
  const run = direct
    ? ` · run binaries with \`node node_modules/<package>/<bin>\` (\`${s.exec}\` fails in this agent's sandbox${tsc ? `; tsc → \`node ${tsc}\`` : ''}) / \`${s.run} <script>\``
    : ` · run with \`${s.exec} <bin>\` / \`${s.run} <script>\``;
  return [`${s.pm}${s.pmVersion ? ` ${s.pmVersion}` : ''}`, ...deps].join(' · ') + run;
}

// memory.md's Identity line "Package manager…: <name>" set to the repo's manager when it names another. → true when
// rewritten.
export function syncIdentity(memoryFile, stack) {
  if (!stack?.pm) return false;
  const text = read(memoryFile);
  const m = text.match(/^(- Package manager[^:\n]*:\s*)([A-Za-z]+)([^\n]*)$/m);
  if (!m || m[2].toLowerCase() === stack.pm) return false;
  fs.writeFileSync(memoryFile, text.replace(m[0], () => `${m[1]}${stack.pm} (read from the repo: ${stack.from})`));
  return true;
}

// A command written for one package manager, rewritten for the repo's: `npx tsc` → `pnpm exec tsc`, `npm run build` →
// `pnpm run build`, and back. Commands that name no package manager are returned as they are. With { root, direct }
// (directBins), a binary whose launcher is found runs with node: `pnpm exec tsc` → `node node_modules/typescript/bin/tsc`.
export function translate(cmd, stack, { root = null, direct = false } = {}) {
  const to = stack?.pm && RUNNERS[stack.pm];
  if (!to) return cmd;
  const viaNode = direct && root
    ? (c) => c.replace(/(^|&&\s*|;\s*|\|\|\s*)(?:npx(?:\s+--no-install)?|pnpm\s+exec|pnpm\s+dlx|yarn\s+dlx|bunx)\s+([\w@./-]+)/g, (all, p, bin) => {
      const entry = binEntry(root, bin);
      return entry ? `${p}node ${entry}` : all;
    })
    : (c) => c;
  return viaNode(String(cmd))
    .replace(/(^|&&\s*|;\s*|\|\|\s*)(?:npx(?:\s+--no-install)?|pnpm\s+exec|pnpm\s+dlx|yarn\s+dlx|bunx)(?=\s)/g, (_, p) => p + to.exec)
    .replace(/(^|&&\s*|;\s*|\|\|\s*)(?:npm|pnpm|yarn|bun)\s+run(?=\s)/g, (_, p) => p + to.run)
    .replace(/(^|&&\s*|;\s*|\|\|\s*)(?:npm|pnpm|yarn|bun)\s+(test|start)\b/g, (_, p, s) => `${p}${stack.pm} ${s}`);
}

// The stack profile (skills/waymark/stacks/<slug>.md) a project falls under: { slug, exists }, from the same precedence as
// stackOf. No signal, or a signal with no profile written yet, is `generic` (docs/adr/0027: the external corpus measures it).
export function profileOf(root) {
  const s = stackOf(root);
  let slug = 'generic';
  if (s?.pm) {
    const names = new Set(s.deps.map(([n]) => n));
    slug = names.has('@angular/core') ? 'angular' : names.has('@nestjs/core') ? 'nestjs' : names.has('react') ? 'react' : 'node';
  } else if (s) {
    slug = /^rust/.test(s.other) ? 'rust' : /^php/.test(s.other) ? 'php' : s.other === 'terraform' ? 'terraform' : /^python/.test(s.other) ? 'python' : s.other === 'go' ? 'go' : /^c \(/.test(s.other) ? 'c' : /^android/.test(s.other) ? 'android' : /^java/.test(s.other) ? 'java' : /^\.net/.test(s.other) ? 'dotnet' : s.deps.some(([n]) => n === 'rails') ? 'rails' : 'generic';
  } else if (isAndroid(root)) slug = 'android';
  else if (['pom.xml', 'build.gradle', 'build.gradle.kts'].some((f) => fs.existsSync(path.join(root, f)))) slug = 'java';
  else if (anyExt(root, /\.(csproj|sln)$/i)) slug = 'dotnet';
  const stacks = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'stacks');
  // An ecosystem read from a build file with no profile of its own: a profile dropped in stacks/ under its name (`stack-new` drafts one) applies at once
  if (slug === 'generic' && s?.other) { const own = String(s.other).split(' ')[0].replace(/^[.]/, ''); if (own && fs.existsSync(path.join(stacks, `${own}.md`))) slug = own; }
  return { slug, exists: fs.existsSync(path.join(stacks, `${slug}.md`)) };
}
