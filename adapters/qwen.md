# Adapter · Qwen Code

Written from the documentation (docs/adr/0041, checked 2026-10-19). Nothing here has run in a live Qwen Code session.

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent. Qwen Code reads its own `~/.qwen/skills` (`SKILL.md` with `name` and `description`), so a department is invoked by reading `<skills-dir>/<name>/SKILL.md` |
| `<project-skills-dir>` | `.agents/skills` |
| `<instructions-file>` | `~/.qwen/QWEN.md` (`QWEN_HOME` moves the folder; the file name is configurable in its settings). `connect-agents.mjs` writes the Rule 0 block there once the hooks run Waymark |
| `<project-instructions-file>` | `QWEN.md` at the project root |
| Skill loading | reading `<skills-dir>/<name>/SKILL.md` counts as invoking it |
| Restart needed | yes: hooks load when a session starts (`/hooks` shows them, read-only) |
| Hooks (`docs/adr/0041`) | `~/.qwen/settings.json` under `"hooks"` (`WAYMARK_QWEN_SETTINGS` overrides the file): `SessionStart` → `session-hook.mjs`, `UserPromptSubmit` → `rule0-hook.mjs`, `PreToolUse` and `PostToolUse` → `tool-hook.mjs` (matcher `run_shell_command\|write_file\|edit\|replace\|read_file`), `Stop` → `stop-hook.mjs`, each through `hook-run.cjs` with `--agent qwen`. User hooks need no approval; project hooks load only in a trusted folder |
| Hook adapter | `skills/waymark/scripts/agents/qwen.mjs`. Claude Code's payload and answers; Waymark journals each event (`~/.waymark/qwen/<session>.jsonl`) because the transcript's format is not described |

## What it does and does not do

- **Does:** the card at the start of a session, the reminder and the task ID with each prompt (`additionalContext`), the pack of a file and the procedures with the first edit (before the tool runs, `PreToolUse` takes `additionalContext`), the sensitive-path guard (a deny before the tool, reads included), the commit trailer, the record of the task (files, gates, commits, tool results) and the end-of-turn hook with `Stop`'s `decision: block`, at most 8 times in a row (`stopHookBlockingCap`).
- **Does not:** judge the Cierre, the evidence or the choice window (`lacks: cierre, evidence, decision`), and the gate before the first change lets it through. `Stop` carries the turn's last message only, with no routing line, and the question tool is not documented. The review is `waymark.mjs review <files>`.

## First live session: what to check

1. `hooks` in `~/.qwen/settings.json` run (`/hooks`), and the card arrives at the start (`SessionStart` plain stdout is also added to the context: Waymark answers JSON).
2. The payload's `tool_name` for a shell command, an edit and a read: the runtime ids (`run_shell_command`, `write_file`, `edit`/`replace`, `read_file`) or the Claude aliases, and the field names of `tool_input` (documented: `command`, `file_path`) and `tool_response` for a result and for a failure (`error`, `exit_code`, `output`). `agents/qwen.mjs` takes both.
3. `UserPromptSubmit`: `prompt` against `submitted_prompt` (the adapter reads `submitted_prompt` first); a `decision: block` must stop the prompt.
4. `PreToolUse` with `permissionDecision: deny` stops the tool and the model reads the reason; with only `additionalContext` the tool runs.
5. `Stop`: whether the `reason` of a `decision: block` reaches the model for a command hook (documented only for prompt hooks), and whether `MessageDisplay` could carry each message and so the routing line (not read).
6. `node <skills-dir>/waymark/scripts/waymark.mjs tasks` after a task: the record must show the agent `qwen` and the files.

Anything that differs: fix `agents/qwen.mjs`, its driver `tests/conformance/agents/qwen.mjs` and the spec `tests/new-adapters.test.mjs` with the real payload.

## MCP registration

Not read for this adapter: find where Qwen Code registers MCP servers in its documentation before writing one (merge, never overwrite other servers).

## Capability mapping

Claude-only agents (`Explore`, `Plan`) and review skills have no direct equivalent: do the step yourself (search with your tools, write the plan in the chat) and use `waymark.mjs review <files>` for the review. The choice window is asked in the chat.
