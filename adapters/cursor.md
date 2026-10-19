# Adapter · Cursor

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent (cursor.com/docs/skills: Cursor reads `~/.agents/skills`, `~/.cursor/skills` and also `~/.claude/skills`). `~/.cursor/skills` only for a skill the user wants in Cursor alone |
| `<project-skills-dir>` | `.agents/skills` (Cursor also reads `.cursor/skills` and `.claude/skills`) |
| `<instructions-file>` | none: User Rules live in Cursor's settings (Customize → Rules), not in a file. The Rule 0 block comes with the session card (the `sessionStart` hook), so nothing is pasted by hand |
| `<project-instructions-file>` | `AGENTS.md` at the project root (the IDE and the CLI read it; the CLI also reads `CLAUDE.md`) |
| Skill loading | native Agent Skills; reading `<skills-dir>/<name>/SKILL.md` counts as invoking it |
| Restart needed | no: Cursor reloads `hooks.json` when it changes; a new chat gets the card |
| Hooks (Waymark 2.0.3, `docs/adr/0021`) | `~/.cursor/hooks.json` (`CURSOR_CONFIG_DIR` moves it), `"version": 1`: `sessionStart` → `session-hook.mjs`, `beforeSubmitPrompt` → `rule0-hook.mjs`, `preToolUse`, `postToolUse`, `postToolUseFailure` and `afterAgentResponse` → `tool-hook.mjs` (every tool, no matcher), `stop` → `stop-hook.mjs`, each with `--agent cursor`. Written by `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent cursor` (plan, then `--apply`). User hooks need no trust |
| Hook adapter | `skills/waymark/scripts/agents/cursor.mjs`. The transcript's format is not documented, so each hook's event is journaled to `~/.waymark/cursor/<conversation>.jsonl` and read from there. The per-prompt reminder rides on the turn's first tool result (`beforeSubmitPrompt` cannot add context). A missing Cierre is sent back as the `stop` hook's `followup_message`. The choice window is Cursor's ask-questions tool; without it, the options in the chat and your reply count as the decision. Its review is `node <skills-dir>/waymark/scripts/W review <files>`. Built from the documentation (2026-10-12), not yet tried in a live session |

Cursor also runs Claude Code's hooks from `~/.claude/settings.json` (Settings → "Include third-party … configs", on by default). Waymark's Claude Code hooks see that Cursor runs them (`cursor_version` in their input) and do nothing, so the work happens once, in Cursor's own hooks.

## MCP registration

`~/.cursor/mcp.json` (merge, never overwrite other servers):

```json
{
  "mcpServers": {
    "context7": { "url": "https://mcp.context7.com/mcp" },
    "angular-cli": { "command": "npx", "args": ["-y", "@angular/cli", "mcp"] },
    "primeng": { "command": "npx", "args": ["-y", "@primeng/mcp"] }
  }
}
```

## Capability mapping

Claude-only agents (`Explore`, `Plan`) and review skills have no direct equivalent: do the step yourself (search with your tools, write the plan in the chat) and use `W review <files>` for the review.
