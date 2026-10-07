#!/usr/bin/env node
// Waymark · framework MCP servers only where the framework is used (Claude Code). Your servers stay where you
// registered them (user scope, .mcp.json or local); nothing is moved or removed. In each project, the servers of
// frameworks that project does not use (Angular CLI, PrimeNG, React, Vue, Tailwind, NestJS, Prisma…) get a
// permission deny rule in the project's own `.claude/settings.local.json` (private, git-ignored), so the agent
// cannot see or call them there; when the project starts using that framework the rule is lifted. Measured on
// Claude Code 2.1.287: a deny rule hides the server from ToolSearch and drops its names/instructions from context.
// Only the rules this script added are ever removed (tracked in ~/.waymark/mcp-fit.json). Takes effect in the next
// session. Generic servers (docs, memory, anything not tied to a framework) are never blocked.
// Usage: node mcp-fit.mjs [--apply] [--project <path>] [--json]   (plans by default; --apply after the user's yes)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const LOCAL = process.env.WAYMARK_HOME || path.join(HOME, '.waymark');
const CLAUDE_JSON = process.env.WAYMARK_CLAUDE_JSON || path.join(HOME, '.claude.json');
const MAP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skill-map.json');
const STATE = path.join(LOCAL, 'mcp-fit.json');
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();

// Framework → manifest signals (dependency names).
export const FRAMEWORKS = {
  angular: ['@angular/core'], primeng: ['primeng'], react: ['react'], next: ['next'], vue: ['vue'], nuxt: ['nuxt'],
  svelte: ['svelte', '@sveltejs/kit'], tailwind: ['tailwindcss'], nest: ['@nestjs/core'], prisma: ['prisma', '@prisma/client'],
  supabase: ['@supabase/supabase-js'], expo: ['expo'], 'react-native': ['react-native'], astro: ['astro'],
  rails: ['rails'], django: ['django'], fastapi: ['fastapi'], flask: ['flask'], laravel: ['laravel/framework'],
  spring: ['spring-boot', 'spring-boot-starter'], dotnet: ['Microsoft.AspNetCore'], flutter: ['flutter'],
};
export const MANIFESTS = ['package.json', 'Gemfile', 'pyproject.toml', 'requirements.txt', 'Pipfile', 'composer.json', 'pom.xml', 'build.gradle', 'pubspec.yaml', 'go.mod'];

// The server's own name wins (primeng → primeng even if mapped to the Angular stack), then its skill-map stack.
export function frameworkOf(name, entry) {
  const n = name.toLowerCase();
  const byName = Object.keys(FRAMEWORKS).sort((a, b) => b.length - a.length).find((f) => new RegExp(`(^|[^a-z])${f.replace('-', '[-_]?')}([^a-z]|$)`).test(n));
  if (byName) return byName;
  const s = String(entry?.stack || '').toLowerCase();
  return Object.keys(FRAMEWORKS).find((f) => s === f || s.includes(f)) || null;
}

export function projectDeps(dir) {
  const deps = new Set();
  const pkg = readJson(path.join(dir, 'package.json'));
  for (const k of ['dependencies', 'devDependencies', 'peerDependencies']) for (const d of Object.keys(pkg?.[k] || {})) deps.add(d);
  for (const m of readText(path.join(dir, 'Gemfile')).matchAll(/^\s*gem\s+['"]([^'"]+)/gm)) deps.add(m[1]);
  for (const f of ['requirements.txt', 'pyproject.toml', 'Pipfile']) for (const m of readText(path.join(dir, f)).matchAll(/^\s*["']?([A-Za-z0-9_.-]+)/gm)) deps.add(m[1].toLowerCase());
  for (const d of Object.keys(readJson(path.join(dir, 'composer.json'))?.require || {})) deps.add(d);
  for (const m of readText(path.join(dir, 'pom.xml')).matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) deps.add(m[1]);
  for (const m of readText(path.join(dir, 'build.gradle')).matchAll(/['"][^:'"]+:([^:'"]+):/g)) deps.add(m[1]);
  if (fs.existsSync(path.join(dir, 'pubspec.yaml'))) deps.add('flutter');
  try { for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.csproj'))) for (const m of readText(path.join(dir, f)).matchAll(/Include="([^"]+)"/g)) deps.add(m[1]); } catch {}
  return deps;
}
export const uses = (deps, fw) => FRAMEWORKS[fw].some((sig) => [...deps].some((d) => d === sig || d.startsWith(sig + '.') || (sig === 'spring-boot' && d.startsWith('spring-boot'))));
export const hasManifest = (dir) => MANIFESTS.some((f) => fs.existsSync(path.join(dir, f))) || (() => { try { return fs.readdirSync(dir).some((n) => n.endsWith('.csproj')); } catch { return false; } })();

// Every MCP server visible in a project: user scope, local scope for that folder, and its .mcp.json.
export function serversFor(dir, cj = readJson(CLAUDE_JSON) || {}) {
  const key = Object.keys(cj.projects || {}).find((k) => norm(k) === norm(dir));
  return [...new Set([...Object.keys(cj.mcpServers || {}), ...Object.keys(cj.projects?.[key]?.mcpServers || {}), ...Object.keys(readJson(path.join(dir, '.mcp.json'))?.mcpServers || {})])];
}

const ruleOf = (server) => `mcp__${server}`;
const settingsFile = (dir) => path.join(dir, '.claude', 'settings.local.json');

// The folder whose manifests describe `dir`: itself, else the nearest parent with one up to the repository root.
// A repository without manifests (docs, scripts, a skills repo) uses no framework; a folder that is neither
// (home, a drive root, a loose folder) is not a project and is left alone.
function manifestDir(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (norm(d) === norm(HOME) || path.dirname(d) === d) return { project: false };
    if (hasManifest(d)) return { project: true, src: d };
    if (fs.existsSync(path.join(d, '.git'))) return { project: true, src: null };
  }
}

// For one project: which deny rules to add (idle framework servers) and which of ours to lift (now used).
export function fitFor(dir, state = readJson(STATE) || {}, cj) {
  const map = readJson(MAP)?.mcp || {};
  const where = fs.existsSync(dir) ? manifestDir(dir) : { project: false };
  if (!where.project) return { project: dir, add: [], lift: [], skipped: 'not a project (no manifest or git repository)' };
  const deps = where.src ? projectDeps(where.src) : new Set();
  if (fs.existsSync(settingsFile(dir)) && !readJson(settingsFile(dir))) return { project: dir, add: [], lift: [], skipped: '.claude/settings.local.json is not valid JSON; fix it by hand first' };
  const deny = new Set(readJson(settingsFile(dir))?.permissions?.deny || []);
  const ours = new Set(state[norm(dir)] || []);
  const add = [], lift = [];
  for (const s of serversFor(dir, cj)) {
    const fw = frameworkOf(s, map[s]);
    if (!fw) continue;
    if (!uses(deps, fw) && !deny.has(ruleOf(s))) add.push({ server: s, framework: fw });
    if (uses(deps, fw) && deny.has(ruleOf(s)) && ours.has(s)) lift.push({ server: s, framework: fw });
  }
  return { project: dir, add, lift };
}

function knownProjects() {
  const dir = path.join(LOCAL, 'projects');
  const list = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => readText(path.join(dir, f)).match(/^Path:\s*([^·\n]+)/m)?.[1]?.trim()).filter(Boolean) : [];
  return [...new Set(list.map((p) => path.resolve(p)))].filter((p) => fs.existsSync(p));
}

function applyFit(f, state) {
  const file = settingsFile(f.project);
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const s = raw ? JSON.parse(raw) : {}; // an unreadable settings file throws: never overwrite what we cannot parse
  s.permissions = s.permissions || {};
  const deny = new Set(s.permissions.deny || []);
  for (const a of f.add) deny.add(ruleOf(a.server));
  for (const l of f.lift) deny.delete(ruleOf(l.server));
  s.permissions.deny = [...deny];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (raw) fs.copyFileSync(file, file + '.waymark-bak');
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
  const ours = new Set(state[norm(f.project)] || []);
  for (const a of f.add) ours.add(a.server);
  for (const l of f.lift) ours.delete(l.server);
  state[norm(f.project)] = [...ours];
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply'), asJson = args.includes('--json');
  const only = args.includes('--project') ? path.resolve(args[args.indexOf('--project') + 1]) : null;
  const state = readJson(STATE) || {};
  const cj = readJson(CLAUDE_JSON) || {};
  const fits = (only ? [only] : knownProjects()).map((p) => fitFor(p, state, cj));
  const changes = fits.filter((f) => f.add.length || f.lift.length);
  if (asJson) { console.log(JSON.stringify(fits, null, 2)); process.exit(0); }
  for (const f of fits) {
    if (f.skipped) { console.log(`${f.project}: skipped (${f.skipped})`); continue; }
    if (!f.add.length && !f.lift.length) { console.log(`${f.project}: fits (no framework server to block or lift)`); continue; }
    for (const a of f.add) console.log(`${f.project}: block ${a.server} (${a.framework} not used here)`);
    for (const l of f.lift) console.log(`${f.project}: lift ${l.server} (${l.framework} is used now)`);
  }
  if (!changes.length) process.exit(0);
  if (!apply) { console.log('\nPlan only: nothing is moved or removed; each project gets deny rules in its .claude/settings.local.json. Ask the user, then re-run with --apply. Takes effect in the next session.'); process.exit(0); }
  for (const f of changes) { applyFit(f, state); console.log(`updated ${settingsFile(f.project)}`); }
  fs.mkdirSync(LOCAL, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log('Done. Restart the agent (new session) in those projects.');
}
