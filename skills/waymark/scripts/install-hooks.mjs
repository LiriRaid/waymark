#!/usr/bin/env node
// Waymark · registers the four hooks of the chain in the agent's settings (docs/adr/0008), instead of a manual merge.
// Usage: node install-hooks.mjs [--apply] [--agent claude]   (shows the plan by default; --apply after the user's yes)
// Claude Code: ~/.claude/settings.json (WAYMARK_CLAUDE_SETTINGS overrides it). Only Waymark's own entries (a command that
// runs waymark/scripts/<hook>.mjs) are added, updated (path, matcher) or de-duplicated; every other key and hook stays,
// and new entries go after the existing ones. A file that is not valid JSON is never written; a backup .waymark-bak is
// made first. Coexistence mode guest or skills-only (~/.waymark/coexistence.md) → no hooks at all.
// Codex (`--agent codex`): ~/.codex/hooks.json (CODEX_HOME, WAYMARK_CODEX_HOOKS overrides it), the same four scripts with
// `--agent codex`, PreToolUse matcher "Bash|apply_patch", commandWindows = command. Codex skips a new or changed hook until
// the user trusts it in /hooks (learn.chatgpt.com/docs/hooks): say so after --apply.
// Gemini CLI (`--agent gemini`): ~/.gemini/settings.json (GEMINI_CLI_HOME, WAYMARK_GEMINI_SETTINGS overrides it), its own
// event names (BeforeAgent, BeforeTool, AfterAgent), BeforeTool matcher "run_shell_command|write_file|replace".
// OpenCode (`--agent opencode`): no command hooks; agents/opencode-plugin.js is copied to
// ~/.config/opencode/plugins/waymark.js (WAYMARK_OPENCODE_PLUGIN overrides it) with this scripts folder in place.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
export const HOOKS = [
  { event: 'SessionStart', file: 'session-hook.mjs' },
  { event: 'UserPromptSubmit', file: 'rule0-hook.mjs' },
  { event: 'PreToolUse', file: 'tool-hook.mjs', matcher: true }, // the agent's tools: MATCHER
  { event: 'Stop', file: 'stop-hook.mjs' },
  { event: 'PostToolUse', file: 'tool-hook.mjs', matcher: true, only: ['gemini'] }, // the pack after the first edit where the pre-tool hook cannot add context
];
const SETTINGS = {
  claude: () => process.env.WAYMARK_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json'),
  codex: () => process.env.WAYMARK_CODEX_HOOKS || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json'),
  gemini: () => process.env.WAYMARK_GEMINI_SETTINGS || path.join(process.env.GEMINI_CLI_HOME || path.join(os.homedir(), '.gemini'), 'settings.json'),
};
export const PLUGIN = () => process.env.WAYMARK_OPENCODE_PLUGIN || path.join(os.homedir(), '.config', 'opencode', 'plugins', 'waymark.js');
// The core's event names → each agent's (Claude Code and Codex share them).
const EVENTS = { gemini: { SessionStart: 'SessionStart', UserPromptSubmit: 'BeforeAgent', PreToolUse: 'BeforeTool', PostToolUse: 'AfterTool', Stop: 'AfterAgent' } };
const MATCHER = { claude: 'Bash|PowerShell|Edit|Write|NotebookEdit', codex: 'Bash|apply_patch', gemini: 'run_shell_command|write_file|replace' }; // PreToolUse tools per agent
const ours = (file) => (h) => new RegExp(`waymark[\\\\/]+scripts[\\\\/]+${file.replace('.', '\\.')}`).test(String(h?.command || ''));

// → { settings, steps } without touching the input: the settings with the four hooks in place and what changed.
export function planHooks(input, { scripts = SCRIPTS, agent = 'claude' } = {}) {
  const s = structuredClone(input || {}), steps = [];
  s.hooks = s.hooks || {};
  for (const h of HOOKS.filter((x) => !x.only || x.only.includes(agent))) {
    const command = `node "${scripts}/${h.file}"${agent === 'claude' ? '' : ` --agent ${agent}`}`;
    const matcher = h.matcher ? MATCHER[agent] || MATCHER.claude : null;
    const windows = agent === 'codex' ? { commandWindows: command } : {}; // Codex's Windows override, the same command
    const event = EVENTS[agent]?.[h.event] || h.event;
    const list = (s.hooks[event] = Array.isArray(s.hooks[event]) ? s.hooks[event] : []);
    const hits = list.filter((e) => (e.hooks || []).some(ours(h.file)));
    if (!hits.length) {
      list.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, ...windows }] });
      steps.push(`add ${event} → ${h.file}`);
      continue;
    }
    const [keep, ...extra] = hits;
    const mine = keep.hooks.find(ours(h.file));
    if (mine.command !== command) { steps.push(`update ${event} command: ${mine.command} → ${command}`); mine.command = command; }
    if (windows.commandWindows && mine.commandWindows !== command) { steps.push(`update ${event} commandWindows → ${command}`); mine.commandWindows = command; }
    if (matcher && keep.matcher !== matcher && keep.hooks.every(ours(h.file))) { steps.push(`update ${event} matcher: ${keep.matcher || '(none)'} → ${matcher}`); keep.matcher = matcher; }
    for (const e of extra) { // a second Waymark entry for the same hook runs it twice: drop it (or just our hook from a shared entry)
      e.hooks = e.hooks.filter((x) => !ours(h.file)(x));
      steps.push(`remove duplicate ${event} → ${h.file}`);
    }
    s.hooks[event] = list.filter((e) => (e.hooks || []).length);
  }
  return { settings: s, steps };
}

// The plugin as installed: the template with this scripts folder in place.
export const pluginText = (scripts = SCRIPTS) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'agents', 'opencode-plugin.js'), 'utf8').replace("'__SCRIPTS__'", JSON.stringify(scripts));

function coexistMode() {
  try { return fs.readFileSync(path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'coexistence.md'), 'utf8').match(/^Mode:\s*(\S+)/m)?.[1] || ''; } catch { return ''; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), write = args.includes('--apply');
  const agent = args.includes('--agent') ? args[args.indexOf('--agent') + 1] : 'claude';
  if (agent === 'opencode') { // a plugin file, not a settings entry
    const file = PLUGIN(), want = pluginText(), have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (have === want) { console.log(`${file}: the Waymark plugin is installed.`); process.exit(0); }
    console.log(`${file}:\n  - ${have === null ? 'add' : 'update'} the Waymark plugin (its four hooks run ${SCRIPTS})`);
    if (!write) { console.log('\nPlan only: nothing was written. Ask the user, then re-run with --apply. Takes effect when OpenCode restarts.'); process.exit(0); }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (have !== null) fs.copyFileSync(file, file + '.waymark-bak');
    fs.writeFileSync(file, want);
    console.log(`installed${have !== null ? ` (backup ${file}.waymark-bak)` : ''}. Restart OpenCode.`);
    process.exit(0);
  }
  if (!SETTINGS[agent]) { console.log(`Agent "${agent}": no adapter yet. Supported: ${Object.keys(SETTINGS).join(', ')}.`); process.exit(1); }
  const mode = coexistMode();
  if (['guest', 'skills-only', 'other-leads'].includes(mode)) { console.log(`Coexistence mode ${mode}: the orchestrator's hooks own the turn; no Waymark hooks are registered.`); process.exit(0); }
  const file = SETTINGS[agent](), raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  let current = {};
  try { current = raw ? JSON.parse(raw) : {}; } catch { console.log(`${file} is not valid JSON: nothing changed. Fix it and re-run.`); process.exit(1); }
  const { settings, steps } = planHooks(current, { agent });
  if (!steps.length) { console.log(`${file}: the four Waymark hooks are registered.`); process.exit(0); }
  console.log(`${file}:\n${steps.map((s) => `  - ${s}`).join('\n')}`);
  if (!write) { console.log('\nPlan only: nothing was written. Ask the user, then re-run with --apply (backup .waymark-bak). Takes effect in the next session.'); process.exit(0); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (raw) fs.copyFileSync(file, file + '.waymark-bak');
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log(`updated${raw ? ` (backup ${file}.waymark-bak)` : ''}. Start a new session.${agent === 'codex' ? ' In Codex, open /hooks and trust the four Waymark hooks: until then Codex skips them.' : ''}`);
}
