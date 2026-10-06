# Adapter · Gemini CLI

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.gemini/skills` (*verify*; fallback `~/.agents/skills`) |
| `<project-skills-dir>` | `.agents/skills` (read with `.gemini/skills`, `.agents` wins; verified at v0.62) |
| `<instructions-file>` | `~/.gemini/GEMINI.md` |
| `<project-instructions-file>` | `GEMINI.md` at the project root |
| Skill loading | native Agent Skills support where available; otherwise via the instructions block |
| Restart needed | yes |

## MCP registration

`~/.gemini/settings.json` → `mcpServers` (merge, never overwrite):

```json
{
  "mcpServers": {
    "context7": { "httpUrl": "https://mcp.context7.com/mcp" },
    "angular-cli": { "command": "npx", "args": ["-y", "@angular/cli", "mcp"] },
    "primeng": { "command": "npx", "args": ["-y", "@primeng/mcp"] }
  }
}
```

## Capability mapping

Claude-only agents and review skills are done manually and noted in the closing report.
