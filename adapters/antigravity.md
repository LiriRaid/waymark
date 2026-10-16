# Adapter · Antigravity

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent. Antigravity reads its own `~/.gemini/config/skills`, so a department is invoked by reading `<skills-dir>/<name>/SKILL.md` with `view_file` |
| `<project-skills-dir>` | `.agents/skills` |
| `<instructions-file>` | `~/.gemini/GEMINI.md`, shared with Gemini CLI (`connect-agents.mjs` writes it once for both) |
| `<project-instructions-file>` | `GEMINI.md` or `AGENTS.md` at the project root |
| Skill loading | reading `<skills-dir>/<name>/SKILL.md` counts as invoking it |
| Restart needed | yes: a new conversation reads the hooks (the CLI lists them with `/hooks`) |
| Hooks (`docs/adr/0022`) | a hook named `waymark` in `~/.gemini/config/hooks.json`, read by Antigravity 2.0, its IDE and its CLI: `SessionStart` → `session-hook.mjs`, `PreInvocation` → `rule0-hook.mjs`, `PreToolUse` and `PostToolUse` (matcher `*`) → `tool-hook.mjs`, `Stop` → `stop-hook.mjs`, each with `--agent antigravity --event <core event>`, since the payload names no event. The session and end-of-turn hooks get a 60 s timeout (30 s by default). The user's own named hooks in the file stay. Written by `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent antigravity` (plan, then `--apply`) (antigravity.google/docs/hooks, checked 2026-10-13) |
| Hook adapter | `skills/waymark/scripts/agents/antigravity.mjs`. The card and the per-prompt reminder go as an `injectSteps` `ephemeralMessage`; the pack goes as the `reason` of `PreToolUse`'s `allow`, since that hook has no context field and `PostToolUse` answers only `{}`; a denial is `decision: "deny"`; `Stop`'s `decision: "continue"` re-enters the loop once. No hook carries the prompt or the reply, and `transcript.jsonl`'s format is not documented, so each hook journals its event in `~/.waymark/antigravity/<conversation>.jsonl` (`agents/journal.mjs`) and that journal is the turn; a `PreInvocation` stands for the prompt with a placeholder text. Without the reply, the routing line and the Cierre (its Evidencia included) are invisible: `cierre` and `evidence` are not applicable, the pre-tool gate lets every change through, and the Aprendido does not reach engram from Antigravity. The choice window is `ask_question`; the hook does not carry its answer, so the record says it was answered. Its review is `node <skills-dir>/waymark/scripts/W review <files>`. Built from the documentation, not yet tried in a live session |

## First live session: what to check

Antigravity had not run with Waymark when the adapter was written. The first time it does, check:

1. `PreInvocation` fires once per prompt (not once per model call), and a `Stop` answered with `continue` does not start a new invocation; otherwise the placeholder prompt splits the turn.
2. The `ephemeralMessage` of `SessionStart` reaches the first answer (the card); if it does not, try `systemMessage`.
3. The `reason` of a `PreToolUse` `allow` reaches the agent (the pack). If it does not, the pack is recorded but not seen.
4. The tool arguments: `run_command` with `CommandLine`, `write_to_file`/`replace_file_content`/`multi_replace_file_content` with `TargetFile`, `view_file` with `AbsolutePath`, `ask_question` with `question` and `options`. `call()` in `agents/antigravity.mjs` takes those.
5. A command that exits non-zero sets `error` in `PostToolUse` (the gates read it as a failure).
6. Run `node <skills-dir>/waymark/scripts/W tasks` after a task: the record must show the agent `antigravity` and the files.

Anything that differs: fix `agents/antigravity.mjs` and its spec (`tests/antigravity.test.mjs`) with the real payload.

## MCP registration

`~/.gemini/antigravity/mcp_config.json` (verify: merge, never overwrite other servers).

## Capability mapping

Claude-only agents (`Explore`, `Plan`) and review skills have no direct equivalent: do the step yourself (search with your tools, or a subagent with `invoke_subagent`; write the plan in the chat) and use `W review <files>` for the review.
