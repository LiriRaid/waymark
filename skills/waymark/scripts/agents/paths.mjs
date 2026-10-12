// Waymark · where each agent keeps its config, with the environment variables each one documents for moving it:
// CLAUDE_CONFIG_DIR (Claude Code: settings.json, CLAUDE.md, projects/, .claude.json), CODEX_HOME, GEMINI_CLI_HOME,
// XDG_CONFIG_HOME (OpenCode's ~/.config) and CURSOR_CONFIG_DIR (cursor.com/docs/cli/reference/configuration).
// WAYMARK_AGENTS_HOME stands for the home folder in tests. Evaluated on each call, never at import.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USER = () => process.env.WAYMARK_AGENTS_HOME || os.homedir();
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(USER(), '.claude');
export const codexHome = () => process.env.CODEX_HOME || path.join(USER(), '.codex');
export const geminiHome = () => process.env.GEMINI_CLI_HOME || path.join(USER(), '.gemini');
export const opencodeDir = () => path.join(process.env.XDG_CONFIG_HOME || path.join(USER(), '.config'), 'opencode');
export const cursorDir = () => process.env.CURSOR_CONFIG_DIR || path.join(USER(), '.cursor');

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
// JSON with // and /* */ comments and trailing commas (opencode.jsonc), strings left intact.
export const parseJsonc = (text) => {
  try {
    const bare = String(text).replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s || '').replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(bare);
  } catch { return null; }
};

// The MCP server names registered in every agent on this machine (sync.mjs indexes them).
export function discoverMcp() {
  const names = new Set();
  const add = (o) => { for (const n of Object.keys(o || {})) names.add(n); };
  const claude = readJson(process.env.CLAUDE_CONFIG_DIR ? path.join(claudeDir(), '.claude.json') : path.join(USER(), '.claude.json')) || {};
  add(claude.mcpServers);
  for (const p of Object.values(claude.projects || {})) add(p?.mcpServers);
  add(readJson(path.join(cursorDir(), 'mcp.json'))?.mcpServers);
  add(readJson(path.join(geminiHome(), 'settings.json'))?.mcpServers);
  for (const f of ['opencode.json', 'opencode.jsonc']) add(parseJsonc(readText(path.join(opencodeDir(), f)))?.mcp);
  for (const m of readText(path.join(codexHome(), 'config.toml')).matchAll(/^\[mcp_servers\.("?)([^"\]]+)\1\]/gm)) names.add(m[2]);
  return names;
}
