#!/usr/bin/env node
// Waymark · connects the other coding agents on this machine to the project memory, without installing anything in them.
//   node connect-agents.mjs            dry run: prints, per agent found, what would be written (nothing is written)
//   node connect-agents.mjs --apply    writes it (backup first)
// Per agent folder that exists (Codex, Gemini CLI, OpenCode): one marked block in its global instructions file, and a
// row in ~/.waymark/agent.md (*Connected agents*). An agent whose hooks run Waymark's scripts (a full install,
// INSTALL.md §1) gets the same Rule 0 block as Claude Code (templates/instructions.md, between waymark:begin/end), kept
// up to date on every run; the others get the pointer line below. Only the marked block is ever written; the rest of
// the file is never touched.
// `waymark.mjs check` reports each agent found and not connected (docs/adr/0008). Offline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const BACKUPS = () => process.env.WAYMARK_BACKUPS || path.join(path.dirname(HOME()), '.waymark-backups');
const USER = () => process.env.WAYMARK_AGENTS_HOME || os.homedir();
const stamp = (d = new Date()) => `${d.toLocaleDateString('sv')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

// Global instructions file per agent (official docs: Codex AGENTS.md under CODEX_HOME, Gemini CLI GEMINI.md, OpenCode AGENTS.md).
export const AGENTS = () => [
  { name: 'Codex', dir: process.env.CODEX_HOME || path.join(USER(), '.codex'), file: 'AGENTS.md', hooks: 'hooks.json' },
  { name: 'Gemini CLI', dir: process.env.GEMINI_CLI_HOME || path.join(USER(), '.gemini'), file: 'GEMINI.md', hooks: 'settings.json' },
  { name: 'OpenCode', dir: path.join(USER(), '.config', 'opencode'), file: 'AGENTS.md', hooks: path.join('plugins', 'waymark.js') },
];
export const POINTER = '<!-- waymark:pointer -->\nSi el proyecto tiene .waymark/, lee .waymark/tasks.md primero.\n<!-- /waymark:pointer -->';
const REGISTRY = '## Connected agents (pointer only)';
const registry = () => path.join(HOME(), 'agent.md');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
const slash = (p) => p.replace(/\\/g, '/');
const BLOCK = /<!-- waymark:begin -->[\s\S]*?<!-- waymark:end -->/;
const POINTER_RE = /\n*<!-- waymark:pointer -->[\s\S]*?<!-- \/waymark:pointer -->\n?/;
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

// Agents whose folder exists, with their state: connected (block present) or not, and the orchestrator found, if any.
export function found() {
  return AGENTS().filter((a) => fs.existsSync(a.dir)).map((a) => {
    const file = path.join(a.dir, a.file), text = read(file), full = hooked(a);
    // with hooks: connected when its block is the current one; else when the pointer is there
    const connected = full ? text.match(BLOCK)?.[0] === instructionsBlock() : text.includes('<!-- waymark:pointer -->');
    return { ...a, path: file, exists: fs.existsSync(file), full, connected, guestOf: foreignIn(text) };
  });
}

// With an orchestrator the pointer still goes in, as Waymark's own block (guest: not Rule 0, never inside its blocks).
export function planFor(a) {
  if (a.connected) return { ...a, steps: [], skip: `already connected (${slash(a.path)})` };
  const guest = a.guestOf?.length ? ` as a guest of ${a.guestOf.join(', ')} (its blocks are not touched)` : '';
  if (a.full) return { ...a, steps: [
    `${a.exists ? `back up ${slash(a.path)}, then ` : `create ${slash(a.path)} and `}write the Rule 0 block (waymark:begin/end, as in CLAUDE.md; its hooks run Waymark) in place of the pointer or an older block${guest}`,
    `register ${a.name} in ${slash(registry())} (${REGISTRY.slice(3)})`] };
  return { ...a, steps: [
    a.exists ? `back up ${slash(a.path)}, then append the marked pointer block${guest || ' (the rest of the file is not touched)'}` : `create ${slash(a.path)} with the marked pointer block`,
    `register ${a.name} in ${slash(registry())} (${REGISTRY.slice(3)})`] };
}

export function apply(plan, now = new Date()) {
  let bk = null;
  if (plan.exists) {
    bk = path.join(BACKUPS(), `${stamp(now)}-connect-agents`, plan.name.replace(/\W+/g, '-').toLowerCase());
    fs.mkdirSync(bk, { recursive: true });
    fs.copyFileSync(plan.path, path.join(bk, plan.file));
  }
  const text = read(plan.path);
  fs.mkdirSync(plan.dir, { recursive: true });
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
  if (!agents.length) { console.log('No other agent found (~/.codex, ~/.gemini, ~/.config/opencode).'); process.exit(0); }
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
