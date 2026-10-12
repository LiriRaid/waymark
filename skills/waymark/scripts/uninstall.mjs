#!/usr/bin/env node
// Waymark · uninstall (INSTALL.md §10): what Waymark wrote into each agent comes out; the rest of every file stays as it was.
//   node uninstall.mjs            the plan (nothing is written)
//   node uninstall.mjs --apply    after the user's yes: each file is backed up first (~/.waymark-backups/<stamp>-uninstall/)
// - Hooks: the entries that run waymark/scripts/<hook>.mjs, from Claude Code's settings.json, Codex's hooks.json, Gemini
//   CLI's settings.json and Cursor's hooks.json (an event left without hooks goes too).
// - Claude Code's status line: Waymark's goes; the one the user had (~/.waymark/statusline.json) comes back.
// - OpenCode: the plugin file (plugins/waymark.js).
// - The marked blocks (Rule 0 and the pointer) in CLAUDE.md, next to Claude Code's settings, and in the instructions
//   files connect-agents.mjs writes.
// - skill-fit.mjs --restore and mcp-fit.mjs --restore, when their records hold something (they undo only their own).
// Left for the user: the skills (~/.agents/skills and the links in ~/.claude/skills, INSTALL §10 step 2: this script lives
// there), ~/.waymark (their memory) and the MCP servers (ask before removing any).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { settingsFile, PLUGIN } from './install-hooks.mjs';
import { AGENTS, stripWaymark } from './connect-agents.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const HOME = () => process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
const BACKUPS = () => process.env.WAYMARK_BACKUPS || path.join(path.dirname(HOME()), '.waymark-backups');
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const slash = (p) => String(p).replace(/\\/g, '/');
const OURS = /waymark[\\/]+scripts[\\/]+[\w-]+\.mjs/;
const stamp = (d = new Date()) => `${d.toLocaleDateString('sv')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

// Settings without Waymark's hooks (an entry holds hooks, or is one in Cursor's flat hooks.json). → { next, removed }.
export function withoutHooks(settings) {
  const s = structuredClone(settings || {});
  let removed = 0;
  for (const [event, list] of Object.entries(s.hooks || {})) {
    if (!Array.isArray(list)) continue;
    const kept = list.map((e) => {
      if (Array.isArray(e?.hooks)) { const hooks = e.hooks.filter((h) => !OURS.test(String(h?.command || ''))); removed += e.hooks.length - hooks.length; return hooks.length ? { ...e, hooks } : null; }
      if (OURS.test(String(e?.command || ''))) { removed++; return null; }
      return e;
    }).filter(Boolean);
    if (kept.length) s.hooks[event] = kept; else delete s.hooks[event];
  }
  return { next: s, removed };
}

// → the steps, each { file, what, write: () => void } (a file to rewrite or remove), or { run: [script, ...args], what }.
export function planUninstall() {
  const steps = [];
  for (const agent of ['claude', 'codex', 'gemini', 'cursor']) {
    const file = settingsFile(agent), s = readJson(file);
    if (!s) continue;
    let { next, removed } = withoutHooks(s);
    const what = removed ? [`remove ${removed} Waymark hook${removed > 1 ? 's' : ''}`] : [];
    if (agent === 'claude' && /waymark[\\/]+scripts[\\/]+statusline\.mjs/.test(String(next.statusLine?.command || ''))) {
      const mine = readJson(path.join(HOME(), 'statusline.json'))?.next;
      if (mine) { next.statusLine = { type: 'command', command: mine }; what.push(`statusLine → ${mine} (yours, from ~/.waymark/statusline.json)`); }
      else { delete next.statusLine; what.push('remove statusLine (Waymark\'s)'); }
    }
    if (what.length) steps.push({ agent, file, what: what.join('; '), write: () => fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n') });
  }
  const plugin = PLUGIN();
  if (OURS.test(read(plugin) || '') || /const SCRIPTS = "[^"]*waymark[\\/]+scripts"/.test(read(plugin) || '')) steps.push({ agent: 'opencode', file: plugin, what: 'remove the Waymark plugin', write: () => fs.rmSync(plugin) });
  const instructions = [['claude', path.join(path.dirname(settingsFile('claude')), 'CLAUDE.md')], ...AGENTS().filter((a) => a.file).map((a) => [a.key, path.join(a.dir, a.file)])];
  for (const [agent, file] of instructions) {
    const text = read(file);
    if (text === null || !/<!-- waymark:(begin|pointer) -->/.test(text)) continue;
    const next = stripWaymark(text);
    steps.push({ agent, file, what: 'remove the Waymark block (the rest of the file stays)', write: () => fs.writeFileSync(file, next) });
  }
  const skillFit = readJson(path.join(HOME(), 'skill-fit.json'));
  if (Object.keys(skillFit?.skills || {}).length || Object.keys(skillFit?.plugins || {}).length) steps.push({ run: [path.join(SCRIPTS, 'skill-fit.mjs'), '--restore'], what: 'skill-fit --restore: the skills and plugins it hid come back' });
  const mcpFit = readJson(path.join(HOME(), 'mcp-fit.json'));
  if (Object.values(mcpFit || {}).some((l) => l?.length)) steps.push({ run: [path.join(SCRIPTS, 'mcp-fit.mjs'), '--restore'], what: 'mcp-fit --restore: its deny rules come out of each project\'s .claude/settings.local.json' });
  return steps;
}

// Backs up every file first, then applies the steps. → the backup folder.
export function applyUninstall(steps, now = new Date()) {
  const bk = path.join(BACKUPS(), `${stamp(now)}-uninstall`);
  fs.mkdirSync(bk, { recursive: true });
  for (const s of steps.filter((x) => x.file)) fs.copyFileSync(s.file, path.join(bk, `${s.agent}-${path.basename(s.file)}`));
  for (const s of steps) {
    if (s.write) s.write();
    else spawnSync(process.execPath, s.run, { encoding: 'utf8', stdio: 'inherit', timeout: 60000 });
  }
  return bk;
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const steps = planUninstall();
  if (!steps.length) { console.log('Nothing of Waymark in the agents\' settings or instructions files.'); process.exit(0); }
  for (const s of steps) console.log(s.file ? `${slash(s.file)}: ${s.what}` : `- ${s.what}`);
  if (!process.argv.includes('--apply')) {
    console.log('\nPlan only: nothing was written. Ask the user, then re-run with --apply (each file backed up first). Then INSTALL §10: remove the skills, and ask whether to keep ~/.waymark (default: keep) and the MCP servers.');
    process.exit(0);
  }
  const bk = applyUninstall(steps);
  console.log(`\nDone (backup ${slash(bk)}). Restart each agent. Then INSTALL §10 step 2: remove the skills from ~/.agents/skills and their links in ~/.claude/skills.`);
}
