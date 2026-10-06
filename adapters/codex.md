# Adapter · OpenAI Codex CLI

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent (verified, codex-rs `host_roots.rs`, 0.160.1: `$CODEX_HOME/skills` deprecated, then `~/.agents/skills`; directory links followed). `~/.codex/skills` only for a skill the user wants in Codex alone |
| `<project-skills-dir>` | `.agents/skills` (verified, codex-rs `host_roots.rs`, 0.160) |
| `<instructions-file>` | `~/.codex/AGENTS.md` |
| `<project-instructions-file>` | `AGENTS.md` at the project root |
| Skill loading | native Agent Skills support (*verify* in the docs); otherwise read `SKILL.md` as the instructions block says |
| Restart needed | yes |
| Hooks (Waymark 2.0, `docs/adr/0009`) | `~/.codex/hooks.json`: the same four scripts as Claude Code with `--agent codex` (`SessionStart`, `UserPromptSubmit`, `PreToolUse` matcher `Bash|apply_patch`, `Stop`), written by `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent codex` (dry run, then `--apply`). Codex skips a new or changed hook until you trust it in `/hooks`. One install serves both agents: the hooks point at the Claude Code copy of the skills. |
| Hook adapter | `skills/waymark/scripts/agents/codex.mjs`. It reads the rollout's `item_completed` events. Reading `<skills-dir>/<skill>/SKILL.md` counts as invoking the skill. The choice window is `request_user_input` (Plan mode); otherwise a question that ends the turn plus your reply counts as the decision. Its review is `node <skills-dir>/waymark/scripts/waymark.mjs review <files>` (diff + checklist). Checked on codex-cli 0.160. |

## MCP registration

Add to `~/.codex/config.toml` (or use `codex mcp add` if available). Merge, never overwrite other servers:

```toml
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"

[mcp_servers.angular-cli]
command = "npx"
args = ["-y", "@angular/cli", "mcp"]

[mcp_servers.primeng]
command = "npx"
args = ["-y", "@primeng/mcp"]
```

## Capability mapping

Claude-only names in the registry (`Explore`, `Plan`, `code-review`, `simplify`, `security-review`, `update-config`) have no direct equivalent: do the step yourself (search with your tools, write the plan in the chat, review the diff) and note it in the closing report.
