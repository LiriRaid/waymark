// Waymark · the agent a hook runs for (docs/adr/0008): `--agent <name>` on the hook's command line, Claude Code by
// default so installs registered before 2.0 keep working. One module per agent in this folder (same exports as
// claude.mjs); a new agent costs one module here, its entry in install-hooks.mjs and connect-agents.mjs.
import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import * as cursor from './cursor.mjs';
import * as gemini from './gemini.mjs';
import * as opencode from './opencode.mjs';

export const AGENTS = { claude, codex, cursor, gemini, opencode };

export function agentFrom(argv = process.argv) {
  const i = argv.indexOf('--agent');
  return (i >= 0 && AGENTS[argv[i + 1]]) || claude;
}

// The hook's stdin as the core reads it: the agent's own fields normalized (agent.input, Cursor), or null when this run
// must do nothing: a hook registered for Claude Code (no --agent) that Cursor runs from ~/.claude/settings.json (its
// third-party hooks, on by default: cursor.com/docs/reference/third-party-hooks), while Cursor's own hooks.json runs
// Waymark with --agent cursor. Cursor's own payload says so (cursor_version); an environment variable would not, since
// Claude Code started from Cursor's terminal inherits it. Invalid JSON throws unless `lenient` ({} instead).
export function parseHook(text, agent, { lenient = false, argv = process.argv } = {}) {
  let h;
  try { h = JSON.parse(text || '{}') || {}; } catch (e) { if (!lenient) throw e; h = {}; }
  if (h.waymark_probe) return h;
  if (!argv.includes('--agent') && h.cursor_version) return null;
  return agent.input ? agent.input(h) : h;
}
