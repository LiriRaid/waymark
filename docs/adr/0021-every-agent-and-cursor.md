# 0021 · Every agent on the machine with one install, Cursor included

**Status:** accepted (2026-10-12). Every pick below is the user's (2026-10-12 · T11, point 4 of the 2.0.3 plan). It extends `0008` (agent-agnostic core) and `0013` (every agent, one memory).

## Context
- **One install, every agent.** The user's rule is that Waymark installs once, at user level, finds the agents on the machine and works in all of them, and that "¿por dónde voy?" in any agent shows the last task, even one done in another agent. Waymark hooks into the tool, not the model, so Grok in Cursor or GPT in Codex are covered by their tool.
- **Cursor** (cursor.com/docs/hooks, checked 2026-10-12) has user hooks in `~/.cursor/hooks.json` with no trust step, but differs from Claude Code in four ways that matter:
  - `beforeSubmitPrompt` cannot add context.
  - The transcript's format is not documented (`transcript_path` may be null).
  - User Rules live in its settings, not in a file.
  - It also runs Claude Code's hooks from `~/.claude/settings.json` by default.
- Cursor is not installed on the machine where this was built.
- **Gaps elsewhere.** `check` offered only `connect-agents`, never `install-hooks`, and missed a Claude Code without hooks. The plugin prefix `waymark:dept-*` was not read as a department. `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `CURSOR_CONFIG_DIR` and macOS's `$TMPDIR` were ignored. Uninstalling left the status line, the OpenCode plugin and the fit rules behind.

## Decision
- **Cursor adapter from the documentation** (`scripts/agents/cursor.mjs`). Its spec feeds the documented payloads; there is no live test until the user installs Cursor, the same as Gemini CLI.
- **A journal of the hooks, not the transcript.** Every Cursor hook event is appended to `~/.waymark/cursor/<conversation>.jsonl`: the prompt, the reply's text (`afterAgentResponse`), each tool call with its result or failure (`preToolUse`, `postToolUse`, `postToolUseFailure`). `read()` turns that journal into the core's lines, as OpenCode's dump does. `preToolUse` and `postToolUse` take every tool, because reads and questions are evidence too.
- **The reminder rides on the first tool.** `beforeSubmitPrompt` keeps the per-prompt reminder, and the turn's first `postToolUse` hands it over as `additional_context`, once per prompt. A turn with no tools gets only the card.
- **The card brings Rule 0.** With no instructions file, Cursor's `sessionStart` puts the instructions block before the card, outside the card's cap.
- **Claude Code's hooks step aside in Cursor.** A hook registered without `--agent` whose input carries `cursor_version` does nothing (`agents/index.mjs` `parseHook`). Cursor's own hooks, with `--agent cursor`, do the work once. The environment variable `CURSOR_VERSION` is not used: Claude Code started from Cursor's terminal would inherit it and silence its own hooks.
- **Answers Cursor reads.**
  - A deny is `permission: deny` plus `agent_message`.
  - A missing Cierre is `stop`'s `followup_message`, and `loop_count > 0` counts as already blocked.
  - No decision is `{}`, never `permission: allow`, which would skip Cursor's own approval.
- **Unknown agents** get the pointer block only. The block's "hooks installed but no card" alarm applies only where hooks are installed. A new agent costs one module in `scripts/agents/` plus its entries in `install-hooks.mjs` and `connect-agents.mjs`.
- **`check`** names every agent found without Waymark's hooks (Claude Code when its folder exists) and offers `install-hooks --agent <agent>`. It names nothing in guest, skills-only or other-leads modes.
- **Paths** come from one module (`scripts/agents/paths.mjs`), read on each call. Backups go to `~/.waymark-backups`. A project skill versioned in git under `.claude/skills` stays there, and `check` says so.
- **Uninstall is a script** (`uninstall.mjs`): a plan first, then `--apply` with a backup of each file. It removes the hooks of every agent, Claude Code's status line (giving back the user's own), the OpenCode plugin and the marked blocks. It then runs `skill-fit --restore` and `mcp-fit --restore`. Skills, `~/.waymark` and the MCP servers stay for the user to decide.

## Consequences
- In Cursor a reply's text arrives when the message ends, after its tool calls. So the decision gate before an edit sees the routing line only from a reply that already ended; the end-of-turn hook sees the whole turn.
- Shell exit codes are not documented in Cursor's payloads. A failure counts when Cursor reports `postToolUseFailure` or the output names a non-zero exit code.
- The ask-questions tool's internal name is not documented. Names like `AskQuestion` are read as the choice window. Otherwise the question that ended a reply, with options, plus the next prompt counts, as in Codex.
- Hooks run on Windows through Cursor's wrapper, which has open bugs with Git Bash as the default terminal (forum reports). The commands are plain `node "<path>" --agent cursor`.
- Every unconfirmed point above is checked on the first live session in Cursor (`adapters/cursor.md`).
