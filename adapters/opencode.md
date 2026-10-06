# Adapter · OpenCode

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.config/opencode/skills` (*verify*; OpenCode can also read `~/.claude/skills`) |
| `<project-skills-dir>` | `.agents/skills` (OpenCode also reads `.claude/skills` and `.opencode/skills`; verified at 1.18.34) |
| `<instructions-file>` | `~/.config/opencode/AGENTS.md` |
| `<project-instructions-file>` | `AGENTS.md` at the project root |
| Skill loading | native `skill` tool where available; otherwise via the instructions block |
| Restart needed | yes |

If the user also uses Claude Code on the same machine and OpenCode already reads `~/.claude/skills`, install once there and do not duplicate.

## MCP registration

`~/.config/opencode/opencode.json` → `mcp` (merge):

```json
{
  "mcp": {
    "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
    "angular-cli": { "type": "local", "command": ["npx", "-y", "@angular/cli", "mcp"] },
    "primeng": { "type": "local", "command": ["npx", "-y", "@primeng/mcp"] }
  }
}
```
