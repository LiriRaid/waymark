// Waymark · the agent a hook runs for (docs/adr/0008): `--agent <name>` on the hook's command line, Claude Code by
// default so installs registered before 2.0 keep working. One module per agent in this folder (same exports as claude.mjs).
import * as claude from './claude.mjs';
import * as codex from './codex.mjs';
import * as gemini from './gemini.mjs';
import * as opencode from './opencode.mjs';

export const AGENTS = { claude, codex, gemini, opencode };

export function agentFrom(argv = process.argv) {
  const i = argv.indexOf('--agent');
  return (i >= 0 && AGENTS[argv[i + 1]]) || claude;
}
