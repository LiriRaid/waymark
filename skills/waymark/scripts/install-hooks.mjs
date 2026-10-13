#!/usr/bin/env node
// Waymark · registers the four hooks of the chain in the agent's settings (docs/adr/0008), instead of a manual merge.
// Usage: node install-hooks.mjs [--apply] [--agent claude]   (shows the plan by default; --apply after the user's yes)
// Claude Code: ~/.claude/settings.json (CLAUDE_CONFIG_DIR, WAYMARK_CLAUDE_SETTINGS overrides it). Only Waymark's own entries (a command that
// runs waymark/scripts/<hook>.mjs) are added, updated (path, matcher) or de-duplicated; every other key and hook stays,
// and new entries go after the existing ones. A file that is not valid JSON is never written; a backup .waymark-bak is
// made first. Coexistence mode guest or skills-only (~/.waymark/coexistence.md) → no hooks at all. Claude Code also gets
// the status line (planStatusLine), which measures each task's quota %.
// Each agent's file, format (nested or flat), event names, matcher and extra events come from agents/agents.json
// (docs/adr/0022); an agent listed there without an adapter gets no hooks until one is written (dept-devex procedures).
// Codex (`--agent codex`): ~/.codex/hooks.json (CODEX_HOME, WAYMARK_CODEX_HOOKS overrides it), the same four scripts with
// `--agent codex`, PreToolUse matcher "Bash|apply_patch", commandWindows = command. Codex skips a new or changed hook until
// the user trusts it in /hooks (learn.chatgpt.com/docs/hooks): say so after --apply.
// Gemini CLI (`--agent gemini`): ~/.gemini/settings.json (GEMINI_CLI_HOME, WAYMARK_GEMINI_SETTINGS overrides it), its own
// event names (BeforeAgent, BeforeTool, AfterAgent), BeforeTool matcher "run_shell_command|write_file|replace".
// OpenCode (`--agent opencode`): no command hooks; agents/opencode-plugin.js is copied to
// ~/.config/opencode/plugins/waymark.js (XDG_CONFIG_HOME, WAYMARK_OPENCODE_PLUGIN overrides it) with this scripts folder
// in place.
// Cursor (`--agent cursor`, docs/adr/0021): ~/.cursor/hooks.json (CURSOR_CONFIG_DIR, WAYMARK_CURSOR_HOOKS overrides it),
// `"version": 1` and flat entries ({command}) per event (cursor.com/docs/hooks). preToolUse and postToolUse take every
// tool (no matcher): the adapter journals each call, reads and questions included (agents/cursor.mjs). User hooks need no
// trust and reload when the file is saved.
// Copilot CLI (`--agent copilot`, docs/adr/0022): ~/.copilot/hooks/waymark.json (COPILOT_HOME, WAYMARK_COPILOT_HOOKS overrides
// it), `"version": 1` and flat entries under Claude Code's event names, which give Claude's payload (agents/copilot.mjs).
// User hooks need no trust (docs.github.com/en/copilot/reference/hooks-reference).
// Kiro (`--agent kiro`): ~/.kiro/hooks/waymark.json (KIRO_HOME, WAYMARK_KIRO_HOOKS overrides it), {"version": "v1", "hooks":
// [{name, trigger, action}]}, no matcher (agents/kiro.mjs journals every tool). Global hooks are documented for its CLI V3.
// Antigravity (`--agent antigravity`): a hook named "waymark" in ~/.gemini/config/hooks.json (WAYMARK_ANTIGRAVITY_HOOKS
// overrides it), the user's named hooks kept; its prompt event is PreInvocation (agents/antigravity.mjs). Both run each
// script with `--event <core event>` (OWN below).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN, known, agentDir } from './agents/paths.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
export const HOOKS = [
  { event: 'SessionStart', file: 'session-hook.mjs' },
  { event: 'UserPromptSubmit', file: 'rule0-hook.mjs' },
  { event: 'PreToolUse', file: 'tool-hook.mjs', matcher: true }, // the agent's tools: hooks.matcher in agents.json
  { event: 'Stop', file: 'stop-hook.mjs' },
  // only for the agents whose hooks.extra names them (agents.json):
  { event: 'PostToolUse', file: 'tool-hook.mjs', matcher: true, extra: true }, // the pack after the first edit where the pre-tool hook cannot add context
  { event: 'PostToolUseFailure', file: 'tool-hook.mjs', extra: true }, // Cursor: a failed tool (its error) for the journal
  { event: 'AfterAgentResponse', file: 'tool-hook.mjs', extra: true }, // Cursor: the reply's text for the journal
];
// The agents whose hooks Waymark writes: an adapter module and a hooks file in agents.json (a plugin is PLUGIN).
const hooksOf = (agent) => { const a = known(agent); return a?.adapter && a.hooks ? a.hooks : null; };
const SETTINGS = Object.fromEntries(KNOWN.filter((a) => a.adapter && a.hooks && a.hooks.format !== 'plugin')
  .map((a) => [a.key, () => process.env[a.hooks.override] || path.join(agentDir(a), a.hooks.file)]));
export const settingsFile = (agent) => SETTINGS[agent]?.() || null;
export const PLUGIN = () => { const a = known('opencode'); return process.env[a.hooks.override] || path.join(agentDir(a), a.hooks.file); };
const ours = (file) => (h) => new RegExp(`waymark[\\\\/]+scripts[\\\\/]+${file.replace('.', '\\.')}`).test(String(h?.command || ''));

// Agents whose hooks file has its own shape (agents.json format "own"). commands(s) → [event, command] of Waymark's
// entries; put(s, want) rebuilds them in place, after the user's hooks, which stay; strip(s) → { next, removed, empty }
// (empty: nothing but Waymark's was in the file). Their commands carry `--event <core event>`: the payload may not name it.
const OURS_ANY = (c) => /waymark[\\/]+scripts[\\/]+[\w-]+-hook\.mjs/.test(String(c || ''));
const handlers = (list) => (Array.isArray(list) ? list : []).flatMap((e) => (Array.isArray(e?.hooks) ? e.hooks : [e]));
const OWN = {
  // Kiro (kiro.dev/docs/hooks): {"version": "v1", "hooks": [{name, trigger, matcher?, action: {type: "command", command}}]}
  kiro: {
    commands: (s) => (Array.isArray(s.hooks) ? s.hooks : []).filter((h) => OURS_ANY(h?.action?.command)).map((h) => [h.trigger, h.action.command]),
    put: (s, want) => {
      s.version ??= 'v1';
      s.hooks = [...(Array.isArray(s.hooks) ? s.hooks : []).filter((h) => !OURS_ANY(h?.action?.command)),
        ...want.map((w) => ({ name: `waymark-${w.event}`, trigger: w.event, action: { type: 'command', command: w.command } }))];
    },
    strip: (s) => {
      const all = Array.isArray(s.hooks) ? s.hooks : [], kept = all.filter((h) => !OURS_ANY(h?.action?.command));
      return { next: { ...s, hooks: kept }, removed: all.length - kept.length, empty: !kept.length && Object.keys(s).every((k) => ['version', 'hooks'].includes(k)) };
    },
  },
  // Antigravity (antigravity.google/docs/hooks): {"<hook name>": {enabled?, SessionStart: [handler], PreInvocation: […],
  // PreToolUse: [{matcher, hooks: [handler]}], PostToolUse: […], Stop: […]}}, handler {type: "command", command, timeout?}
  // (30 s by default: the session and end-of-turn hooks get 60). Waymark's hook is "waymark".
  antigravity: {
    commands: (s) => Object.entries(s.waymark || {}).flatMap(([event, list]) => handlers(list).filter((h) => OURS_ANY(h?.command)).map((h) => [event, h.command])),
    put: (s, want) => {
      const { next } = OWN.antigravity.strip(s), enabled = s.waymark?.enabled; // Waymark's handlers anywhere else in the file go too
      for (const k of Object.keys(s)) delete s[k];
      Object.assign(s, next, { waymark: { ...(enabled !== undefined ? { enabled } : {}), ...Object.fromEntries(want.map((w) => {
        const handler = { type: 'command', command: w.command, ...(/^(SessionStart|Stop)$/.test(w.event) ? { timeout: 60 } : {}) };
        return [w.event, /ToolUse$/.test(w.event) ? [{ matcher: '*', hooks: [handler] }] : [handler]];
      })) } });
    },
    strip: (s) => {
      const next = structuredClone(s);
      let removed = 0;
      for (const [name, hook] of Object.entries(next)) {
        if (!hook || typeof hook !== 'object') continue;
        const had = removed;
        for (const [event, list] of Object.entries(hook)) {
          if (!Array.isArray(list)) continue;
          const kept = list.map((e) => {
            if (Array.isArray(e?.hooks)) { const hs = e.hooks.filter((h) => !OURS_ANY(h?.command)); removed += e.hooks.length - hs.length; return hs.length ? { ...e, hooks: hs } : null; }
            if (OURS_ANY(e?.command)) { removed++; return null; }
            return e;
          }).filter(Boolean);
          if (kept.length) hook[event] = kept; else delete hook[event];
        }
        if (removed > had && !Object.values(hook).some(Array.isArray)) delete next[name]; // only a hook Waymark emptied
      }
      return { next, removed, empty: !Object.keys(next).length };
    },
  },
};
export const withoutOwn = (agent, s) => OWN[agent].strip(s || {});

function planOwn(input, { scripts, agent, spec }) {
  const s = structuredClone(input || {}), own = OWN[agent];
  const want = HOOKS.filter((x) => !x.extra || spec.extra?.includes(x.event))
    .map((h) => ({ event: spec.events?.[h.event] || h.event, file: h.file, command: `node "${scripts}/${h.file}" --agent ${agent} --event ${h.event}` }));
  const before = own.commands(s);
  own.put(s, want);
  if (JSON.stringify(s) === JSON.stringify(input || {})) return { settings: s, steps: [] };
  const steps = want.filter((w) => !before.some(([e, c]) => e === w.event && c === w.command))
    .map((w) => `${before.some(([e]) => e === w.event) ? 'update' : 'add'} ${w.event} → ${w.file}`);
  if (before.length > want.length) steps.push(`remove ${before.length - want.length} duplicate Waymark hook${before.length - want.length > 1 ? 's' : ''}`);
  if (!steps.length) steps.push('update the Waymark hooks\' entries');
  return { settings: s, steps };
}

// → { settings, steps } without touching the input: the settings with the four hooks in place and what changed.
export function planHooks(input, { scripts = SCRIPTS, agent = 'claude' } = {}) {
  const spec = hooksOf(agent) || hooksOf('claude'), flat = spec.format === 'flat'; // flat: an entry is the hook itself ({command, matcher?}), not {matcher, hooks: [...]}
  if (spec.format === 'own') return planOwn(input, { scripts, agent, spec });
  const s = structuredClone(input || {}), steps = [];
  if (flat) s.version ??= 1;
  s.hooks = s.hooks || {};
  const inner = (e) => (flat ? [e] : e.hooks || []);
  for (const h of HOOKS.filter((x) => !x.extra || spec.extra?.includes(x.event))) {
    const command = `node "${scripts}/${h.file}"${agent === 'claude' ? '' : ` --agent ${agent}`}`;
    const matcher = h.matcher ? (spec.matcher ?? null) : null; // null: every tool
    const windows = spec.commandWindows ? { commandWindows: command } : {}; // Codex's Windows override, the same command
    const event = spec.events?.[h.event] || h.event; // the core's event names → the agent's
    const list = (s.hooks[event] = Array.isArray(s.hooks[event]) ? s.hooks[event] : []);
    const hits = list.filter((e) => inner(e).some(ours(h.file)));
    if (!hits.length) {
      list.push(flat ? { command, ...(matcher ? { matcher } : {}) } : { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, ...windows }] });
      steps.push(`add ${event} → ${h.file}`);
      continue;
    }
    const [keep, ...extra] = hits;
    const mine = inner(keep).find(ours(h.file));
    if (mine.command !== command) { steps.push(`update ${event} command: ${mine.command} → ${command}`); mine.command = command; }
    if (windows.commandWindows && mine.commandWindows !== command) { steps.push(`update ${event} commandWindows → ${command}`); mine.commandWindows = command; }
    if (matcher && keep.matcher !== matcher && inner(keep).every(ours(h.file))) { steps.push(`update ${event} matcher: ${keep.matcher || '(none)'} → ${matcher}`); keep.matcher = matcher; }
    if (flat && !matcher && keep.matcher) { steps.push(`update ${event} matcher: ${keep.matcher} → (every tool)`); delete keep.matcher; }
    for (const e of extra) { // a second Waymark entry for the same hook runs it twice: drop it (or just our hook from a shared entry)
      if (!flat) e.hooks = e.hooks.filter((x) => !ours(h.file)(x));
      steps.push(`remove duplicate ${event} → ${h.file}`);
    }
    s.hooks[event] = list.filter((e) => (flat ? !extra.includes(e) : (e.hooks || []).length));
  }
  return { settings: s, steps };
}

// Claude Code's status line (statusline.mjs): it shows the quota and context and measures each task's %. A status line
// the user already has is not lost: `next` is its command, kept in ~/.waymark/statusline.json and run after Waymark's.
// → { settings, steps, next } without touching the input.
const REFRESH = 30; // seconds: Claude Code's statusLine.refreshInterval (code.claude.com/docs/en/statusline)
const oursLine = (c) => /waymark[\\/]+scripts[\\/]+statusline\.mjs/.test(String(c || ''));
export function planStatusLine(input, { scripts = SCRIPTS } = {}) {
  const s = structuredClone(input || {}), command = `node "${scripts}/statusline.mjs"`, have = s.statusLine?.command;
  // every 30 s too, so a quiet terminal shows what the other sessions spent (docs/adr/0019, shares per session)
  if (have === command && s.statusLine.refreshInterval === REFRESH) return { settings: s, steps: [], next: null };
  const next = have && !oursLine(have) ? have : null;
  s.statusLine = { type: 'command', command, refreshInterval: REFRESH };
  const steps = [!have ? 'add statusLine → statusline.mjs (5h · esta sesión · 7d · contexto; measures each task\'s %)'
    : next ? `statusLine → statusline.mjs; yours (${next}) runs after it`
      : have === command ? `statusLine: refreshInterval ${REFRESH} s (a quiet terminal shows the other sessions' use)` : `update statusLine command: ${have} → ${command}`];
  return { settings: s, steps, next };
}

// The plugin as installed: the template with this scripts folder in place.
export const pluginText = (scripts = SCRIPTS) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'agents', 'opencode-plugin.js'), 'utf8').replace("'__SCRIPTS__'", JSON.stringify(scripts));

// The Waymark hook commands each agent has registered: { agent, file, commands[] } for every settings file (or the
// OpenCode plugin) that names one; an entry holds its hooks (Claude Code, Codex, Gemini) or is one (Cursor). → [] when no agent has them.
export function registered() {
  const out = [];
  for (const [agent, at] of Object.entries(SETTINGS)) {
    const file = at();
    let s = null;
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    const all = OWN[agent] ? OWN[agent].commands(s || {}).map(([, c]) => c) : Object.values(s?.hooks || {}).flat().flatMap((e) => (e?.hooks || [e]).map((h) => String(h?.command || '')));
    const commands = [...new Set(all.filter((c) => /waymark[\\/]+scripts[\\/]+[\w-]+-hook\.mjs/.test(c)))];
    if (commands.length) out.push({ agent, file, commands });
  }
  try {
    const file = PLUGIN(), text = fs.readFileSync(file, 'utf8'), scripts = text.match(/const SCRIPTS = "([^"]+)"/)?.[1];
    if (scripts) out.push({ agent: 'opencode', file, commands: ['session-hook.mjs', 'rule0-hook.mjs', 'tool-hook.mjs', 'stop-hook.mjs'].map((f) => `node "${scripts}/${f}" --agent opencode`) });
  } catch {}
  return out;
}

function coexistMode() {
  try { return fs.readFileSync(path.join(process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark'), 'coexistence.md'), 'utf8').match(/^Mode:\s*(\S+)/m)?.[1] || ''; } catch { return ''; }
}

if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
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
  if (!SETTINGS[agent]) {
    const a = known(agent);
    console.log(`Agent "${agent}"${a ? ` (${a.name})` : ''}: no adapter yet. Supported: ${[...Object.keys(SETTINGS), 'opencode'].join(', ')}.${a?.hooks ? ` Its hooks: ${a.docs}.` : ''} To write one, with the user's yes: dept-devex procedures → Add an agent (templates/agent-adapter.template.mjs).`);
    process.exit(1);
  }
  const mode = coexistMode();
  if (['guest', 'skills-only', 'other-leads'].includes(mode)) { console.log(`Coexistence mode ${mode}: the orchestrator's hooks own the turn; no Waymark hooks are registered.`); process.exit(0); }
  const file = SETTINGS[agent](), raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  let current = {};
  try { current = raw ? JSON.parse(raw) : {}; } catch { console.log(`${file} is not valid JSON: nothing changed. Fix it and re-run.`); process.exit(1); }
  const hooks = planHooks(current, { agent });
  const line = agent === 'claude' ? planStatusLine(hooks.settings) : { settings: hooks.settings, steps: [], next: null };
  const { settings } = line, steps = [...hooks.steps, ...line.steps];
  if (!steps.length) { console.log(`${file}: the four Waymark hooks${agent === 'claude' ? ' and the status line' : ''} are registered.`); process.exit(0); }
  console.log(`${file}:\n${steps.map((s) => `  - ${s}`).join('\n')}`);
  if (!write) { console.log('\nPlan only: nothing was written. Ask the user, then re-run with --apply (backup .waymark-bak). Takes effect in the next session.'); process.exit(0); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (raw) fs.copyFileSync(file, file + '.waymark-bak');
  if (line.next) { // the user's status line keeps running, after Waymark's
    const home = process.env.WAYMARK_HOME || path.join(os.homedir(), '.waymark');
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'statusline.json'), JSON.stringify({ next: line.next }, null, 1) + '\n');
  }
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  console.log(`updated${raw ? ` (backup ${file}.waymark-bak)` : ''}. ${agent === 'cursor' ? 'Cursor reloads hooks.json when it changes; user hooks need no trust.' : 'Start a new session.'}${agent === 'codex' ? ' In Codex, open /hooks and trust the four Waymark hooks: until then Codex skips them.' : ''}`);
}
