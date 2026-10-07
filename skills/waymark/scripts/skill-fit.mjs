#!/usr/bin/env node
// Waymark · skills you never use stop costing context (Claude Code). Every listed skill's name and description is
// sent in every session; this script reads the agent's own transcripts (~/.claude/projects/*.jsonl, offline) to find
// the skills listed in the latest session and how often each one was invoked in the last N days (default 30).
// Unused skills get `skillOverrides: { "<name>": "name-only" }` (still invocable by name, description no longer
// listed); unused plugins get `enabledPlugins: { "<plugin>": false }` (plugin skills ignore skillOverrides). Both go
// to the user settings (~/.claude/settings.json), because usage is measured across all projects. Never touched:
// Waymark's own skills, every skill or agent that skill-map.json names as a provider, and skills bundled with the agent. Only the entries this script
// added are ever lifted (tracked in ~/.waymark/skill-fit.json). Takes effect in the next session. Also see /skill-doctor.
// Usage: node skill-fit.mjs [--apply | --restore] [--days 30] [--json]   (plans by default; --apply after the user's yes)
// `waymark.mjs check` reports the plan's size (docs/adr/0008).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const LOCAL = process.env.WAYMARK_HOME || path.join(HOME, '.waymark');
const PROJECTS = process.env.WAYMARK_CLAUDE_PROJECTS || path.join(HOME, '.claude', 'projects');
const SETTINGS = process.env.WAYMARK_CLAUDE_SETTINGS || path.join(HOME, '.claude', 'settings.json');
const PLUGINS = process.env.WAYMARK_CLAUDE_PLUGINS || path.join(HOME, '.claude', 'plugins', 'installed_plugins.json');
const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MAP = path.join(SKILLS_ROOT, 'waymark', 'skill-map.json');
const STATE = path.join(LOCAL, 'skill-fit.json');
const MIN_HISTORY_DAYS = Number(process.env.WAYMARK_SKILL_FIT_MIN_DAYS ?? 14); // less history than this → no recommendation (everything would look unused)
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

function transcripts() {
  const out = [];
  const walk = (d) => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch {} for (const x of e) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p); else if (x.name.endsWith('.jsonl')) out.push({ file: p, mtime: fs.statSync(p).mtimeMs }); } };
  walk(PROJECTS);
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Skills listed to the model in the most recent session that recorded a listing: name → characters.
function latestListing(files) {
  for (const { file } of files) {
    if (file.includes(`${path.sep}subagents${path.sep}`)) continue;
    const line = readText(file).split('\n').find((l) => l.includes('"type":"skill_listing"') && l.includes('"isInitial":true'));
    if (!line) continue;
    try {
      const a = JSON.parse(line).attachment, chars = {};
      // Entries are "- <name>: <description>"; names may contain ":" (plugin:skill), so cut at the listed names.
      const text = '\n' + String(a.content || '');
      const at = (a.names || []).map((n) => ({ n, i: text.indexOf(`\n- ${n}: `) })).filter((x) => x.i >= 0).sort((x, y) => x.i - y.i);
      at.forEach((x, j) => { chars[x.n] = (j + 1 < at.length ? at[j + 1].i : text.length) - x.i - 1; });
      for (const n of a.names || []) if (!(n in chars)) chars[n] = n.length + 4;
      return { file, chars };
    } catch {}
  }
  return null;
}

// Invocations per skill in the window: the Skill tool and slash commands typed by the user.
function usage(files, since) {
  const used = {};
  let oldest = Date.now();
  for (const { file, mtime } of files) {
    if (mtime < since) continue;
    for (const l of readText(file).split('\n')) {
      if (!l.includes('"Skill"') && !l.includes('command-name')) continue;
      let d; try { d = JSON.parse(l); } catch { continue; }
      const at = Date.parse(d.timestamp || '') || mtime;
      if (at < since) continue;
      oldest = Math.min(oldest, at);
      for (const c of Array.isArray(d.message?.content) ? d.message.content : []) {
        if (c.type === 'tool_use' && c.name === 'Skill' && c.input?.skill) used[c.input.skill] = (used[c.input.skill] || 0) + 1;
      }
      const text = typeof d.message?.content === 'string' ? d.message.content : '';
      const cmd = d.type === 'user' && text.match(/<command-name>\/?([^<\s]+)<\/command-name>/)?.[1];
      if (cmd) used[cmd] = (used[cmd] || 0) + 1;
    }
  }
  for (const { file } of files) { const first = readText(file).match(/"timestamp":"([^"]+)"/)?.[1]; if (first) oldest = Math.min(oldest, Date.parse(first) || oldest); }
  return { used, historyDays: Math.floor((Date.now() - oldest) / 86400000) };
}

// Names Waymark relies on: its own skills (description starts with "Waymark") and skill-map providers.
function protectedNames() {
  const names = new Set(Object.keys(readJson(MAP)?.skills || {}));
  try {
    for (const d of fs.readdirSync(SKILLS_ROOT)) if (/^description:\s*"?Waymark/m.test(readText(path.join(SKILLS_ROOT, d, 'SKILL.md')))) names.add(d);
  } catch {}
  return names;
}

export function plan({ days = 30 } = {}) {
  const files = transcripts();
  const listing = latestListing(files);
  if (!listing) return { skipped: 'no session transcript with a skill listing yet', skills: [], plugins: [] };
  const { used, historyDays } = usage(files, Date.now() - days * 86400000);
  const keep = protectedNames();
  const settings = readJson(SETTINGS) || {};
  const overrides = settings.skillOverrides || {};
  const installed = Object.keys(readJson(PLUGINS)?.plugins || {});
  const enabled = installed.filter((k) => settings.enabledPlugins?.[k] !== false);
  const pluginOf = (n) => (n.includes(':') ? enabled.find((k) => k.split('@')[0] === n.split(':')[0]) : null);
  const isKept = (n) => keep.has(n) || keep.has(n.split(':').pop());
  const usedCount = (n) => (used[n] || 0) + (n.includes(':') ? used[n.split(':').pop()] || 0 : 0);

  const skills = [], byPlugin = new Map();
  for (const [name, chars] of Object.entries(listing.chars)) {
    if (isKept(name) || usedCount(name)) continue;
    const plugin = pluginOf(name);
    if (plugin) { const p = byPlugin.get(plugin) || { plugin, skills: [], chars: 0 }; p.skills.push(name); p.chars += chars; byPlugin.set(plugin, p); continue; }
    if (overrides[name] && overrides[name] !== 'on') continue;
    // Only skills the user added: synced from claude.ai (`prefix:name`) or in ~/.claude/skills. Skills bundled with
    // the agent or its app (no prefix, not on disk) are left alone: other tools may load them by name.
    if (!name.includes(':') && !fs.existsSync(path.join(path.dirname(SETTINGS), 'skills', name, 'SKILL.md'))) continue;
    if (chars > name.length + 6) skills.push({ name, chars });
  }
  // A plugin counts as used when any of its skills was invoked.
  const plugins = [...byPlugin.values()].filter((p) => !Object.keys(used).some((u) => u.split(':')[0] === p.plugin.split('@')[0]));
  const lift = Object.keys(readJson(STATE)?.skills || {}).filter((n) => usedCount(n)); // ours, used again → lift
  const out = { days, historyDays, listing: listing.file, skills: skills.sort((a, b) => b.chars - a.chars), plugins, lift };
  if (historyDays < MIN_HISTORY_DAYS) return { ...out, skipped: `only ${historyDays} days of history (need ${MIN_HISTORY_DAYS})`, skills: [], plugins: [] };
  return out;
}

function write(mutate) {
  const raw = fs.existsSync(SETTINGS) ? fs.readFileSync(SETTINGS, 'utf8') : '';
  let s = {};
  try { s = raw ? JSON.parse(raw) : {}; } catch { console.error(`${SETTINGS} is not valid JSON: nothing changed. Fix it and re-run.`); process.exit(1); } // never overwrite what we cannot parse
  mutate(s);
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  if (raw) fs.copyFileSync(SETTINGS, SETTINGS + '.waymark-bak');
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const days = Number(args[args.indexOf('--days') + 1]) || 30;
  const p = plan({ days });
  if (args.includes('--json')) { console.log(JSON.stringify(p, null, 2)); process.exit(0); }
  const state = readJson(STATE) || { skills: {}, plugins: {} };
  if (args.includes('--restore')) {
    write((s) => {
      for (const n of Object.keys(state.skills)) if (s.skillOverrides?.[n] === 'name-only') delete s.skillOverrides[n];
      for (const k of Object.keys(state.plugins)) if (s.enabledPlugins?.[k] === false) delete s.enabledPlugins[k];
    });
    fs.writeFileSync(STATE, JSON.stringify({ skills: {}, plugins: {} }, null, 2));
    console.log(`Restored: ${Object.keys(state.skills).length} skills, ${Object.keys(state.plugins).length} plugins (backup ${SETTINGS}.waymark-bak). Next session.`);
    process.exit(0);
  }
  if (p.skipped) { console.log(`Skill fit: skipped (${p.skipped}).`); process.exit(0); }
  const k = (n) => `~${Math.round(n / 4)} tokens`;
  for (const s of p.skills) console.log(`name-only ${s.name} (0 uses in ${days} days; description ${s.chars} chars, ${k(s.chars)} per session)`);
  for (const g of p.plugins) console.log(`disable plugin ${g.plugin} (${g.skills.length} skills, 0 uses in ${days} days; ${k(g.chars)} per session)`);
  for (const n of p.lift) console.log(`lift ${n} (used again)`);
  const total = p.skills.reduce((a, s) => a + s.chars, 0) + p.plugins.reduce((a, g) => a + g.chars, 0);
  if (!p.skills.length && !p.plugins.length && !p.lift.length) { console.log(`Skill fit: every listed skill was used in the last ${days} days or is protected.`); process.exit(0); }
  if (!args.includes('--apply')) { console.log(`\nPlan only (saves ${k(total)} per session). Unused skills stay invocable by name; plugins can be re-enabled with /plugin. Ask the user, then re-run with --apply (or --restore later). Takes effect in the next session.`); process.exit(0); }
  write((s) => {
    s.skillOverrides = s.skillOverrides || {};
    for (const x of p.skills) { s.skillOverrides[x.name] = 'name-only'; state.skills[x.name] = Date.now(); }
    for (const n of p.lift) { if (s.skillOverrides[n] === 'name-only') delete s.skillOverrides[n]; delete state.skills[n]; }
    s.enabledPlugins = s.enabledPlugins || {};
    for (const g of p.plugins) { s.enabledPlugins[g.plugin] = false; state.plugins[g.plugin] = Date.now(); }
  });
  fs.mkdirSync(LOCAL, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
  console.log(`updated ${SETTINGS} (backup .waymark-bak). Done: new sessions list ${k(total)} less.`);
}
