#!/usr/bin/env node
// Waymark · connects the other coding agents on this machine to the project memory, without installing anything in them.
//   node connect-agents.mjs            dry run: prints, per agent found, what would be written (nothing is written)
//   node connect-agents.mjs --apply    writes it (backup first)
// Per agent folder that exists (every agent in agents/agents.json but Claude Code, and the unknown ones whose
// instructions file is found, docs/adr/0022; Cursor has no instructions file, so nothing is written for it: its session
// hook brings the block): one marked block in its global instructions file, and a
// row in ~/.waymark/agent.md (*Connected agents*). An agent whose hooks run Waymark's scripts (a full install,
// INSTALL.md §1) gets the same Rule 0 block as Claude Code (templates/instructions.md, between waymark:begin/end), kept
// up to date on every run; the others get the pointer line below. Only the marked block is ever written; the rest of
// the file is never touched.
// `waymark.mjs check` reports each agent found and not connected (docs/adr/0008). Offline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN, USER, xdgConfig, agentDir } from './agents/paths.mjs';
import { waymarkHome as HOME, slash } from './lib/paths.mjs';
import { read } from './lib/fs.mjs';

const BACKUPS = () => process.env.WAYMARK_BACKUPS || path.join(path.dirname(HOME()), '.waymark-backups');
const stamp = (d = new Date()) => `${d.toLocaleDateString('sv')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

// Every agent agents.json lists but Claude Code (its CLAUDE.md is the install's), with its global instructions file
// (Cursor keeps its User Rules in its settings, no file: its session hook brings the block). key: install-hooks --agent.
// hooks: the file its hooks live in; adapter: the module that runs Waymark's hooks for it (null: none yet).
export const AGENTS = () => KNOWN.filter((a) => !a.primary).map((a) => ({
  name: a.name, key: a.key, dir: agentDir(a), file: a.instructions, hooks: a.hooks?.file || null, marks: a.marks, adapter: a.adapter, skills: a.skills,
}));
// A folder that is not an agent's although it may look like one (the shared skills folder, Waymark's own).
const NOT_AGENTS = new Set(['.agents', '.agent', '.waymark', '.waymark-backups', '.config', '.cache', '.local', '.git', '.ssh', 'agents']);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// Agents Waymark does not know (docs/adr/0022): a folder in the home (hidden) or in ~/.config, not listed in agents.json,
// with an agent's signals: its instructions file (AGENTS.md or <NAME>.md), a skills/ folder, or a settings file with
// hooks. → [{ name ('.foo', '.config/foo'), key, dir, file (the instructions file found, or null), signals[], unknown }]
export function unknownAgents() {
  const knownDirs = KNOWN.map(agentDir).concat(HOME(), BACKUPS());
  const out = [];
  for (const [root, hidden] of [[USER(), true], [xdgConfig(), false]]) {
    let names = [];
    try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const n of names) {
      if ((hidden && !n.startsWith('.')) || NOT_AGENTS.has(n)) continue;
      const dir = path.join(root, n);
      if (knownDirs.some((k) => same(k, dir))) continue;
      const bare = n.replace(/^\./, ''), signals = [];
      const file = ['AGENTS.md', `${bare.toUpperCase()}.md`].find((f) => fs.existsSync(path.join(dir, f))) || null;
      if (file) signals.push(file);
      if (isDir(path.join(dir, 'skills'))) signals.push('skills/');
      if (['settings.json', 'hooks.json', 'config.json'].some((f) => /"hooks"\s*:/.test(read(path.join(dir, f))))) signals.push('hooks');
      const name = hidden ? n : path.relative(USER(), dir).replace(/\\/g, '/');
      if (signals.length) out.push({ name: name.startsWith('..') ? dir.replace(/\\/g, '/') : name, key: bare.toLowerCase(), dir, file, hooks: null, adapter: null, signals, unknown: true });
    }
  }
  return out;
}
export const POINTER = '<!-- waymark:pointer -->\nSi el proyecto tiene .waymark/, lee .waymark/tasks.md primero.\n<!-- /waymark:pointer -->';
const REGISTRY = '## Connected agents (pointer only)';
const registry = () => path.join(HOME(), 'agent.md');
const BLOCK = /<!-- waymark:begin -->[\s\S]*?<!-- waymark:end -->/;
const POINTER_RE = /\n*<!-- waymark:pointer -->[\s\S]*?<!-- \/waymark:pointer -->\n?/;
// The text without Waymark's marked blocks (Rule 0 and the pointer), the rest as it was (uninstall.mjs).
// The blank lines that set a block apart go with it; nothing else changes.
export const stripWaymark = (text) => String(text)
  .replace(/(^|\n)\n*<!-- waymark:begin -->[\s\S]*?<!-- waymark:end -->\n*/g, (m, lead) => (lead ? '\n\n' : ''))
  .replace(/(^|\n)\n*<!-- waymark:pointer -->[\s\S]*?<!-- \/waymark:pointer -->\n*/g, (m, lead) => (lead ? '\n\n' : ''))
  .replace(/\n\n+$/, '\n');
// The Rule 0 block, as the installer writes it into CLAUDE.md.
export const instructionsBlock = () => read(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'instructions.md')).trim();
// The agent's hooks run Waymark's scripts (its hooks file names them).
// (a settings file names each script's path; the OpenCode plugin names the folder and the scripts apart)
const hooked = (a) => {
  const text = a.hooks ? read(path.join(a.dir, a.hooks)) : '';
  return /waymark[\\/]+scripts[\\/]+[\w-]+-hook\.mjs/.test(text) || (/waymark[\\/]+scripts/.test(text) && /['"`]stop-hook\.mjs['"`]/.test(text));
};

// Another framework's marked blocks (`<!-- gentle-ai:persona -->`): an orchestrator already governs that agent.
export const foreignIn = (text) => [...new Set([...String(text).matchAll(/<!--\s*([\w.-]+):[\w.-]+/g)].map((m) => m[1]).filter((n) => n !== 'waymark'))];

// Agents whose folder exists (with one of the agent's own files, when the folder is shared), then the unknown ones, with
// their state: connected (block present) or not, and the orchestrator found, if any. Two agents with one instructions
// file (Gemini CLI and Antigravity: ~/.gemini/GEMINI.md): the first one listed writes it, the other `shares` it.
export function found() {
  const known = AGENTS().filter((a) => fs.existsSync(a.dir) && (!a.marks || a.marks.some((m) => fs.existsSync(path.join(a.dir, m)))));
  const owners = new Map();
  return [...known, ...unknownAgents()].map((a) => {
    if (!a.file) return { ...a, path: null, exists: false, full: hooked(a), connected: !a.unknown, guestOf: [] }; // nothing to write
    const file = path.join(a.dir, a.file), text = read(file), full = hooked(a), id = path.resolve(file).toLowerCase(), owner = owners.get(id);
    // with hooks: connected when its block is the current one; else when the pointer is there; sharing: as its owner
    const connected = owner ? owner.connected : full ? text.match(BLOCK)?.[0] === instructionsBlock() : text.includes('<!-- waymark:pointer -->');
    if (!owner) owners.set(id, { name: a.name, connected });
    return { ...a, path: file, exists: fs.existsSync(file), full, connected, guestOf: foreignIn(text), shares: owner?.name || null };
  });
}

// Agents found that are not prepared and were never said before: no block or pointer where one can go, documented hooks
// with no adapter, an adapter whose hooks are not registered, or unknown. The session card says them once (session-hook);
// every agent found is then remembered in ~/.waymark/agents-seen.json, so this costs a few stat calls, no network.
export const unprepared = (a) => a.unknown || !a.connected || (a.hooks && !a.adapter) || (a.adapter && !a.full);
export const agentLabel = (a) => (a.unknown ? `${a.name} (unknown)` : a.name);
export function newAgents() {
  const file = path.join(HOME(), 'agents-seen.json');
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const all = found(), id = (a) => path.resolve(a.dir).toLowerCase() + (a.unknown ? '' : `#${a.key}`);
  const fresh = all.filter((a) => !seen.includes(id(a)) && unprepared(a));
  if (all.some((a) => !seen.includes(id(a)))) {
    fs.mkdirSync(HOME(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify([...new Set([...seen, ...all.map(id)])], null, 1) + '\n');
  }
  return fresh.map(agentLabel);
}

// With an orchestrator the pointer still goes in, as Waymark's own block (guest: not Rule 0, never inside its blocks).
// An agent that does not read ~/.agents/skills gets a step saying where it reads them (Waymark's skills are not there).
export function planFor(a) {
  if (!a.file && a.unknown) return { ...a, steps: [], skip: `unknown agent (${a.signals.join(', ')}): its instructions file is not known. To give it the pointer and its hooks, with the user's yes: dept-devex procedures → Add an agent` };
  if (!a.file) return { ...a, steps: [], skip: `no global instructions file: its session hook brings the Rule 0 block (install-hooks --agent ${a.key})` };
  if (a.shares) return { ...a, steps: [], skip: `shares ${slash(a.path)} with ${a.shares}: connected through it` };
  if (a.connected) return { ...a, steps: [], skip: `already connected (${slash(a.path)})` };
  const guest = a.guestOf?.length ? ` as a guest of ${a.guestOf.join(', ')} (its blocks are not touched)` : '';
  const skills = typeof a.skills === 'string' ? [`it reads skills from ${a.skills}, not ~/.agents/skills: Waymark's skills are not there (tell the user; the pointer works without them)`] : [];
  if (a.full) return { ...a, steps: [
    `${a.exists ? `back up ${slash(a.path)}, then ` : `create ${slash(a.path)} and `}write the Rule 0 block (waymark:begin/end, as in CLAUDE.md; its hooks run Waymark) in place of the pointer or an older block${guest}`,
    `register ${a.name} in ${slash(registry())} (${REGISTRY.slice(3)})`] };
  return { ...a, steps: [
    a.exists ? `back up ${slash(a.path)}, then append the marked pointer block${guest || ' (the rest of the file is not touched)'}` : `create ${slash(a.path)} with the marked pointer block`,
    `register ${a.name} in ${slash(registry())} (${REGISTRY.slice(3)})`, ...skills] };
}

export function apply(plan, now = new Date()) {
  let bk = null;
  if (plan.exists) {
    bk = path.join(BACKUPS(), `${stamp(now)}-connect-agents`, plan.name.replace(/\W+/g, '-').toLowerCase());
    fs.mkdirSync(path.dirname(path.join(bk, plan.file)), { recursive: true }); // the file may sit in a subfolder (Kiro's steering/)
    fs.copyFileSync(plan.path, path.join(bk, plan.file));
  }
  const text = read(plan.path);
  fs.mkdirSync(path.dirname(plan.path), { recursive: true });
  const block = plan.full ? instructionsBlock() : POINTER;
  const rest = plan.full ? text.replace(POINTER_RE, '\n') : text;
  const next = plan.full && BLOCK.test(rest) ? rest.replace(BLOCK, () => block)
    : rest.replace(/\n*$/, '') + (rest.trim() ? '\n\n' : '') + block + '\n';
  fs.writeFileSync(plan.path, next);
  register(plan, now);
  return bk;
}

function register(a, now) {
  let text = read(registry()) || '# Agent paths\n';
  if (!text.includes(REGISTRY)) text = text.replace(/\n*$/, '\n') + `\n${REGISTRY}\n\nOther agents on this machine that read the project memory through one line in their instructions file (connect-agents.mjs).\n\n| Agent | Instructions file | Connected |\n|---|---|---|\n`;
  const row = `| ${a.name} | ${slash(a.path)} | ${now.toLocaleDateString('sv')}${a.guestOf?.length ? ` · invitado de ${a.guestOf.join(', ')}` : ''} |`;
  const lines = text.split('\n').filter((l) => !l.startsWith(`| ${a.name} | ${slash(a.path)} |`));
  lines.splice(lines.lastIndexOf('|---|---|---|') + 1, 0, row);
  fs.mkdirSync(HOME(), { recursive: true });
  fs.writeFileSync(registry(), lines.join('\n').replace(/\n*$/, '\n'));
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes('--apply');
  const agents = found();
  if (!agents.length) { console.log(`No other agent found (${AGENTS().map((x) => slash(x.dir)).join(', ')}, or an unknown one).`); process.exit(0); }
  let failed = 0;
  for (const a of agents) {
    const plan = planFor(a);
    console.log(`\n${a.name} (${slash(a.dir)})`);
    if (plan.skip) { console.log(`  skip: ${plan.skip}`); continue; }
    for (const s of plan.steps) console.log(`  - ${s}`);
    if (!write) continue;
    try { const bk = apply(plan); console.log(`  done${bk ? ` · backup ${slash(bk)}` : ''}`); } catch (e) { failed++; console.log(`  FAILED: ${e.message}`); }
  }
  if (!write) console.log(`\nDry run: nothing was written. Add --apply to connect. The line: ${POINTER.split('\n')[1]}`);
  process.exit(failed ? 1 : 0);
}
