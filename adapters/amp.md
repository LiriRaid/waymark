# Adapter · Amp

Written from the documentation (docs/adr/0041, checked 2026-10-19). Nothing here has run in a live Amp session.

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent: Amp reads `~/.agents/skills` (and `~/.config/amp/skills`, `~/.claude/skills`), so a department is invoked by reading `<skills-dir>/<name>/SKILL.md` |
| `<project-skills-dir>` | `.agents/skills` |
| `<instructions-file>` | `~/.config/amp/AGENTS.md` (always included when it exists). `connect-agents.mjs` writes the Rule 0 block there once the plugin runs Waymark |
| `<project-instructions-file>` | `AGENTS.md` at the project root |
| Skill loading | reading `<skills-dir>/<name>/SKILL.md` counts as invoking it |
| Restart needed | no restart is documented: ask Amp to reload plugins (`Ctrl+O`, `plugins: reload`); `amp plugins list` shows what loaded |
| Hooks (`docs/adr/0041`) | a plugin, `~/.config/amp/plugins/waymark.js` (`XDG_CONFIG_HOME` moves `plugins/`; `WAYMARK_AMP_PLUGIN` overrides the file), with its scripts folder in place. It runs the four hook scripts through `hook-run.cjs` with `--agent amp` on `session.start`, `agent.start`, `tool.call`, `tool.result` and `agent.end` |
| Hook adapter | `skills/waymark/scripts/agents/amp.mjs` and the plugin `agents/amp-plugin.js`. Claude Code's payload and answers; Waymark journals each event (`~/.waymark/amp/<thread>.jsonl`) |

## What it does and does not do

- **Does:** the card (held until the thread's next prompt: `session.start` returns nothing), the reminder and the task ID with each prompt (returned as the message appended to the turn), the sensitive-path guard (`tool.call` returns `{action: 'reject-and-continue'}`, reads included), the commit trailer, the record of the task (files and commands come from Amp's own helpers), and the end-of-turn hook: a block is returned as `{action: 'continue', userMessage}`, once.
- **Does not:** judge the Cierre, the evidence or the choice window (`lacks: cierre, evidence, decision`): the reply arrives with `agent.end`, after the work, and the question tool is not documented. The gate before the first change lets it through. A tool result cannot carry the pack of a file, so it waits for the thread's next prompt. The review is `node "<skills-dir>/waymark/scripts/waymark.mjs" review <files>`.

## First live session: what to check

1. The plugin loads (`amp plugins list`) and runs `node` from a plugin: the plugin spawns `node hook-run.cjs …` with `child_process` (Bun); the docs do not say whether a plugin may, and `$` has no documented stdin.
2. `session.start` and `agent.start` fire for a new thread and for a resumed one; the card and the reminder arrive in the first turn; `ctx.system.workspaceRoot` is the project (a file URI).
3. `tool.call` input: the helpers `shellCommandFromToolCall` and `filesModifiedByToolCall` give the command and the files; the tool names (`Bash`, `shell_command`, `edit_file`, `Read`) and the names of the input fields are not documented (`cmd`? `path`?).
4. `{action: 'reject-and-continue', message}` stops the tool and the agent reads the message; `ctx.thread.cancel()` in `agent.start` stops a turn.
5. `agent.end` returns `{action: 'continue', userMessage, maxContinuations: 1}` once; `messages` holds the turn's assistant text.
6. `node "<skills-dir>/waymark/scripts/waymark.mjs" tasks` after a task: the record must show the agent `amp`.

Anything that differs: fix `agents/amp-plugin.js`, `agents/amp.mjs`, its driver `tests/conformance/agents/amp.mjs` and the spec `tests/new-adapters.test.mjs` with the real payload.

## MCP registration

Not read for this adapter: find where Amp registers MCP servers in its documentation before writing one (merge, never overwrite other servers).

## Capability mapping

Claude-only agents (`Explore`, `Plan`) and review skills have no direct equivalent: do the step yourself (search with your tools, write the plan in the chat) and use `node "<skills-dir>/waymark/scripts/waymark.mjs" review <files>` for the review. The choice window is asked in the chat.
