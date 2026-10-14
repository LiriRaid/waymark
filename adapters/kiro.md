# Adapter · Kiro

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent. Kiro reads its own `~/.kiro/skills`, so a department is invoked by reading `<skills-dir>/<name>/SKILL.md` |
| `<project-skills-dir>` | `.agents/skills` |
| `<instructions-file>` | `~/.kiro/steering/AGENTS.md` (`KIRO_HOME` moves the folder). `connect-agents.mjs` writes the Rule 0 block there once the hooks run Waymark |
| `<project-instructions-file>` | `AGENTS.md` at the project root, or `.kiro/steering/` |
| Skill loading | reading `<skills-dir>/<name>/SKILL.md` counts as invoking it |
| Restart needed | yes: hooks activate when a session starts |
| Hooks (`docs/adr/0022`) | `~/.kiro/hooks/waymark.json`, `{"version": "v1", "hooks": [{name, trigger, action: {type: "command", command}}]}`: `SessionStart` → `session-hook.mjs`, `UserPromptSubmit` → `rule0-hook.mjs`, `PreToolUse` and `PostToolUse` → `tool-hook.mjs` (no matcher: every tool, reads included), `Stop` → `stop-hook.mjs`, each with `--agent kiro --event <event>`. Written by `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent kiro` (plan, then `--apply`). Global hooks (`~/.kiro/hooks/`) are documented for Kiro CLI V3; the IDE documents only the workspace's `.kiro/hooks` (kiro.dev/docs/hooks, /docs/hooks/types, /docs/hooks/actions, /docs/cli/v3/hooks-migration, /docs/ide/whats-new-v1/hooks, checked 2026-10-13) |
| Hook adapter | `skills/waymark/scripts/agents/kiro.mjs`. Kiro reads plain text, not JSON: exit 0 adds stdout to the context (the card, the per-prompt reminder, the pack with the first edit's result), exit 2 with stderr blocks a tool call, and `Stop` asks for another turn with `{"decision": "block", "reason"}` (`emit()`, through `answer()` in `agents/index.mjs`). Blocking a prompt is documented both ways, so there is no prompt brake. No hook carries the reply and the session files are not documented, so each hook journals its event in `~/.waymark/kiro/<session>.jsonl` (`agents/journal.mjs`) and that journal is the turn. Without the reply, the routing line, the Cierre (its Evidencia included) and a question asked in the chat are invisible: `cierre`, `evidence` and `decision` are not applicable, the pre-tool gate lets every change through, and the Aprendido does not reach engram from Kiro. The gates, review, build, spec, secrets, procedure and memory come from the tool calls. Its review is `node <skills-dir>/waymark/scripts/waymark.mjs review <files>`. Built from the documentation, not yet tried in a live session |

## First live session: what to check

Kiro had not run with Waymark when the adapter was written. The first time it does, check:

1. The global file is read: Kiro CLI V3 runs `~/.kiro/hooks/waymark.json`; in the IDE, see whether it runs too or the hooks need the workspace's `.kiro/hooks`.
2. The card arrives at the start and the reminder with each prompt (exit 0 → stdout in the context), and `prompt` comes in the payload (the IDE documents `USER_PROMPT`).
3. The tool names and inputs: `execute_bash`/`shell` with `command`, `fs_write` with `path` (V2 names), and what the V3 engine and the IDE send. `call()` and the regexes in `agents/kiro.mjs` take those.
4. `PostToolUse`'s field for the result (`tool_response` is assumed) and how a failed command shows (`exit_status`).
5. Exit 2 from `PreToolUse` blocks the call and the agent reads stderr; a `Stop` blocked once asks for one more turn, and the next stop goes through.
6. Run `node <skills-dir>/waymark/scripts/waymark.mjs tasks` after a task: the record must show the agent `kiro` and the files.

Anything that differs: fix `agents/kiro.mjs` and its spec (`tests/kiro.test.mjs`) with the real payload.

## MCP registration

`~/.kiro/settings/mcp.json` (verify: merge, never overwrite other servers).

## Capability mapping

Claude-only agents (`Explore`, `Plan`) and review skills have no direct equivalent: do the step yourself (search with your tools, write the plan in the chat) and use `waymark.mjs review <files>` for the review. The choice window is the options in the chat; the user's reply is the decision.
