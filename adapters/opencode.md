# Adapter · OpenCode

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent (verified, `src/skill/index.ts`, 1.18.35: it reads `~/.claude/skills`, `~/.agents/skills`, `~/.config/opencode/skills`, links followed; one skill seen twice only logs `duplicate skill name`). `~/.config/opencode/skills` only for a skill the user wants in OpenCode alone |
| `<project-skills-dir>` | `.agents/skills` (OpenCode also reads `.claude/skills` and `.opencode/skills`; verified at 1.18.34) |
| `<instructions-file>` | `~/.config/opencode/AGENTS.md` |
| `<project-instructions-file>` | `AGENTS.md` at the project root |
| Skill loading | native `skill` tool where available; otherwise via the instructions block |
| Restart needed | yes |

Waymark's skills live once in `~/.agents/skills` (`docs/adr/0017`); OpenCode also sees Claude Code's links to them in `~/.claude/skills`, which only logs the duplicate.

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
