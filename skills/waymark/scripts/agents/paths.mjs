// Waymark · where each agent keeps its config: agents.json (docs/adr/0022) gives each agent's folder and the environment
// variable it documents for moving it: CLAUDE_CONFIG_DIR (Claude Code: settings.json, CLAUDE.md, projects/,
// .claude.json), CODEX_HOME, GEMINI_CLI_HOME, XDG_CONFIG_HOME (OpenCode's ~/.config), CURSOR_CONFIG_DIR, KIRO_HOME…
// WAYMARK_AGENTS_HOME stands for the home folder in tests. Folders are evaluated on each call, never at import.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const USER = () => process.env.WAYMARK_AGENTS_HOME || os.homedir();
export const xdgConfig = () => process.env.XDG_CONFIG_HOME || path.join(USER(), '.config');
// Every agent Waymark knows, as agents.json lists them (the order is the order they are reported in).
export const KNOWN = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'agents.json'), 'utf8')).agents;
export const known = (key) => KNOWN.find((a) => a.key === key) || null;
// An entry's folder: its environment variable, else dir with '~/' as the home folder and '$XDG/' as XDG_CONFIG_HOME.
export function agentDir(a) {
  if (a.env && process.env[a.env]) return process.env[a.env];
  const [root, ...rest] = String(a.dir).split('/');
  return path.join(root === '$XDG' ? xdgConfig() : USER(), ...rest);
}
export const claudeDir = () => agentDir(known('claude'));
export const codexHome = () => agentDir(known('codex'));
export const geminiHome = () => agentDir(known('gemini'));
export const opencodeDir = () => agentDir(known('opencode'));
export const cursorDir = () => agentDir(known('cursor'));

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
