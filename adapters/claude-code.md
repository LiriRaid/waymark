# Adapter · Claude Code

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.claude/skills` |
| `<project-skills-dir>` | `.agents/skills`, mirrored to `.claude/skills` (the only one Claude Code reads) by the session hook (`docs/adr/0016`) |
| `<instructions-file>` | `~/.claude/CLAUDE.md` |
| `<project-instructions-file>` | `CLAUDE.md` at the project root |
| Skill loading | native (`Skill` tool, triggered by each skill's `description`) |
| Hooks | `~/.claude/settings.json`: `UserPromptSubmit` → `rule0-hook.mjs`, `SessionStart` → `session-hook.mjs`, `PreToolUse` (matcher `Bash|PowerShell|Edit|Write|NotebookEdit`) → `tool-hook.mjs`, `Stop` → `stop-hook.mjs`, written by `install-hooks.mjs` (INSTALL §7.2) |
| Hook adapter | `skills/waymark/scripts/agents/claude.mjs` (the default; `docs/adr/0008`): transcript reader, pre-tool input, output shapes, `~/.claude/CLAUDE.md`, `~/.claude/projects/<cwd>` |
| Restart needed | yes, start a new session after installing |

## MCP registration (user scope)

```bash
claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp
claude mcp add --scope user angular-cli -- npx -y @angular/cli mcp
claude mcp add --scope user primeng -- npx -y @primeng/mcp
claude mcp add --scope user engram -- <path-to-engram-binary> mcp --tools=agent
```

Check what is already registered with `claude mcp list`.

## Claude-only capabilities referenced by departments

These exist natively in Claude Code: `Explore` / `Plan` / `general-purpose` agents, `code-review`, `simplify`, `security-review`, `init`, `update-config`, `claude-code-guide`, `skill-creator`. Nothing to install.

## Alternative: plugin

The repository also contains `.claude-plugin/`. `/plugin marketplace add LiriRaid/waymark` then `/plugin install waymark@waymark` installs the skills with a `waymark:` prefix. Use the plugin **or** the copy install, never both (every skill would appear twice). The private layer and instructions block (INSTALL §6) are still required. Not tested yet.
