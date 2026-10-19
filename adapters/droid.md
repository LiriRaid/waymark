# Adapter · Droid

Written from the documentation (docs/adr/0041, checked 2026-10-19). Nothing here has run in a live Droid session.

| Key | Value |
|---|---|
| `<skills-dir>` | `~/.agents/skills`, shared by every agent: Droid reads `~/.agents/skills` (and `~/.factory/skills`), so a department is invoked by reading `<skills-dir>/<name>/SKILL.md` |
| `<project-skills-dir>` | `.agents/skills` |
| `<instructions-file>` | `~/.factory/AGENTS.md` (Droid also reads personal instructions in `~/.agents` and `~/.agent`). `connect-agents.mjs` writes the Rule 0 block there once the hooks run Waymark |
| `<project-instructions-file>` | `AGENTS.md` at the project root |
| Skill loading | reading `<skills-dir>/<name>/SKILL.md` counts as invoking it |
| Restart needed | yes: Droid snapshots its hooks at startup and warns when they change (`/hooks` reviews them) |
| Hooks (`docs/adr/0041`) | `~/.factory/hooks.json`, the events as the file's top-level keys (`WAYMARK_DROID_HOOKS` overrides the file): `SessionStart` → `session-hook.mjs`, `UserPromptSubmit` → `rule0-hook.mjs`, `PreToolUse` and `PostToolUse` → `tool-hook.mjs` (matcher `Execute\|Create\|Edit\|ApplyPatch\|Read`), `Stop` → `stop-hook.mjs`, each through `hook-run.cjs` with `--agent droid`. `hooksDisabled` and `allowManagedHooksOnly` in its settings turn them off |
| Hook adapter | `skills/waymark/scripts/agents/droid.mjs`. Claude Code's payload and answers; Waymark journals each event (`~/.waymark/droid/<session>.jsonl`) because the transcript's format is not documented |

## What it does and does not do

- **Does:** the card at the start of a session, the reminder and the task ID with each prompt (`additionalContext`, both bare and under `hookSpecificOutput`: the guide writes it bare), the pack of a file and the procedures with the first edit's result (`PostToolUse`), the sensitive-path guard (a deny before the tool, reads included), the commit trailer, the record of the task and the end-of-turn hook with `Stop`'s `decision: block`.
- **Does not:** judge the Cierre, the evidence or the choice window (`lacks: cierre, evidence, decision`): no hook carries the reply. The gate before the first change lets it through. The review is `node "<skills-dir>/waymark/scripts/waymark.mjs" review <files>`.

## First live session: what to check

1. `~/.factory/hooks.json` is read (and not `.factory/hooks.json` only), the events as top-level keys; the card arrives at the start.
2. The names and inputs of `Edit`, `ApplyPatch` and `Read` (`file_path`? `patch`?: documented only for `Create` and `Execute`) and `PostToolUse`'s `tool_response` (a result, a failed command). `agents/droid.mjs` takes `file_path`, `filePath`, `path` and, for `ApplyPatch`, `patch`, `input`, `patchText` or `diff`.
3. Whether the hook's shell and Windows are the ones the command needs (`node "<path>" "<path>"` with forward slashes) — the docs say nothing about Windows hooks.
4. `UserPromptSubmit`'s `additionalContext` arrives once, not twice, and `decision: block` stops a prompt.
5. `PreToolUse` with `permissionDecision: deny` stops the tool; exit 2 stderr reaches the agent; `Stop` with `decision: block` makes it continue once.
6. `node "<skills-dir>/waymark/scripts/waymark.mjs" tasks` after a task: the record must show the agent `droid` and the files.

Anything that differs: fix `agents/droid.mjs`, its driver `tests/conformance/agents/droid.mjs` and the spec `tests/new-adapters.test.mjs` with the real payload.

## MCP registration

Not read for this adapter: find where Droid registers MCP servers in its documentation before writing one (merge, never overwrite other servers).

## Capability mapping

Claude-only agents (`Explore`, `Plan`) and review skills have no direct equivalent: do the step yourself (search with your tools, write the plan in the chat) and use `node "<skills-dir>/waymark/scripts/waymark.mjs" review <files>` for the review. The choice window is asked in the chat.
