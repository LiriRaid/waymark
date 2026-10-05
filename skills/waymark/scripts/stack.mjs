// Waymark · the stack of a project, read from the repo itself every time it is asked (docs/adr/0012): the package
// manager (package.json `packageManager`, else the lockfile) and the installed versions of the main frameworks and
// tools. Project memory is not the source of the stack: a repo that moves to pnpm, or a project on npm, is seen as it is.
// Offline, a few small file reads, 0 model tokens.
import fs from 'node:fs';
import path from 'node:path';

const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const json = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };

const LOCKS = [['pnpm', 'pnpm-lock.yaml'], ['yarn', 'yarn.lock'], ['bun', 'bun.lockb'], ['bun', 'bun.lock'], ['npm', 'package-lock.json']];
// How each manager runs a package binary and a package.json script.
export const RUNNERS = { pnpm: { exec: 'pnpm exec', run: 'pnpm run' }, npm: { exec: 'npx', run: 'npm run' }, yarn: { exec: 'yarn', run: 'yarn run' }, bun: { exec: 'bunx', run: 'bun run' } };
// The packages worth naming, in this order (frameworks first, then build, test and language).
const MAIN = ['@angular/core', 'react', 'next', 'vue', 'nuxt', 'svelte', '@sveltejs/kit', 'astro', '@nestjs/core', 'express', 'fastify', 'prisma', 'primeng',
  'tailwindcss', 'vite', 'vitest', 'jest', '@playwright/test', 'typescript'];

// → { pm, pmVersion, from, exec, run, deps: [[name, version]] } for a Node project; { pm: null, other } for a Ruby, Python or
// Go project; null when the folder has no manifest.
export function stackOf(root) {
  const pkg = json(path.join(root, 'package.json'));
  if (!pkg) {
    const other = [['Gemfile', 'bundler (bundle exec)'], ['pyproject.toml', 'python (pyproject)'], ['requirements.txt', 'python (pip)'], ['go.mod', 'go']].find(([f]) => fs.existsSync(path.join(root, f)));
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
