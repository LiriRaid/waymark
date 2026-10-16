# Adapter · Copilot CLI

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent (`agents.json`: Copilot CLI reads it) |
| `<project-skills-dir>` | `.agents/skills` |
| `<instructions-file>` | `~/.copilot/copilot-instructions.md` (`COPILOT_HOME` moves the folder). `connect-agents.mjs` writes the Rule 0 block there once the hooks run Waymark |
| `<project-instructions-file>` | `AGENTS.md` at the project root, or `.github/copilot-instructions.md` |
| Skill loading | its skill tool; reading `<skills-dir>/<name>/SKILL.md` counts as invoking it too |
| Restart needed | yes: a new session reads the hooks |
| Hooks (`docs/adr/0022`) | `~/.copilot/hooks/waymark.json`, `"version": 1`, flat entries under Claude Code's event names, so the payload is Claude's (`session_id`, `tool_name` as `Bash`/`Edit`/`Write`, `tool_input`): `SessionStart` → `session-hook.mjs`, `UserPromptSubmit` → `rule0-hook.mjs`, `PreToolUse` and `PostToolUse` → `tool-hook.mjs` (shell and edit tools), `Stop` → `stop-hook.mjs`, each with `--agent copilot`. Written by `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent copilot` (plan, then `--apply`). User hooks need no trust; only repository hooks need workspace admission (docs.github.com/en/copilot/reference/hooks-reference, checked 2026-10-13) |
| Hook adapter | `skills/waymark/scripts/agents/copilot.mjs`. The turn is read from `~/.copilot/session-state/<session>/events.jsonl` (not officially documented; github/copilot-cli#3551 describes it). A command hook's `UserPromptSubmit` output is dropped, so there is no per-prompt reminder and no prompt brake: the card and the Rule 0 block in `copilot-instructions.md` carry the routine, and the end-of-turn hook computes the task ID. The pack of a file arrives with its first edit's result (`PostToolUse`). A missing Cierre blocks the stop (`decision: "block"`; its reason is the next prompt). The choice window is `ask_user`; without it, the options in the chat and your reply count as the decision. Its review is `node <skills-dir>/waymark/scripts/W review <files>`. Built from the documentation, not yet tried in a live session |

## First live session: what to check

Copilot CLI was not installed when the adapter was written. The first time it runs with Waymark, check:

1. The card arrives at the start (`SessionStart` → `additionalContext`).
2. `PreToolUse` reports `tool_name` as `Bash`/`Edit`/`Write`, and the matcher catches the shell and edit tools (on Windows, `powershell`).
3. `events.jsonl` holds `user.message`, `assistant.message` (`data.content`), `tool.execution_start` (`toolCallId`, `toolName`, `arguments`) and `tool.execution_complete` (`success`, `result.content`). Run `node <skills-dir>/waymark/scripts/W tasks` after a task: the record must show the routing line and the files.
4. `ask_user`'s arguments (`question`, `choices`) and its result name the chosen option.
5. A turn with a change and no Cierre is blocked once, and the next one closes it.

Anything that differs: fix `agents/copilot.mjs` and its spec (`tests/copilot.test.mjs`) with the real payload.

## MCP registration

`~/.copilot/mcp-config.json` (verify: merge, never overwrite other servers).

## Capability mapping

Claude-only agents (`Explore`, `Plan`) and review skills have no direct equivalent: do the step yourself (search with your tools, write the plan in the chat) and use `W review <files>` for the review.
